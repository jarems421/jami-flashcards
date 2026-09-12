import { recordStudyReview } from "@/services/study/activity";
import { updateCardAfterReview, recordSimpleStudyResult } from "@/services/study/cards";
import { reserveStudyCommit, clearStudyCommitDraft } from "@/services/study/commit-intent";
import { buildCardReviewUpdateCommand } from "@/lib/study/card-review";
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
      if (review.intent) {
        const saved = await reserveStudyCommit(userId, review.intent, false);
        // Another tab may already have frozen the decision. Replay that decision,
        // not the conflicting local draft, through every remaining effect.
        review.intent = saved;
        review.rating = saved.rating;
        review.reviewedAt = saved.answeredAt;
        review.isCorrect = saved.rating === "good" || saved.rating === "easy";
        review.studyDayKey = getStudyDayKey(saved.answeredAt);
        review.deckId = saved.context.deckId;
        review.topicIds = saved.context.topicIds;
        review.folderIds = saved.context.folderIds;
      }
      if (review.sessionKind === "simple") {
        await recordSimpleStudyResult(review.cardId, review.isCorrect ? "correct" : "wrong", review.reviewedAt, { userId, commitId: review.commitId ?? review.id });
        clearStudyCommitDraft(userId, review.commitId ?? review.id);
        syncedIds.push(review.id);
        continue;
      }
      const tasks: Promise<unknown>[] = [
        recordStudyReview(userId, review.reviewedAt, {
          commitId: review.commitId ?? review.id,
          isCorrect: review.isCorrect,
          durationMs: review.durationMs,
          sessionKind: review.sessionKind === "custom" ? "custom" : "daily",
        }),
        applyGoalProgressForAnswer(userId, review.isCorrect, review.reviewedAt, {
          deckId: review.deckId,
          topicIds: review.topicIds,
          folderIds: review.folderIds,
        }, review.commitId ?? review.id),
      ];

      if (
        review.intent || Object.keys(review.cardUpdates).length > 0 ||
        review.clearMemoryRiskOverrideDayKey
      ) {
        tasks.push(
          updateCardAfterReview(review.cardId, review.intent ? buildCardReviewUpdateCommand({ schedule: review.intent.schedule, isCorrect: review.isCorrect, isStruggle: isStruggleRating(review.rating), reviewedAt: review.reviewedAt }) : {
            values: review.cardUpdates,
            clearMemoryRiskOverrideDayKey:
              review.clearMemoryRiskOverrideDayKey,
          }, { userId, commitId: review.commitId ?? review.id })
        );
      }

      if (review.studyDayKey === currentStudyDayKey) {
        if (review.sessionKind === "daily-required") {
          if (isStruggleRating(review.rating)) {
            tasks.push(recordDailyReviewWeakAttempt(userId, review.cardId, review.reviewedAt, review.commitId ?? review.id));
          } else {
            tasks.push(markDailyReviewCardComplete(userId, review.cardId, "required"));
          }
        }

        if (review.sessionKind === "daily-optional") {
          tasks.push(markDailyReviewCardComplete(userId, review.cardId, "optional"));
        }
      }

      await Promise.all(tasks);
      clearStudyCommitDraft(userId, review.commitId ?? review.id);
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
