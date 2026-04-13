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

function compareDueOrder(a: Card, b: Card) {
  const aHasDueDate = typeof a.dueDate === "number";
  const bHasDueDate = typeof b.dueDate === "number";

  if (!aHasDueDate && !bHasDueDate) {
    return b.createdAt - a.createdAt;
  }
  if (!aHasDueDate) {
    return -1;
  }
  if (!bHasDueDate) {
    return 1;
  }
  const aDueDate = a.dueDate ?? 0;
  const bDueDate = b.dueDate ?? 0;
  if (aDueDate !== bDueDate) {
    return aDueDate - bDueDate;
  }

  return b.createdAt - a.createdAt;
}

export function sortCardsForDailyReview(cards: Card[], now = Date.now()) {
  const weakCards = cards
    .filter((card) => getDailyReviewBucket(card, now) === "weak")
    .sort(compareDueOrder);
  const mediumCards = cards
    .filter((card) => getDailyReviewBucket(card, now) === "medium")
    .sort(compareDueOrder);
  const easyCards = cards
    .filter((card) => getDailyReviewBucket(card, now) === "easy")
    .sort(compareDueOrder);

  return {
    weakCards,
    mediumCards,
    easyCards,
  };
}

export function buildDailyReviewQueues(cards: Card[], now: number) {
  const eligibleCards = cards.filter((card) => isCardEligibleForDailyReview(card, now));
  const { weakCards, mediumCards, easyCards } = sortCardsForDailyReview(eligibleCards, now);

  return {
    requiredCards: [...weakCards, ...mediumCards],
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
