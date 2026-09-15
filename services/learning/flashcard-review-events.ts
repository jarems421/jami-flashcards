import { doc, runTransaction } from "firebase/firestore";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  FLASHCARD_REVIEW_EVENTS_COLLECTION,
  buildFlashcardReviewEventWrite,
  flashcardReviewEventId,
} from "@/lib/learning/events/flashcard-review-event";
import type { OfflineQueuedReview } from "@/lib/study/offline-study";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";

const RECORD_MS = 30_000;

export type FlashcardReviewEventOutcome = "recorded" | "already-recorded" | "skipped";

/**
 * Records one flashcard answer in the student's learning history.
 *
 * The event is keyed by the answer's commit id and written only if it is not
 * already there, so the sync retrying an answer never records it twice.
 * Callers treat this as best-effort: it must never decide whether an answer
 * saved.
 */
export async function recordFlashcardReviewEvent(
  userId: string,
  review: OfflineQueuedReview,
  now = Date.now()
): Promise<FlashcardReviewEventOutcome> {
  if (!featureFlags.enableFlashcardReviewEvents) return "skipped";
  const eventId = flashcardReviewEventId(review);
  const write = buildFlashcardReviewEventWrite(review, now);
  if (!userId.trim() || !eventId || !write) return "skipped";

  const eventRef = doc(db, "users", userId, FLASHCARD_REVIEW_EVENTS_COLLECTION, eventId);
  return withTimeout(
    runTransaction(db, async (transaction): Promise<FlashcardReviewEventOutcome> => {
      const existing = await transaction.get(eventRef);
      if (existing.exists()) return "already-recorded";
      transaction.set(eventRef, write);
      return "recorded";
    }),
    RECORD_MS,
    "Record flashcard review event"
  );
}
