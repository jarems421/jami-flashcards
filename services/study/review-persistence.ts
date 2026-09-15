import { buildCardReviewUpdateCommand } from "@/lib/study/card-review";
import { getStudyDayKey } from "@/lib/study/day";
import type { OfflineQueuedReview } from "@/lib/study/offline-study";
import { parkedRiskValues, type ReviewRetryResult } from "@/lib/study/review-outcome";
import { isStruggleRating } from "@/lib/study/scheduler";
import { recordStudyReview } from "@/services/study/activity";
import { recordSimpleStudyResult, updateCardAfterReview } from "@/services/study/cards";
import { clearStudyCommitDraft, reserveStudyCommit } from "@/services/study/commit-intent";
import {
  markDailyReviewCardComplete,
  recordDailyReviewWeakAttempt,
} from "@/services/study/daily-review";
import { applyGoalProgressForAnswer } from "@/services/study/goals";
import { recordFlashcardReviewEvent } from "@/services/learning/flashcard-review-events";

export type PersistedStudyReview = {
  goalProgress: Awaited<ReturnType<typeof applyGoalProgressForAnswer>> | null;
  retryResult: ReviewRetryResult | null;
};

/** Reviews being written right now, so a sync never starts a second copy of one. */
const persisting = new Set<string>();

export function isStudyReviewPersisting(reviewId: string) {
  return persisting.has(reviewId);
}

/**
 * Adds a saved answer to the student's learning history, without waiting.
 *
 * Only after the answer itself has saved. The history improves what the
 * Learning Engine can see; it never decides whether an answer saved, so a
 * failure here is dropped rather than holding the answer in the review queue.
 */
function recordLearningHistory(userId: string, review: OfflineQueuedReview) {
  void recordFlashcardReviewEvent(userId, review).catch(() => undefined);
}

/**
 * Writes one answer to the server: the answer itself, the card, the day's
 * activity, goals and Daily Review.
 *
 * The one road for both a live answer saving behind the session and a queued
 * answer syncing later. Every write carries the answer's commit id and commits
 * with a receipt, so running this twice for the same answer -- a retry, or a
 * sync overlapping a background save -- never counts it twice.
 *
 * Throws on failure; the answer stays queued on the device for the next try.
 */
export async function persistStudyReview(
  userId: string,
  queued: OfflineQueuedReview,
  currentStudyDayKey = getStudyDayKey(Date.now())
): Promise<PersistedStudyReview> {
  persisting.add(queued.id);
  try {
    const review = { ...queued };
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
    const commitId = review.commitId ?? review.id;
    const identity = { userId, commitId };

    if (review.sessionKind === "simple") {
      await recordSimpleStudyResult(review.cardId, review.isCorrect ? "correct" : "wrong", review.reviewedAt, identity);
      recordLearningHistory(userId, review);
      clearStudyCommitDraft(userId, commitId);
      return { goalProgress: null, retryResult: null };
    }

    const isStruggle = isStruggleRating(review.rating);
    const goalProgressPromise = applyGoalProgressForAnswer(
      userId,
      review.isCorrect,
      review.reviewedAt,
      { deckId: review.deckId, topicIds: review.topicIds, folderIds: review.folderIds },
      commitId
    );
    const tasks: Promise<unknown>[] = [
      recordStudyReview(userId, review.reviewedAt, {
        commitId,
        isCorrect: review.isCorrect,
        durationMs: review.durationMs,
        sessionKind: review.sessionKind === "custom" ? "custom" : "daily",
      }),
      goalProgressPromise,
    ];

    if (
      review.intent ||
      Object.keys(review.cardUpdates).length > 0 ||
      review.clearMemoryRiskOverrideDayKey
    ) {
      tasks.push(
        updateCardAfterReview(
          review.cardId,
          review.intent
            ? buildCardReviewUpdateCommand({
                schedule: review.intent.schedule,
                isCorrect: review.isCorrect,
                isStruggle,
                reviewedAt: review.reviewedAt,
              })
            : {
                values: review.cardUpdates,
                clearMemoryRiskOverrideDayKey: review.clearMemoryRiskOverrideDayKey,
              },
          identity
        )
      );
    }

    let retryResultPromise: Promise<ReviewRetryResult> | null = null;
    // An answer from an earlier study day no longer belongs to today's Daily Review.
    if (review.studyDayKey === currentStudyDayKey) {
      if (review.sessionKind === "daily-required") {
        if (isStruggle) {
          retryResultPromise = recordDailyReviewWeakAttempt(userId, review.cardId, review.reviewedAt, commitId);
          tasks.push(retryResultPromise);
        } else {
          tasks.push(markDailyReviewCardComplete(userId, review.cardId, "required"));
        }
      }
      if (review.sessionKind === "daily-optional") {
        tasks.push(markDailyReviewCardComplete(userId, review.cardId, "optional"));
      }
    }

    await Promise.all(tasks);
    const retryResult = retryResultPromise ? await retryResultPromise : null;
    /*
     * A card out of attempts carries tomorrow's risk. The server decides that,
     * so it is written once the retry count comes back -- which a queued answer
     * that synced later never did before.
     */
    if (retryResult?.parked) {
      await updateCardAfterReview(
        review.cardId,
        { values: parkedRiskValues(review.reviewedAt) },
        identity,
        "parked-risk"
      );
    }

    recordLearningHistory(userId, review);
    clearStudyCommitDraft(userId, commitId);
    return { goalProgress: await goalProgressPromise, retryResult };
  } finally {
    persisting.delete(queued.id);
  }
}
