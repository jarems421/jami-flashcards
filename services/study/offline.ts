import { recordStudyReview } from "@/services/study/activity";
import { updateCardAfterReview } from "@/services/study/cards";
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
} from "@/lib/study/offline-study";

export async function syncOfflineStudyReviews(userId: string) {
  const reviews = getOfflineQueuedReviews(userId);
  const syncedIds: string[] = [];
  const currentStudyDayKey = getStudyDayKey(Date.now());

  for (const review of reviews) {
    try {
      const tasks: Promise<unknown>[] = [
        recordStudyReview(userId, review.reviewedAt, {
          isCorrect: review.isCorrect,
          durationMs: review.durationMs,
          sessionKind: review.sessionKind === "custom" ? "custom" : "daily",
        }),
        applyGoalProgressForAnswer(userId, review.isCorrect, review.reviewedAt, {
          deckId: review.deckId,
          topicIds: review.topicIds,
          folderIds: review.folderIds,
        }),
      ];

      if (
        Object.keys(review.cardUpdates).length > 0 ||
        review.clearMemoryRiskOverrideDayKey
      ) {
        tasks.push(
          updateCardAfterReview(review.cardId, {
            values: review.cardUpdates,
            clearMemoryRiskOverrideDayKey:
              review.clearMemoryRiskOverrideDayKey,
          })
        );
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
