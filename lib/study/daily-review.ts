import type { Card } from "@/lib/study/cards";

export type DailyReviewBucket = "weak" | "medium" | "easy";

export type DailyReviewState = {
  id: string;
  studyDayKey: string;
  generatedAt: number;
  requiredCardIds: string[];
  optionalCardIds: string[];
  completedRequiredCardIds: string[];
  completedOptionalCardIds: string[];
  updatedAt: number;
};

export const DAILY_REVIEW_STATE_DOC_ID = "dailyReview";
export const STUDY_STATE_META_DOC_ID = "meta";
export const STUDY_ACTIVITY_SCHEMA_VERSION = 2;

function normalizeCardIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return Array.from(new Set(ids));
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
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function isCardDue(card: Pick<Card, "dueDate">, now: number) {
  return typeof card.dueDate !== "number" || card.dueDate <= now;
}

export function getDailyReviewBucket(card: Pick<Card, "difficulty">): DailyReviewBucket {
  if (typeof card.difficulty !== "number" || card.difficulty <= 0) {
    return "medium";
  }

  if (card.difficulty < 4) {
    return "easy";
  }

  if (card.difficulty < 7) {
    return "medium";
  }

  return "weak";
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

export function sortCardsForDailyReview(cards: Card[]) {
  const weakCards = cards
    .filter((card) => getDailyReviewBucket(card) === "weak")
    .sort(compareDueOrder);
  const mediumCards = cards
    .filter((card) => getDailyReviewBucket(card) === "medium")
    .sort(compareDueOrder);
  const easyCards = cards
    .filter((card) => getDailyReviewBucket(card) === "easy")
    .sort(compareDueOrder);

  return {
    weakCards,
    mediumCards,
    easyCards,
  };
}

export function buildDailyReviewQueues(cards: Card[], now: number) {
  const dueCards = cards.filter((card) => isCardDue(card, now));
  const { weakCards, mediumCards, easyCards } = sortCardsForDailyReview(dueCards);

  return {
    requiredCards: [...weakCards, ...mediumCards],
    optionalCards: easyCards,
  };
}

export function isDailyReviewRequiredComplete(state: DailyReviewState | null) {
  if (!state) {
    return false;
  }

  return state.requiredCardIds.every((cardId) =>
    state.completedRequiredCardIds.includes(cardId)
  );
}
