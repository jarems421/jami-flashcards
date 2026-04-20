import { deleteField, doc, updateDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { recordStudyReview } from "@/services/study/activity";
import {
  markDailyReviewCardComplete,
  recordDailyReviewWeakAttempt,
} from "@/services/study/daily-review";
import { applyGoalProgressForAnswer } from "@/services/study/goals";
import { getStudyDayKey } from "@/lib/study/day";
import { isStruggleRating } from "@/lib/study/scheduler";
import {
  getOfflineQueuedReviews,
  removeOfflineQueuedReviews,
  type OfflineQueuedReview,
} from "@/lib/study/offline-study";

function buildCardUpdates(review: OfflineQueuedReview) {
  const updates: Record<string, unknown> = { ...review.cardUpdates };
  if (review.clearMemoryRiskOverrideDayKey) {
    updates.memoryRiskOverrideDayKey = deleteField();
  }
  return updates;
}

export async function syncOfflineStudyReviews(userId: string) {
  const reviews = getOfflineQueuedReviews(userId);
  const syncedIds: string[] = [];
  const currentStudyDayKey = getStudyDayKey(Date.now());

  for (const review of reviews) {
    try {
      const cardUpdates = buildCardUpdates(review);
      const tasks: Promise<unknown>[] = [
        recordStudyReview(userId, review.reviewedAt, {
          isCorrect: review.isCorrect,
          durationMs: review.durationMs,
          sessionKind: review.sessionKind === "custom" ? "custom" : "daily",
        }),
        applyGoalProgressForAnswer(userId, review.isCorrect, review.reviewedAt),
      ];

      if (Object.keys(cardUpdates).length > 0) {
        tasks.push(updateDoc(doc(db, "cards", review.cardId), cardUpdates));
      }

      if (review.studyDayKey === currentStudyDayKey) {
        if (review.sessionKind === "daily-required") {
          if (isStruggleRating(review.rating)) {
            tasks.push(recordDailyReviewWeakAttempt(userId, review.cardId, review.reviewedAt));
          } else {
            tasks.push(markDailyReviewCardComplete(userId, review.cardId, "required"));
          }
        }

        if (review.sessionKind === "daily-optional") {
          tasks.push(markDailyReviewCardComplete(userId, review.cardId, "optional"));
        }
      }

      await Promise.all(tasks);
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
