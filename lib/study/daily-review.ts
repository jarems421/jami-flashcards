import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo, hasActiveMemoryRiskOverride } from "@/lib/study/memory-risk";

export type DailyReviewBucket = "weak" | "medium" | "easy";

export type DailyReviewState = {
  id: string;
  studyDayKey: string;
  generatedAt: number;
  requiredCardIds: string[];
  optionalCardIds: string[];
  completedRequiredCardIds: string[];
  completedOptionalCardIds: string[];
  parkedRequiredCardIds: string[];
  requiredRetryCounts: Record<string, number>;
  updatedAt: number;
};

export const DAILY_REVIEW_STATE_DOC_ID = "dailyReview";
export const STUDY_STATE_META_DOC_ID = "meta";
export const STUDY_ACTIVITY_SCHEMA_VERSION = 2;
export const DAILY_REVIEW_MAX_WEAK_ATTEMPTS = 5;

function normalizeCardIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return Array.from(new Set(ids));
}

function normalizeRetryCounts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const counts: Record<string, number> = {};
  for (const [cardId, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      counts[cardId] = Math.floor(count);
    }
  }

  return counts;
}

export function normalizeDailyReviewState(
  id: string,
  data: Record<string, unknown>
): DailyReviewState {
  return {
    id,
    studyDayKey:
      typeof data.studyDayKey === "string" && data.studyDayKey.trim()
        ? data.studyDayKey
        : "",
    generatedAt: typeof data.generatedAt === "number" ? data.generatedAt : 0,
    requiredCardIds: normalizeCardIdList(data.requiredCardIds),
    optionalCardIds: normalizeCardIdList(data.optionalCardIds),
    completedRequiredCardIds: normalizeCardIdList(data.completedRequiredCardIds),
    completedOptionalCardIds: normalizeCardIdList(data.completedOptionalCardIds),
    parkedRequiredCardIds: normalizeCardIdList(data.parkedRequiredCardIds),
    requiredRetryCounts: normalizeRetryCounts(data.requiredRetryCounts),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function isCardDue(card: Pick<Card, "dueDate">, now: number) {
  return typeof card.dueDate !== "number" || card.dueDate <= now;
}

export function isCardEligibleForDailyReview(card: Card, now: number) {
  return isCardDue(card, now) || hasActiveMemoryRiskOverride(card, now);
}

export function getDailyReviewBucket(card: Card, now = Date.now()): DailyReviewBucket {
  const memoryRisk = getMemoryRiskInfo(card, now);

  if (memoryRisk.tier === "high") {
    return "weak";
  }

  if (memoryRisk.tier === "medium") {
    return "medium";
  }

  return "easy";
}

function getStudyPriorityTime(card: Card) {
  if (typeof card.dueDate === "number") {
    return card.dueDate;
  }

  if (typeof card.lastReview === "number") {
    return card.lastReview;
  }

  return card.createdAt;
}

function hasCardReviewHistory(card: Card) {
  if (typeof card.lastReview === "number") {
    return true;
  }

  if (
    (card.reps ?? 0) > 0 ||
    (card.lapses ?? 0) > 0 ||
    (card.repetitions ?? 0) > 0
  ) {
    return true;
  }

  if (
    (card.stability ?? 0) > 0 ||
    (card.difficulty ?? 0) > 0 ||
    (card.interval ?? 0) > 0 ||
    (card.easeFactor ?? 0) > 0
  ) {
    return true;
  }

  if (
    typeof card.fsrsState === "number" &&
    card.fsrsState !== 0
  ) {
    return true;
  }

  return typeof card.dueDate === "number";
}

function compareNewCardAge(a: Card, b: Card) {
  const createdAtDelta = a.createdAt - b.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return a.id.localeCompare(b.id);
}

function compareStudyPriority(a: Card, b: Card, now: number) {
  const riskScoreDelta =
    getMemoryRiskInfo(b, now).score - getMemoryRiskInfo(a, now).score;
  if (riskScoreDelta !== 0) {
    return riskScoreDelta;
  }

  const priorityTimeDelta = getStudyPriorityTime(a) - getStudyPriorityTime(b);
  if (priorityTimeDelta !== 0) {
    return priorityTimeDelta;
  }

  return a.createdAt - b.createdAt;
}

export function sortCardsForDailyReview(cards: Card[], now = Date.now()) {
  const neverReviewedCards = cards
    .filter((card) => !hasCardReviewHistory(card))
    .sort(compareNewCardAge);
  const reviewedCards = cards.filter((card) => hasCardReviewHistory(card));
  const weakCards = reviewedCards
    .filter((card) => getDailyReviewBucket(card, now) === "weak")
    .sort((left, right) => compareStudyPriority(left, right, now));
  const mediumCards = reviewedCards
    .filter((card) => getDailyReviewBucket(card, now) === "medium")
    .sort((left, right) => compareStudyPriority(left, right, now));
  const easyCards = reviewedCards
    .filter((card) => getDailyReviewBucket(card, now) === "easy")
    .sort((left, right) => compareStudyPriority(left, right, now));

  return {
    neverReviewedCards,
    weakCards,
    mediumCards,
    easyCards,
  };
}

export function sortCardsByStudyPriority(cards: Card[], now = Date.now()) {
  const { neverReviewedCards, weakCards, mediumCards, easyCards } = sortCardsForDailyReview(cards, now);
  return [...neverReviewedCards, ...weakCards, ...mediumCards, ...easyCards];
}

export function buildDailyReviewQueues(cards: Card[], now: number) {
  const eligibleCards = cards.filter((card) => isCardEligibleForDailyReview(card, now));
  const { neverReviewedCards, weakCards, mediumCards, easyCards } = sortCardsForDailyReview(eligibleCards, now);

  return {
    requiredCards: [...neverReviewedCards, ...weakCards, ...mediumCards],
    optionalCards: easyCards,
  };
}

export function isDailyReviewRequiredComplete(state: DailyReviewState | null) {
  if (!state) {
    return false;
  }

  const doneCardIds = new Set([
    ...state.completedRequiredCardIds,
    ...state.parkedRequiredCardIds,
  ]);

  return state.requiredCardIds.every((cardId) =>
    doneCardIds.has(cardId)
  );
}
