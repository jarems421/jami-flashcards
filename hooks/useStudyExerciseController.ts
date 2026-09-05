"use client";

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { StarReward } from "@/components/constellation/StarRewardOverlay";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import { DAILY_REVIEW_MAX_WEAK_ATTEMPTS } from "@/lib/study/daily-review";
import type { DailyReviewState } from "@/lib/study/daily-review-types";
import type { Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import {
  buildCardReviewUpdateCommand,
  hasCardReviewUpdateCommand,
} from "@/lib/study/card-review";
import {
  isStruggleRating,
  isSuccessfulRating,
  updateCardSchedule,
  type CardRating,
} from "@/lib/study/scheduler";
import {
  applySimpleStudyResultToCard,
  applySimpleStudyResultToQueue,
  type SimpleStudyResult,
} from "@/lib/study/simple-study";
import {
  queueOfflineStudyReview,
  saveOfflineStudySnapshot,
} from "@/lib/study/offline-study";
import type { StudySessionKind, StudySessionStats } from "@/lib/study/session";
import {
  getAnswerFeedback,
  getSimpleStudyFeedback,
  withGoalReward,
  type AnswerFeedback,
} from "@/lib/study/study-feedback";
import {
  markDailyReviewCardComplete,
  recordDailyReviewWeakAttempt,
} from "@/services/study/daily-review";
import {
  recordSimpleStudyResult,
  updateCardAfterReview,
} from "@/services/study/cards";
import { applyGoalProgressForAnswer } from "@/services/study/goals";
import { recordStudyReview } from "@/services/study/activity";

/**
 * One answer, on its way to being recorded.
 *
 * The card is named rather than assumed so a mode that marks its own answer
 * cannot commit against whichever card happens to be on screen by the time the
 * marking settles. `responseTimeMs` is optional: a mode that measures its own
 * thinking time passes it, and anything that reveals through `reveal()` gets
 * the flip-to-answer gap for free.
 */
export type StudyAttemptCommit = {
  cardId: string;
  rating: CardRating;
  answeredAt: number;
  responseTimeMs?: number;
  /**
   * Send a missed card to the back of the session rather than losing it.
   *
   * This is how a flashcard has always behaved: get it wrong and you see it
   * again before you finish, but far enough away to have forgotten the answer
   * you were just shown. Daily Review already did this and now the answer-first
   * modes do too. Classic outside Daily Review does not, so its behaviour is
   * unchanged.
   *
   * Never overrides parking: a card that has used up its attempts for the day
   * still stops.
   */
  requeueOnMiss?: boolean;
};

/**
 * The single road into scheduling.
 *
 * Every exercise, whatever it renders and however it marks, ends here. FSRS,
 * Daily Review completion, goals, stars, streak activity, the offline queue and
 * the in-session retry cadence are all reached through `commitReview` and
 * nowhere else, so a new mode cannot accidentally invent its own scheduling.
 */
/** A practice answer: counted, never scheduled. */
export type PracticeResult = {
  cardId: string;
  correct: boolean;
};

export type StudyExerciseController = {
  reveal: () => void;
  commitReview: (attempt: StudyAttemptCommit) => Promise<void>;
  continueWithoutScheduling: (result: PracticeResult) => void;
  /**
   * How many times this session has sent a card to the back of the queue.
   *
   * The exercise stage is keyed on it, so a card that comes round again arrives
   * as a fresh question. Without it, a one-card session would requeue onto
   * itself and leave the previous answer's verdict on screen.
   */
  presentation: number;
};

type ControllerOptions = {
  userId: string;
  current: Card | null;
  sessionKind: StudySessionKind | null;
  flipped: boolean;
  setFlipped: Dispatch<SetStateAction<boolean>>;
  onReveal?: () => void;
  cards: Card[];
  setCards: Dispatch<SetStateAction<Card[]>>;
  decks: Deck[];
  index: number;
  setIndex: Dispatch<SetStateAction<number>>;
  sessionCards: Card[];
  setSessionCards: Dispatch<SetStateAction<Card[]>>;
  dailyReviewState: DailyReviewState | null;
  setDailyReviewState: Dispatch<SetStateAction<DailyReviewState | null>>;
  setSessionStats: Dispatch<SetStateAction<StudySessionStats>>;
  setAnswerFeedback: Dispatch<SetStateAction<AnswerFeedback | null>>;
  setStarReward: Dispatch<SetStateAction<StarReward | null>>;
  savingRating: CardRating | null;
  setSavingRating: Dispatch<SetStateAction<CardRating | null>>;
  offlineMode: boolean;
  setOfflineMode: Dispatch<SetStateAction<boolean>>;
  bumpSessionRevision: () => number;
  refreshPendingOfflineReviews: () => void;
  clearFeedback: () => void;
  notifySuccess: (message: string) => void;
  notifyError: (message: string) => void;
};

/**
 * Whether a missed card comes round again before the session ends.
 *
 * Two things ask for it. Daily Review always has: a required card you got wrong
 * goes to the back of the queue until it is either answered or parked. The
 * answer-first modes now ask for it too, through `requeueOnMiss`, because a
 * flashcard you got wrong and never saw again taught you nothing.
 *
 * Parking is the one thing that overrules both. A card that has used up its
 * attempts for the day stops, however the student got it wrong.
 */
function shouldRequeueAfterMiss(input: {
  attempt: StudyAttemptCommit;
  isStruggle: boolean;
  retryResult: { attemptCount: number; parked: boolean } | null;
}) {
  if (!input.isStruggle) return false;
  if (input.retryResult) return !input.retryResult.parked;
  return Boolean(input.attempt.requeueOnMiss);
}

export function useStudyExerciseController(
  options: ControllerOptions
): StudyExerciseController {
  const {
    userId,
    current,
    sessionKind,
    flipped,
    setFlipped,
    onReveal,
    cards,
    setCards,
    decks,
    index,
    setIndex,
    sessionCards,
    setSessionCards,
    dailyReviewState,
    setDailyReviewState,
    setSessionStats,
    setAnswerFeedback,
    setStarReward,
    savingRating,
    setSavingRating,
    offlineMode,
    setOfflineMode,
    bumpSessionRevision,
    refreshPendingOfflineReviews,
    clearFeedback,
    notifySuccess,
    notifyError,
  } = options;

  const revealedAtRef = useRef(0);
  const [presentation, setPresentation] = useState(0);

  const reveal = useCallback(() => {
    if (!current || flipped) return;
    revealedAtRef.current = Date.now();
    setFlipped(true);
    onReveal?.();
  }, [current, flipped, onReveal, setFlipped]);

  const folderIdsForCard = useCallback(
    (card: Card) =>
      decks.find((deck) => deck.id === card.deckId)?.folderIds ?? [],
    [decks]
  );

  const goNext = useCallback(() => {
    setIndex((value) => value + 1);
    setFlipped(false);
  }, [setFlipped, setIndex]);

  const requeueCurrentCard = useCallback(
    (nextCard: Card) => {
      setSessionCards((prev) => {
        const before = prev.slice(0, index);
        const after = prev.slice(index + 1);
        return [...before, ...after, nextCard];
      });
      setFlipped(false);
      setPresentation((value) => value + 1);
    },
    [index, setFlipped, setSessionCards]
  );

  const measureResponseTime = useCallback(
    (attempt: StudyAttemptCommit) =>
      attempt.responseTimeMs ??
      (revealedAtRef.current > 0
        ? attempt.answeredAt - revealedAtRef.current
        : undefined),
    []
  );

  const commitOffline = useCallback(
    async (card: Card, attempt: StudyAttemptCommit) => {
      if (!sessionKind || sessionKind === "simple") return;

      const now = attempt.answeredAt;
      const rating = attempt.rating;
      const durationMs = measureResponseTime(attempt);
      const isCorrect = isSuccessfulRating(rating);
      const isStruggle = isStruggleRating(rating);
      const schedule =
        sessionKind === "custom" ? null : updateCardSchedule(card, rating);
      const cardUpdates: Record<string, number | string> = {};
      let retryResult: { attemptCount: number; parked: boolean } | null = null;

      if (schedule) {
        Object.assign(cardUpdates, schedule);
      } else if (isStruggle) {
        const studyDayKey = getStudyDayKey(now);
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

      if (sessionKind === "daily-required" && isStruggle) {
        const currentAttempts = dailyReviewState?.requiredRetryCounts[card.id] ?? 0;
        const attemptCount = currentAttempts + 1;
        retryResult = {
          attemptCount,
          parked: attemptCount >= DAILY_REVIEW_MAX_WEAK_ATTEMPTS,
        };
      }

      const parkedRiskUpdates =
        sessionKind === "daily-required" && isStruggle && retryResult?.parked
          ? {
              lastStruggleAt: now,
              lastStruggleStudyDayKey: getStudyDayKey(now),
              memoryRiskOverrideDayKey: shiftStudyDayKey(getStudyDayKey(now), 1),
            }
          : null;

      if (parkedRiskUpdates) {
        Object.assign(cardUpdates, parkedRiskUpdates);
      }

      queueOfflineStudyReview({
        userId,
        cardId: card.id,
        deckId: card.deckId,
        topicIds: card.topicIds ?? [],
        folderIds: folderIdsForCard(card),
        rating,
        reviewedAt: now,
        studyDayKey: getStudyDayKey(now),
        isCorrect,
        durationMs,
        sessionKind,
        cardUpdates,
        clearMemoryRiskOverrideDayKey: Boolean(schedule && isCorrect),
      });
      refreshPendingOfflineReviews();

      const nextCard: Card = {
        ...card,
        ...(schedule ?? {}),
        ...(parkedRiskUpdates ?? {}),
        ...(sessionKind === "custom" && isStruggle
          ? {
              lastStruggleAt: now,
              lastStruggleStudyDayKey: getStudyDayKey(now),
              memoryRiskOverrideDayKey: shiftStudyDayKey(getStudyDayKey(now), 1),
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
      const nextCardsSnapshot = cards.map((entry) =>
        entry.id === card.id ? nextCard : entry
      );

      if (schedule || (sessionKind === "custom" && isStruggle)) {
        setCards(nextCardsSnapshot);
        saveOfflineStudySnapshot(userId, { cards: nextCardsSnapshot, decks });
      }

      if (sessionKind === "daily-required") {
        if (isStruggle && retryResult) {
          setDailyReviewState((prev) =>
            prev
              ? {
                  ...prev,
                  requiredRetryCounts: {
                    ...prev.requiredRetryCounts,
                    [card.id]: retryResult.attemptCount,
                  },
                  parkedRequiredCardIds:
                    retryResult.parked &&
                    !prev.parkedRequiredCardIds.includes(card.id)
                      ? [...prev.parkedRequiredCardIds, card.id]
                      : prev.parkedRequiredCardIds,
                  updatedAt: now,
                }
              : prev
          );
        } else {
          setDailyReviewState((prev) =>
            prev
              ? {
                  ...prev,
                  completedRequiredCardIds: prev.completedRequiredCardIds.includes(
                    card.id
                  )
                    ? prev.completedRequiredCardIds
                    : [...prev.completedRequiredCardIds, card.id],
                  updatedAt: now,
                }
              : prev
          );
        }
      } else if (sessionKind === "daily-optional") {
        setDailyReviewState((prev) =>
          prev
            ? {
                ...prev,
                completedOptionalCardIds: prev.completedOptionalCardIds.includes(
                  card.id
                )
                  ? prev.completedOptionalCardIds
                  : [...prev.completedOptionalCardIds, card.id],
                updatedAt: now,
              }
            : prev
        );
      }

      bumpSessionRevision();
      setOfflineMode(true);
      setSessionStats((prev) => ({
        reviewedCards: prev.reviewedCards + 1,
        correctAnswers: prev.correctAnswers + (isCorrect ? 1 : 0),
        completedGoals: prev.completedGoals,
        starsEarned: prev.starsEarned,
        ratings: { ...prev.ratings, [rating]: prev.ratings[rating] + 1 },
      }));
      setAnswerFeedback(
        getAnswerFeedback(rating, sessionKind, Boolean(retryResult?.parked))
      );
      notifySuccess("Saved offline. This answer will sync when you are back online.");

      if (shouldRequeueAfterMiss({ attempt, isStruggle, retryResult })) {
        requeueCurrentCard(nextCard);
      } else {
        goNext();
      }
    },
    [
      bumpSessionRevision,
      cards,
      dailyReviewState,
      decks,
      folderIdsForCard,
      goNext,
      measureResponseTime,
      notifySuccess,
      refreshPendingOfflineReviews,
      requeueCurrentCard,
      sessionKind,
      setAnswerFeedback,
      setCards,
      setDailyReviewState,
      setOfflineMode,
      setSessionStats,
      userId,
    ]
  );

  const commitSimpleStudy = useCallback(
    async (card: Card, result: SimpleStudyResult) => {
      if (sessionKind !== "simple" || savingRating) return;

      const now = Date.now();
      const nextCard = applySimpleStudyResultToCard(card, result, now);
      const nextCardsSnapshot = cards.map((entry) =>
        entry.id === card.id ? nextCard : entry
      );
      const ratingForStats: CardRating = result === "correct" ? "good" : "again";
      setSavingRating(ratingForStats);
      clearFeedback();

      setCards(nextCardsSnapshot);
      saveOfflineStudySnapshot(userId, { cards: nextCardsSnapshot, decks });
      if (result === "correct") {
        setSessionCards((prev) =>
          prev.map((entry) => (entry.id === card.id ? nextCard : entry))
        );
        setIndex((value) => Math.min(value + 1, sessionCards.length));
      } else {
        setSessionCards((prev) =>
          applySimpleStudyResultToQueue(prev, card.id, result, now)
        );
        // A missed card goes to the back of the queue, which on a one-card
        // queue is the same card again at the same index. The answer-first
        // modes are keyed on this counter, so without it a re-asked question
        // would come back with the previous attempt still revealed under it.
        setPresentation((value) => value + 1);
      }
      bumpSessionRevision();
      setSessionStats((prev) => ({
        reviewedCards: prev.reviewedCards + 1,
        correctAnswers: prev.correctAnswers + (result === "correct" ? 1 : 0),
        completedGoals: prev.completedGoals,
        starsEarned: prev.starsEarned,
        ratings: {
          ...prev.ratings,
          [ratingForStats]: prev.ratings[ratingForStats] + 1,
        },
      }));
      setAnswerFeedback(getSimpleStudyFeedback(result));
      setFlipped(false);

      try {
        await recordSimpleStudyResult(card.id, result, now);
      } catch (error) {
        console.warn("Failed to save Simple Study result.", error);
        setOfflineMode(true);
        notifySuccess(
          "Kept this Simple Study answer in your current session. It will refresh when your connection settles."
        );
      } finally {
        setSavingRating(null);
      }
    },
    [
      bumpSessionRevision,
      cards,
      clearFeedback,
      decks,
      notifySuccess,
      savingRating,
      sessionCards.length,
      sessionKind,
      setAnswerFeedback,
      setCards,
      setFlipped,
      setIndex,
      setOfflineMode,
      setSavingRating,
      setSessionCards,
      setSessionStats,
      userId,
    ]
  );

  const commitReview = useCallback(
    async (attempt: StudyAttemptCommit) => {
      // The card is resolved by id rather than taken from the session cursor,
      // so an answer that took a moment to mark can never be written against
      // whichever card arrived in the meantime.
      if (!current || !sessionKind || current.id !== attempt.cardId) return;
      const card = current;
      const rating = attempt.rating;

      if (sessionKind === "simple") {
        await commitSimpleStudy(
          card,
          rating === "again" || rating === "hard" ? "wrong" : "correct"
        );
        return;
      }

      setSavingRating(rating);
      clearFeedback();
      try {
        if (
          offlineMode ||
          (typeof navigator !== "undefined" && !navigator.onLine)
        ) {
          await commitOffline(card, attempt);
          return;
        }

        const now = attempt.answeredAt;
        const isCorrect = isSuccessfulRating(rating);
        const isStruggle = isStruggleRating(rating);
        const schedule =
          sessionKind === "custom" ? null : updateCardSchedule(card, rating);
        const cardReviewUpdate = buildCardReviewUpdateCommand({
          schedule,
          isCorrect,
          isStruggle,
          reviewedAt: now,
        });

        const reviewPromise = recordStudyReview(userId, now, {
          isCorrect,
          durationMs: measureResponseTime(attempt),
          sessionKind: sessionKind === "custom" ? "custom" : "daily",
        });
        const goalProgressPromise = applyGoalProgressForAnswer(
          userId,
          isCorrect,
          now,
          {
            deckId: card.deckId,
            topicIds: card.topicIds ?? [],
            folderIds: folderIdsForCard(card),
          }
        );
        const remainingPromises: Promise<unknown>[] = [];
        if (hasCardReviewUpdateCommand(cardReviewUpdate)) {
          remainingPromises.push(updateCardAfterReview(card.id, cardReviewUpdate));
        }
        let retryResultPromise: Promise<{
          attemptCount: number;
          parked: boolean;
        }> | null = null;
        if (sessionKind === "daily-required" && isStruggle) {
          retryResultPromise = recordDailyReviewWeakAttempt(userId, card.id, now);
          remainingPromises.push(retryResultPromise);
        } else if (sessionKind === "daily-required") {
          remainingPromises.push(
            markDailyReviewCardComplete(userId, card.id, "required")
          );
        }
        if (sessionKind === "daily-optional") {
          remainingPromises.push(
            markDailyReviewCardComplete(userId, card.id, "optional")
          );
        }
        const [, goalProgress] = await Promise.all([
          reviewPromise,
          goalProgressPromise,
          ...remainingPromises,
        ]);
        const retryResult = retryResultPromise ? await retryResultPromise : null;
        const parkedRiskUpdates =
          sessionKind === "daily-required" && isStruggle && retryResult?.parked
            ? {
                lastStruggleAt: now,
                lastStruggleStudyDayKey: getStudyDayKey(now),
                memoryRiskOverrideDayKey: shiftStudyDayKey(
                  getStudyDayKey(now),
                  1
                ),
              }
            : null;
        if (parkedRiskUpdates) {
          await updateCardAfterReview(card.id, { values: parkedRiskUpdates });
        }
        const nextCard: Card = {
          ...card,
          ...(schedule ?? {}),
          ...(parkedRiskUpdates ?? {}),
          ...(sessionKind === "custom" && isStruggle
            ? {
                lastStruggleAt: now,
                lastStruggleStudyDayKey: getStudyDayKey(now),
                memoryRiskOverrideDayKey: shiftStudyDayKey(
                  getStudyDayKey(now),
                  1
                ),
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
          ...(schedule && isCorrect
            ? { memoryRiskOverrideDayKey: undefined }
            : {}),
        };
        if (schedule || (sessionKind === "custom" && isStruggle)) {
          setCards((prev) =>
            prev.map((entry) => (entry.id === card.id ? nextCard : entry))
          );
        }
        if (sessionKind === "daily-required") {
          if (isStruggle && retryResult) {
            setDailyReviewState((prev) =>
              prev
                ? {
                    ...prev,
                    requiredRetryCounts: {
                      ...prev.requiredRetryCounts,
                      [card.id]: retryResult.attemptCount,
                    },
                    parkedRequiredCardIds:
                      retryResult.parked &&
                      !prev.parkedRequiredCardIds.includes(card.id)
                        ? [...prev.parkedRequiredCardIds, card.id]
                        : prev.parkedRequiredCardIds,
                    updatedAt: now,
                  }
                : prev
            );
          } else {
            setDailyReviewState((prev) =>
              prev
                ? {
                    ...prev,
                    completedRequiredCardIds:
                      prev.completedRequiredCardIds.includes(card.id)
                        ? prev.completedRequiredCardIds
                        : [...prev.completedRequiredCardIds, card.id],
                    updatedAt: now,
                  }
                : prev
            );
          }
        } else if (sessionKind === "daily-optional") {
          setDailyReviewState((prev) =>
            prev
              ? {
                  ...prev,
                  completedOptionalCardIds:
                    prev.completedOptionalCardIds.includes(card.id)
                      ? prev.completedOptionalCardIds
                      : [...prev.completedOptionalCardIds, card.id],
                  updatedAt: now,
                }
              : prev
          );
        }
        bumpSessionRevision();
        setSessionStats((prev) => ({
          reviewedCards: prev.reviewedCards + 1,
          correctAnswers: prev.correctAnswers + (isCorrect ? 1 : 0),
          completedGoals: prev.completedGoals + goalProgress.completedGoals,
          starsEarned: prev.starsEarned + goalProgress.starsEarned,
          ratings: { ...prev.ratings, [rating]: prev.ratings[rating] + 1 },
        }));
        setAnswerFeedback(
          withGoalReward(
            getAnswerFeedback(rating, sessionKind, Boolean(retryResult?.parked)),
            goalProgress
          )
        );
        // Only the first is shown: finishing two goals on one card is rare, and
        // stacking overlays would bury the card behind the celebration.
        if (goalProgress.rewards.length > 0) setStarReward(goalProgress.rewards[0]);
        // A missed card goes to the back of the queue: seen again before the
        // session ends, but with enough cards in between to have genuinely
        // forgotten the answer it was just shown. Parking still wins -- a card
        // that has used up its Daily Review attempts stops for the day.
        if (shouldRequeueAfterMiss({ attempt, isStruggle, retryResult })) {
          requeueCurrentCard(nextCard);
        } else {
          goNext();
        }
      } catch (error) {
        console.error(error);
        notifyError("Failed to save that answer. Please try again.");
      } finally {
        setSavingRating(null);
      }
    },
    [
      bumpSessionRevision,
      clearFeedback,
      commitOffline,
      commitSimpleStudy,
      current,
      folderIdsForCard,
      goNext,
      measureResponseTime,
      notifyError,
      offlineMode,
      requeueCurrentCard,
      sessionKind,
      setAnswerFeedback,
      setCards,
      setDailyReviewState,
      setSavingRating,
      setSessionStats,
      setStarReward,
      userId,
    ]
  );

  /**
   * Move on without touching the schedule.
   *
   * Multiple choice ends here. It updates the session's own accuracy and reuses
   * the retry cadence -- a missed card goes to the back of the queue for
   * another look -- but writes no FSRS state, completes no Daily Review
   * obligation and credits no goal. A student can run a whole MCQ session over
   * their due cards and those cards will still be due.
   */
  const continueWithoutScheduling = useCallback(
    (result: PracticeResult) => {
      if (!current || current.id !== result.cardId) return;

      bumpSessionRevision();
      setSessionStats((prev) => ({
        ...prev,
        reviewedCards: prev.reviewedCards + 1,
        correctAnswers: prev.correctAnswers + (result.correct ? 1 : 0),
      }));

      if (result.correct) {
        goNext();
      } else {
        requeueCurrentCard(current);
      }
    },
    [bumpSessionRevision, current, goNext, requeueCurrentCard, setSessionStats]
  );

  return { reveal, commitReview, continueWithoutScheduling, presentation };
}
