import {
  markedAnswerWeight,
  readMarkedAnswer,
  type StoredMarkedAnswer,
} from "@/lib/learning/profile/marked-answer";
import type { LearningObservation } from "@/lib/learning/types";

export type PastPaperEvidenceAttempt = {
  id: string;
  questionId: string;
  attemptNumber: number;
  markedAt?: number;
  updatedAt: number;
  /**
   * Specification topic ids, already checked against a servable catalogue by
   * whoever loaded the attempt.
   */
  topicIds: string[];
  /** Specification concept ids, checked the same way. */
  conceptIds?: string[];
  /** The command word the question opened with, where it printed one. */
  commandWord?: string;
  result?: StoredMarkedAnswer;
};

/**
 * A guided retry counts for half.
 *
 * The student has just read the feedback on this exact question, so a better
 * second answer is real evidence of learning but not the same evidence as
 * answering cold -- and it must not be able to erase the first attempt.
 */
export const PAST_PAPER_RETRY_WEIGHT = 0.5;

/** Only marked attempts should be passed in; anything unreadable is skipped. */
export function pastPaperObservations(
  attempts: readonly PastPaperEvidenceAttempt[]
): LearningObservation[] {
  return attempts.flatMap((attempt): LearningObservation[] => {
    const marked = readMarkedAnswer(attempt.result);
    if (!marked || !attempt.questionId || !attempt.id) return [];
    return [
      {
        kind: "past-paper",
        evidenceId: attempt.id,
        itemId: `exam:${attempt.questionId}`,
        topicKeys: Array.from(new Set([...attempt.topicIds, ...(attempt.conceptIds ?? [])])).map(
          (id) => `spec:${id}`
        ),
        score: marked.score,
        weight:
          markedAnswerWeight(marked.maxMarks) *
          (attempt.attemptNumber > 1 ? PAST_PAPER_RETRY_WEIGHT : 1),
        count: 1,
        at: attempt.markedAt ?? attempt.updatedAt,
        trendEligible: true,
        errorChecks: marked.errorChecks,
        ...(attempt.commandWord ? { commandWord: attempt.commandWord } : {}),
      },
    ];
  });
}
