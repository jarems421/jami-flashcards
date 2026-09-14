import type { Card } from "@/lib/study/cards";
import { DAILY_REVIEW_MAX_WEAK_ATTEMPTS } from "@/lib/study/daily-review";
import type { DailyReviewState } from "@/lib/study/daily-review-types";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import {
  isStruggleRating,
  isSuccessfulRating,
  type CardRating,
  type updateCardSchedule,
} from "@/lib/study/scheduler";
import type { StudySessionKind } from "@/lib/study/session";

/**
 * What one rating does to a card and to Daily Review, worked out on the device.
 *
 * Rating used to wait for every server write -- card, activity, goals, Daily
 * Review -- before the next card appeared, which was a second or more per card
 * and far longer on a weak connection. Everything the next card depends on can
 * be decided locally from what is already loaded, so the session moves on at
 * once and the writes follow behind. The offline path always worked this way;
 * this is the one place both paths now decide it.
 */

export type ReviewRetryResult = { attemptCount: number; parked: boolean };

export type ReviewOutcome = {
  isCorrect: boolean;
  isStruggle: boolean;
  schedule: ReturnType<typeof updateCardSchedule> | null;
  /** The card values to write, as the offline queue stores them. */
  cardUpdates: Record<string, number | string>;
  retryResult: ReviewRetryResult | null;
  parkedRiskUpdates: ReturnType<typeof parkedRiskValues> | null;
  /** The card as it now stands, for the rest of the session. */
  nextCard: Card;
  /** Whether the session's copy of the card changes. */
  updatesCards: boolean;
};

/** Tomorrow's risk on a card that has used up its Daily Review attempts for today. */
export function parkedRiskValues(at: number) {
  const studyDayKey = getStudyDayKey(at);
  return {
    lastStruggleAt: at,
    lastStruggleStudyDayKey: studyDayKey,
    memoryRiskOverrideDayKey: shiftStudyDayKey(studyDayKey, 1),
  };
}

export function planReviewOutcome(input: {
  card: Card;
  rating: CardRating;
  answeredAt: number;
  sessionKind: Exclude<StudySessionKind, "simple">;
  schedule: ReturnType<typeof updateCardSchedule> | null;
  dailyReviewState: DailyReviewState | null;
  /** The server's answer, when it is already known; otherwise counted locally. */
  retryResult?: ReviewRetryResult | null;
}): ReviewOutcome {
  const { card, rating, answeredAt: now, sessionKind, schedule } = input;
  const isCorrect = isSuccessfulRating(rating);
  const isStruggle = isStruggleRating(rating);
  const studyDayKey = getStudyDayKey(now);
  const cardUpdates: Record<string, number | string> = {};

  if (schedule) {
    Object.assign(cardUpdates, schedule);
  } else if (isStruggle) {
    cardUpdates.lastStruggleAt = now;
    cardUpdates.lastStruggleStudyDayKey = studyDayKey;
    cardUpdates.memoryRiskOverrideDayKey = shiftStudyDayKey(studyDayKey, 1);
    cardUpdates.customStruggleCount = (card.customStruggleCount ?? 0) + 1;
  }
  if (isStruggle) {
    cardUpdates.simpleStudyLastResult = "wrong";
    cardUpdates.simpleStudyLastReviewedAt = now;
    cardUpdates.simpleStudyWrongCount = (card.simpleStudyWrongCount ?? 0) + 1;
  }

  let retryResult: ReviewRetryResult | null = null;
  if (input.retryResult !== undefined) {
    retryResult = input.retryResult;
  } else if (sessionKind === "daily-required" && isStruggle) {
    const attemptCount = (input.dailyReviewState?.requiredRetryCounts[card.id] ?? 0) + 1;
    retryResult = { attemptCount, parked: attemptCount >= DAILY_REVIEW_MAX_WEAK_ATTEMPTS };
  }

  const parkedRiskUpdates =
    sessionKind === "daily-required" && isStruggle && retryResult?.parked
      ? parkedRiskValues(now)
      : null;
  if (parkedRiskUpdates) Object.assign(cardUpdates, parkedRiskUpdates);

  const nextCard: Card = {
    ...card,
    ...(schedule ?? {}),
    ...(parkedRiskUpdates ?? {}),
    ...(sessionKind === "custom" && isStruggle
      ? {
          lastStruggleAt: now,
          lastStruggleStudyDayKey: studyDayKey,
          memoryRiskOverrideDayKey: shiftStudyDayKey(studyDayKey, 1),
          customStruggleCount: (card.customStruggleCount ?? 0) + 1,
        }
      : {}),
    ...(isStruggle
      ? {
          simpleStudyLastResult: "wrong" as const,
          simpleStudyLastReviewedAt: now,
          simpleStudyWrongCount: (card.simpleStudyWrongCount ?? 0) + 1,
        }
      : {}),
    ...(schedule && isCorrect ? { memoryRiskOverrideDayKey: undefined } : {}),
  };

  return {
    isCorrect,
    isStruggle,
    schedule,
    cardUpdates,
    retryResult,
    parkedRiskUpdates,
    nextCard,
    updatesCards: Boolean(schedule || (sessionKind === "custom" && isStruggle)),
  };
}

/** Daily Review's state after one answer: a retry counted, or an obligation completed. */
export function applyReviewToDailyState(
  state: DailyReviewState | null,
  cardId: string,
  sessionKind: StudySessionKind,
  retryResult: ReviewRetryResult | null,
  now: number
): DailyReviewState | null {
  if (!state) return state;

  if (sessionKind === "daily-required") {
    if (retryResult) {
      return {
        ...state,
        requiredRetryCounts: { ...state.requiredRetryCounts, [cardId]: retryResult.attemptCount },
        parkedRequiredCardIds:
          retryResult.parked && !state.parkedRequiredCardIds.includes(cardId)
            ? [...state.parkedRequiredCardIds, cardId]
            : state.parkedRequiredCardIds,
        updatedAt: now,
      };
    }
    return {
      ...state,
      completedRequiredCardIds: state.completedRequiredCardIds.includes(cardId)
        ? state.completedRequiredCardIds
        : [...state.completedRequiredCardIds, cardId],
      updatedAt: now,
    };
  }

  if (sessionKind === "daily-optional") {
    return {
      ...state,
      completedOptionalCardIds: state.completedOptionalCardIds.includes(cardId)
        ? state.completedOptionalCardIds
        : [...state.completedOptionalCardIds, cardId],
      updatedAt: now,
    };
  }

  return state;
}
