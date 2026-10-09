import type { Card } from "@/lib/study/cards";
import type {
  DailyReviewState,
  DailyReviewStateData,
} from "@/lib/study/daily-review-types";
import { getStudyDayKey } from "@/lib/study/day";
import {
  getMemoryRiskInfo,
  hasActiveMemoryRiskOverride,
  type MemoryRiskInfo,
} from "@/lib/study/memory-risk";
import type { PersistedStudySession } from "@/lib/study/session";

export type DailyReviewBucket = "weak" | "medium" | "easy";

export type {
  DailyReviewState,
  DailyReviewStateData,
} from "@/lib/study/daily-review-types";

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
    carryoverRequiredCardIds: normalizeCardIdList(data.carryoverRequiredCardIds),
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

function bucketOfRisk(memoryRisk: MemoryRiskInfo): DailyReviewBucket {
  if (memoryRisk.tier === "high") {
    return "weak";
  }

  if (memoryRisk.tier === "medium") {
    return "medium";
  }

  return "easy";
}

export function getDailyReviewBucket(card: Card, now = Date.now()): DailyReviewBucket {
  return bucketOfRisk(getMemoryRiskInfo(card, now));
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

/** A reviewed card with what decides its place, worked out once rather than at every comparison. */
type RankedCard = { card: Card; riskScore: number; priorityTime: number };

function compareStudyPriority(a: RankedCard, b: RankedCard) {
  const riskScoreDelta = b.riskScore - a.riskScore;
  if (riskScoreDelta !== 0) {
    return riskScoreDelta;
  }

  const priorityTimeDelta = a.priorityTime - b.priorityTime;
  if (priorityTimeDelta !== 0) {
    return priorityTimeDelta;
  }

  return a.card.createdAt - b.card.createdAt;
}

function sortByStudyPriority(ranked: RankedCard[]) {
  return ranked.sort(compareStudyPriority).map(({ card }) => card);
}

export function sortCardsForDailyReview(cards: Card[], now = Date.now()) {
  const neverReviewedCards = cards
    .filter((card) => !hasCardReviewHistory(card))
    .sort(compareNewCardAge);
  /*
   * Each card's risk is worked out once, and its bucket read from it. Every
   * comparison used to work out both cards' risks again, so sorting five
   * thousand cards worked them out well over a hundred thousand times -- and
   * Learn sorts its cards several times before it can draw.
   */
  const buckets: Record<DailyReviewBucket, RankedCard[]> = { weak: [], medium: [], easy: [] };
  for (const card of cards) {
    if (!hasCardReviewHistory(card)) continue;
    const risk = getMemoryRiskInfo(card, now);
    buckets[bucketOfRisk(risk)].push({ card, riskScore: risk.score, priorityTime: getStudyPriorityTime(card) });
  }

  return {
    neverReviewedCards,
    weakCards: sortByStudyPriority(buckets.weak),
    mediumCards: sortByStudyPriority(buckets.medium),
    easyCards: sortByStudyPriority(buckets.easy),
  };
}

export function sortCardsByStudyPriority(cards: Card[], now = Date.now()) {
  const { neverReviewedCards, weakCards, mediumCards, easyCards } = sortCardsForDailyReview(cards, now);
  return [...neverReviewedCards, ...weakCards, ...mediumCards, ...easyCards];
}

export function getCardsByIds(cards: Card[], ids: string[]) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  return Array.from(new Set(ids))
    .map((id) => cardsById.get(id) ?? null)
    .filter((card): card is Card => card !== null);
}

export function getUnfinishedRequiredCardIds(
  state: DailyReviewState | null,
  cards: Card[]
) {
  if (!state) {
    return [];
  }

  const knownCardIds = new Set(cards.map((card) => card.id));
  const handledCardIds = new Set([
    ...state.completedRequiredCardIds,
    ...state.parkedRequiredCardIds,
  ]);

  return state.requiredCardIds.filter(
    (cardId) => knownCardIds.has(cardId) && !handledCardIds.has(cardId)
  );
}

function getHandledRequiredCardIds(state: DailyReviewState) {
  return new Set([
    ...state.completedRequiredCardIds,
    ...state.parkedRequiredCardIds,
  ]);
}

export function getRemainingCarryoverRequiredCards(
  state: DailyReviewState | null,
  cards: Card[]
) {
  if (!state) {
    return [];
  }

  const handledCardIds = getHandledRequiredCardIds(state);
  return getCardsByIds(cards, state.carryoverRequiredCardIds).filter(
    (card) => !handledCardIds.has(card.id)
  );
}

export function getRemainingFreshRequiredCards(
  state: DailyReviewState | null,
  cards: Card[]
) {
  if (!state) {
    return [];
  }

  const handledCardIds = getHandledRequiredCardIds(state);
  const carryoverCardIds = new Set(state.carryoverRequiredCardIds);
  return getCardsByIds(cards, state.requiredCardIds).filter(
    (card) => !carryoverCardIds.has(card.id) && !handledCardIds.has(card.id)
  );
}

/** What is left of today's Daily Review, split the way Learn offers it. */
export function getRemainingDailyReview(state: DailyReviewState | null, cards: Card[]) {
  const carryover = getRemainingCarryoverRequiredCards(state, cards);
  const fresh = getRemainingFreshRequiredCards(state, cards);
  const completedOptional = new Set(state?.completedOptionalCardIds ?? []);
  const optional = state
    ? getCardsByIds(cards, state.optionalCardIds).filter((card) => !completedOptional.has(card.id))
    : [];
  return { carryover, fresh, required: [...carryover, ...fresh], optional };
}

/** Whether a session held nothing but cards carried over from an earlier day. */
export function isCarryoverOnly(state: DailyReviewState | null, sessionCards: Card[]) {
  const carryover = new Set(state?.carryoverRequiredCardIds ?? []);
  return sessionCards.length > 0 && sessionCards.every((card) => carryover.has(card.id));
}

export function buildDailyReviewQueues(cards: Card[], now: number, carryoverCardIds: string[] = []) {
  const eligibleCards = cards.filter((card) => isCardEligibleForDailyReview(card, now));
  const { neverReviewedCards, weakCards, mediumCards, easyCards } = sortCardsForDailyReview(eligibleCards, now);
  const freshRequiredCards = [...neverReviewedCards, ...weakCards, ...mediumCards];
  const freshRequiredIdSet = new Set(freshRequiredCards.map((card) => card.id));
  const carryoverCards = getCardsByIds(cards, carryoverCardIds).filter(
    (card) => !freshRequiredIdSet.has(card.id)
  );
  const carryoverIdSet = new Set(carryoverCards.map((card) => card.id));

  return {
    carryoverRequiredCards: carryoverCards,
    requiredCards: [
      ...carryoverCards,
      ...freshRequiredCards.filter((card) => !carryoverIdSet.has(card.id)),
    ],
    optionalCards: easyCards.filter((card) => !carryoverIdSet.has(card.id)),
  };
}

export function buildDailyReviewStateData(
  cards: Card[],
  now: number,
  previousState: DailyReviewState | null = null
): DailyReviewStateData {
  const studyDayKey = getStudyDayKey(now);
  const carryoverRequiredCardIds =
    previousState && previousState.studyDayKey !== studyDayKey
      ? getUnfinishedRequiredCardIds(previousState, cards)
      : previousState?.carryoverRequiredCardIds ?? [];
  const { requiredCards, optionalCards, carryoverRequiredCards } = buildDailyReviewQueues(
    cards,
    now,
    carryoverRequiredCardIds
  );

  return {
    studyDayKey,
    generatedAt: now,
    requiredCardIds: requiredCards.map((card) => card.id),
    optionalCardIds: optionalCards.map((card) => card.id),
    carryoverRequiredCardIds: carryoverRequiredCards.map((card) => card.id),
    completedRequiredCardIds: [],
    completedOptionalCardIds: [],
    parkedRequiredCardIds: [],
    requiredRetryCounts: {},
    updatedAt: now,
  };
}

export function shouldPauseDailyReviewStateRefresh(
  state: DailyReviewState | null,
  activeSession: PersistedStudySession | null
) {
  return Boolean(
    state &&
      activeSession &&
      activeSession.status === "active" &&
      activeSession.kind !== "custom" &&
      state.studyDayKey === activeSession.studyDayKey
  );
}

function areSameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function keepKnownIds(ids: string[], allowedIds: Set<string>) {
  return ids.filter((id) => allowedIds.has(id));
}

function keepKnownRetryCounts(retryCounts: Record<string, number>, allowedIds: Set<string>) {
  return Object.fromEntries(Object.entries(retryCounts).filter(([cardId]) => allowedIds.has(cardId)));
}

/** Today's state with its queues brought up to date with `cards`, or null when nothing changed. */
function refreshCurrentDailyReviewState(
  state: DailyReviewState,
  cards: Card[],
  now: number
): DailyReviewStateData | null {
  const { requiredCards, optionalCards, carryoverRequiredCards } = buildDailyReviewQueues(
    cards,
    now,
    state.carryoverRequiredCardIds
  );
  const requiredCardIds = requiredCards.map((card) => card.id);
  const optionalCardIds = optionalCards.map((card) => card.id);
  const carryoverRequiredCardIds = carryoverRequiredCards.map((card) => card.id);
  const requiredIdSet = new Set(requiredCardIds);
  const optionalIdSet = new Set(optionalCardIds);
  const completedRequiredCardIds = keepKnownIds(state.completedRequiredCardIds, requiredIdSet);
  const completedOptionalCardIds = keepKnownIds(state.completedOptionalCardIds, optionalIdSet);
  const parkedRequiredCardIds = keepKnownIds(state.parkedRequiredCardIds, requiredIdSet);
  const requiredRetryCounts = keepKnownRetryCounts(state.requiredRetryCounts, requiredIdSet);

  const changed =
    !areSameIds(state.requiredCardIds, requiredCardIds) ||
    !areSameIds(state.optionalCardIds, optionalCardIds) ||
    !areSameIds(state.carryoverRequiredCardIds, carryoverRequiredCardIds) ||
    !areSameIds(state.completedRequiredCardIds, completedRequiredCardIds) ||
    !areSameIds(state.completedOptionalCardIds, completedOptionalCardIds) ||
    !areSameIds(state.parkedRequiredCardIds, parkedRequiredCardIds) ||
    Object.keys(state.requiredRetryCounts).length !== Object.keys(requiredRetryCounts).length;

  if (!changed) {
    return null;
  }

  return {
    studyDayKey: state.studyDayKey,
    generatedAt: state.generatedAt,
    requiredCardIds,
    optionalCardIds,
    carryoverRequiredCardIds,
    completedRequiredCardIds,
    completedOptionalCardIds,
    parkedRequiredCardIds,
    requiredRetryCounts,
    updatedAt: now,
  };
}

export type DailyReviewStatePlan = {
  state: DailyReviewState;
  /** What to store in its place, or null when the stored state is already right. */
  save: DailyReviewStateData | null;
};

/**
 * Today's Daily Review for `cards`, worked out from what is stored.
 *
 * Left as it is while a session is under way on it, brought up to date with
 * the cards when it is already today's, and built afresh on a new study day,
 * carrying over what the last one left unfinished. Nothing is written here:
 * Learn draws its first look from this before the server's cards arrive, and
 * saves only what it works out from those.
 */
export function planDailyReviewState(
  existing: DailyReviewState | null,
  cards: Card[],
  now: number,
  activeSession: PersistedStudySession | null
): DailyReviewStatePlan {
  if (existing && shouldPauseDailyReviewStateRefresh(existing, activeSession)) {
    return { state: existing, save: null };
  }

  if (existing?.studyDayKey === getStudyDayKey(now)) {
    const refreshed = refreshCurrentDailyReviewState(existing, cards, now);
    return refreshed
      ? { state: { id: existing.id, ...refreshed }, save: refreshed }
      : { state: existing, save: null };
  }

  const save = buildDailyReviewStateData(cards, now, existing);
  return { state: { id: DAILY_REVIEW_STATE_DOC_ID, ...save }, save };
}
