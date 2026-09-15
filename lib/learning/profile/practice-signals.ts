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
 * Practice-paper questions carry no topic, so these observations shape the
 * recurring errors and the overall trend but never a topic's mastery. Guessing
 * a topic from the question wording is exactly the kind of inference the
 * engine does not make.
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
          topicKeys: [],
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
