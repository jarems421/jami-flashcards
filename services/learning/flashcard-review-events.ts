import { collection, doc, getDocs, limit, query, setDoc, where } from "firebase/firestore";
import type { DiagramConfusionEvent } from "@/lib/study/diagram-confusion";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  FLASHCARD_REVIEW_EVENTS_COLLECTION,
  buildFlashcardReviewEventWrite,
  decodeFlashcardReviewEvent,
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
 * Firestore holds the write in memory while a connection drops mid-sync, so
 * the drop delays the event rather than losing it -- which a transaction,
 * needing the server at that moment, did not. Memory does not survive a
 * reload, so the answer stays queued on the device until this has finished
 * (see `persistStudyReview`). The rules allow an event to be created and never
 * changed, so a sync that retries an answer already recorded is refused
 * instead of writing it twice.
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

/** Firestore takes at most thirty values in an `in` filter. */
const IN_FILTER_LIMIT = 30;
const CONFUSIONS_PER_CHUNK = 200;

/**
 * The recorded mix-ups on some diagram cards: which card was asked, which
 * other label was given instead, and when. Ids and times only; nothing a
 * student wrote.
 *
 * Best effort, like everything the Learning Engine reads for display: an
 * empty list is what a failure looks like, and nothing about studying waits
 * on it.
 */
export async function loadDiagramConfusionEvents(
  userId: string,
  cardIds: readonly string[]
): Promise<DiagramConfusionEvent[]> {
  if (!featureFlags.enableFlashcardReviewEvents || !userId.trim() || cardIds.length === 0) return [];
  const events = collection(db, "users", userId, FLASHCARD_REVIEW_EVENTS_COLLECTION);
  const chunks: string[][] = [];
  for (let start = 0; start < cardIds.length; start += IN_FILTER_LIMIT) {
    chunks.push(cardIds.slice(start, start + IN_FILTER_LIMIT));
  }
  try {
    const snapshots = await Promise.all(
      chunks.map((chunk) =>
        withTimeout(
          getDocs(
            query(events, where("cardId", "in", chunk), where("confusedWithLabelId", ">", ""), limit(CONFUSIONS_PER_CHUNK))
          ),
          RECORD_MS,
          "Load diagram mix-ups"
        )
      )
    );
    return snapshots.flatMap((snapshot) =>
      snapshot.docs.flatMap((eventDoc) => {
        const event = decodeFlashcardReviewEvent(eventDoc.id, eventDoc.data());
        return event?.confusedWithLabelId
          ? [{ cardId: event.cardId, confusedWithLabelId: event.confusedWithLabelId, reviewedAt: event.reviewedAt }]
          : [];
      })
    );
  } catch (error) {
    console.warn("Diagram mix-ups could not be loaded.", error);
    return [];
  }
}
