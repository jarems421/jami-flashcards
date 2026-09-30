import type { Card, CardReviewValueUpdates } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
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
  commitId?: string;
  id: string;
  userId: string;
  cardId: string;
  rating: CardRating;
  reviewedAt: number;
  studyDayKey: string;
  isCorrect: boolean;
  deckId?: string;
  topicIds?: string[];
  folderIds?: string[];
  durationMs?: number;
  sessionKind: "daily-required" | "daily-optional" | "custom" | "simple";
  intent?: import("@/services/study/commit-intent").StudyCommitIntent;
  /**
   * The recommendation whose session this answer was given in, when one opened
   * it. See `lib/learning/events/study-action-event.ts`.
   *
   * Carried on the answer rather than inferred later because timestamps cannot
   * do this job: a student starts nine cards, does six, comes back two days
   * later and studies something else entirely. Without the id, deciding which
   * evidence belongs to which intervention is guesswork dressed as a window.
   */
  interventionId?: string;
  cardUpdates: CardReviewValueUpdates;
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
    // Corrupt or unavailable device storage falls back to the server snapshot.
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

/**
 * How long a queued answer may sit before it is worth mentioning.
 *
 * Every answer is written to this queue before it is sent, so the queue being
 * non-empty is the normal state of a session that is working perfectly -- it is
 * what makes an answer survive a closed tab. Telling a student their answers
 * are "waiting to sync" the instant they answer describes the durability
 * mechanism, not a problem, and it appeared on every single card.
 *
 * Past this, something is actually wrong: the write failed, or the connection
 * went while the request was in flight. That is worth a line on screen. Before
 * it, the answer is simply in flight, and saving is not news.
 */
export const OFFLINE_SYNC_GRACE_MS = 20_000;

export function getOfflineQueuedReviews(userId: string) {
  return readJson<OfflineQueuedReview[]>(getQueueKey(userId), []).filter(
    (review) => review.userId === userId
  );
}

/**
 * The answers that have stopped moving, which is what a student needs told.
 *
 * Measured from when the answer was given rather than from a retry counter,
 * because the student's question is "has my work been lost", and the honest
 * answer to that is about how long it has been sitting here.
 */
export function getStuckOfflineReviews(
  userId: string,
  now = Date.now(),
  graceMs = OFFLINE_SYNC_GRACE_MS
) {
  return getOfflineQueuedReviews(userId).filter(
    (review) => now - review.reviewedAt >= graceMs
  );
}

export function queueOfflineStudyReview(review: Omit<OfflineQueuedReview, "id">) {
  const queuedReview: OfflineQueuedReview = {
    ...review,
    id: review.commitId ?? `${review.reviewedAt}-${review.cardId}-${Math.random().toString(36).slice(2)}`,
  };
  const current = getOfflineQueuedReviews(review.userId);
  const existing = current.find((entry) => entry.id === queuedReview.id);
  if (existing) return existing;
  writeJson(getQueueKey(review.userId), [...current, queuedReview]);
  if (!getOfflineQueuedReviews(review.userId).some((entry) => entry.id === queuedReview.id)) {
    throw new Error("This device could not save your answer for syncing.");
  }
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
