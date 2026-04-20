import type { Deck } from "@/services/study/decks";
import type { Card } from "@/lib/study/cards";
import type { CardRating } from "@/lib/study/scheduler";

const SNAPSHOT_PREFIX = "jami:offline-study:snapshot:";
const QUEUE_PREFIX = "jami:offline-study:queue:";

export type OfflineStudySnapshot = {
  userId: string;
  savedAt: number;
  cards: Card[];
  decks: Deck[];
};

export type OfflineQueuedReview = {
  id: string;
  userId: string;
  cardId: string;
  rating: CardRating;
  reviewedAt: number;
  studyDayKey: string;
  isCorrect: boolean;
  durationMs?: number;
  sessionKind: "daily-required" | "daily-optional" | "custom";
  cardUpdates: Record<string, number | string>;
  clearMemoryRiskOverrideDayKey?: boolean;
};

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getSnapshotKey(userId: string) {
  return `${SNAPSHOT_PREFIX}${userId}`;
}

function getQueueKey(userId: string) {
  return `${QUEUE_PREFIX}${userId}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseLocalStorage()) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Offline caching is best-effort; storage can be unavailable or full.
  }
}

export function saveOfflineStudySnapshot(
  userId: string,
  snapshot: Pick<OfflineStudySnapshot, "cards" | "decks">
) {
  writeJson<OfflineStudySnapshot>(getSnapshotKey(userId), {
    userId,
    savedAt: Date.now(),
    cards: snapshot.cards,
    decks: snapshot.decks,
  });
}

export function loadOfflineStudySnapshot(userId: string) {
  const snapshot = readJson<OfflineStudySnapshot | null>(getSnapshotKey(userId), null);
  return snapshot?.userId === userId ? snapshot : null;
}

export function getOfflineQueuedReviews(userId: string) {
  return readJson<OfflineQueuedReview[]>(getQueueKey(userId), []).filter(
    (review) => review.userId === userId
  );
}

export function queueOfflineStudyReview(review: Omit<OfflineQueuedReview, "id">) {
  const queuedReview: OfflineQueuedReview = {
    ...review,
    id: `${review.reviewedAt}-${review.cardId}-${Math.random().toString(36).slice(2)}`,
  };
  const current = getOfflineQueuedReviews(review.userId);
  writeJson(getQueueKey(review.userId), [...current, queuedReview]);
  return queuedReview;
}

export function removeOfflineQueuedReviews(userId: string, reviewIds: string[]) {
  if (reviewIds.length === 0) return;

  const toRemove = new Set(reviewIds);
  const remaining = getOfflineQueuedReviews(userId).filter(
    (review) => !toRemove.has(review.id)
  );
  writeJson(getQueueKey(userId), remaining);
}
