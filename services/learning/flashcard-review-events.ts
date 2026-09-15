import { doc, setDoc } from "firebase/firestore";
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
 * The event is keyed by the answer's commit id and written as a plain create.
 * A write queues with Firestore's own offline persistence, so a connection
 * that drops mid-sync delays the event rather than losing it -- which a
 * transaction, needing the server at that moment, did not. The rules allow an
 * event to be created and never changed, so a sync that retries an answer
 * already recorded is refused instead of writing it twice.
 *
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
  try {
    await withTimeout(setDoc(eventRef, write), RECORD_MS, "Record flashcard review event");
    return "recorded";
  } catch (error) {
    // Refused as an update: this answer's event already exists.
    if ((error as { code?: unknown } | null)?.code === "permission-denied") return "already-recorded";
    throw error;
  }
}
