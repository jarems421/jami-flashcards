import { getStudyDayKey } from "@/lib/study/day";
import {
  getOfflineQueuedReviews,
  removeOfflineQueuedReviews,
} from "@/lib/study/offline-study";
import {
  isStudyReviewPersisting,
  persistStudyReview,
} from "@/services/study/review-persistence";

/**
 * Sends every answer still held on this device, in the order they were given.
 *
 * An answer already saving behind the session is left to finish on its own
 * rather than written twice.
 */
export async function syncOfflineStudyReviews(userId: string) {
  const reviews = getOfflineQueuedReviews(userId);
  const syncedIds: string[] = [];
  const currentStudyDayKey = getStudyDayKey(Date.now());

  for (const review of reviews) {
    if (isStudyReviewPersisting(review.id)) continue;
    try {
      await persistStudyReview(userId, review, currentStudyDayKey);
      syncedIds.push(review.id);
    } catch (error) {
      console.warn("Offline review sync failed; keeping review queued.", error);
    }
  }

  removeOfflineQueuedReviews(userId, syncedIds);

  return {
    attempted: reviews.length,
    synced: syncedIds.length,
    remaining: reviews.length - syncedIds.length,
  };
}
