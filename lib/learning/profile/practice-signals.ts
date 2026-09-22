import {
  markedAnswerWeight,
  readMarkedAnswer,
  type StoredMarkedAnswer,
} from "@/lib/learning/profile/marked-answer";
import type { LearningObservation } from "@/lib/learning/types";

export type PracticePaperEvidenceAttempt = {
  id: string;
  paperId: string;
  /** Whether Tutor was available during the sitting. */
  assisted: boolean;
  markedAt?: number;
  updatedAt: number;
  questionResults: readonly (StoredMarkedAnswer & { questionId?: unknown })[];
  /**
   * The specification concepts each of the paper's questions was written
   * against, by question id, where the paper recorded them.
   *
   * Supplied by the caller rather than stored on the attempt: the concepts
   * belong to the question, and a question re-tagged later should not leave
   * every past sitting of it saying something different.
   */
  conceptIdsByQuestion?: Readonly<Record<string, readonly string[]>>;
};

/**
 * A sitting with Tutor switched on counts for half, and does not take part in
 * trends: help was available, so the marks say less about what the student
 * could do alone, and a run of assisted sittings would read as improvement.
 */
export const ASSISTED_PRACTICE_WEIGHT = 0.5;

/**
 * One observation per marked question.
 *
 * A question whose paper recorded the concepts it was written against counts
 * towards those concepts, and towards everything above them. A question with
 * none -- every paper generated before questions were tagged -- still shapes
 * recurring errors and the overall trend, and still counts towards no concept
 * at all. Guessing a concept from the question wording is exactly the kind of
 * inference the engine does not make, so an untagged question stays untagged.
 */
export function practicePaperObservations(
  attempts: readonly PracticePaperEvidenceAttempt[]
): LearningObservation[] {
  return attempts.flatMap((attempt) =>
    attempt.questionResults.flatMap((questionResult, index): LearningObservation[] => {
      const marked = readMarkedAnswer(questionResult);
      if (!marked || !attempt.id || !attempt.paperId) return [];
      const questionId =
        typeof questionResult.questionId === "string" && questionResult.questionId
          ? questionResult.questionId
          : `q${index + 1}`;
      return [
        {
          kind: "practice",
          evidenceId: `${attempt.id}:${questionId}`,
          itemId: `paper:${attempt.paperId}:${questionId}`,
          topicKeys: (attempt.conceptIdsByQuestion?.[questionId] ?? []).map(
            (conceptId) => `spec:${conceptId}`
          ),
          score: marked.score,
          weight:
            markedAnswerWeight(marked.maxMarks) *
            (attempt.assisted ? ASSISTED_PRACTICE_WEIGHT : 1),
          count: 1,
          at: attempt.markedAt ?? attempt.updatedAt,
          trendEligible: !attempt.assisted,
          errorChecks: marked.errorChecks,
        },
      ];
    })
  );
}
