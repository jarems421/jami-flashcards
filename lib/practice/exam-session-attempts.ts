import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import type { ExamSessionQuestionRun } from "@/lib/practice/exam-question-groups";
import type { ExamSessionQuestion } from "@/lib/practice/exam-questions";

type AttemptLike = Pick<PublicExamAttempt, "id" | "status">;

/**
 * Which of a question's attempts is in front of the student.
 *
 * Every question has a first attempt and may have one retry, whose id is the
 * first's with `_2` in place of `_1`. While the retry is open it is the one
 * being answered, and the mark shown is the retry's once it has one -- the
 * first attempt's until then.
 */
export function examQuestionAttempts<Attempt extends AttemptLike>(
  question: Pick<ExamSessionQuestion, "attemptId"> | undefined,
  attempts: readonly Attempt[]
) {
  const firstAttempt = question ? attempts.find((item) => item.id === question.attemptId) : undefined;
  const retryId = question?.attemptId.replace(/_1$/, "_2");
  const retryAttempt = retryId ? attempts.find((item) => item.id === retryId) : undefined;
  const retryOpen = Boolean(retryAttempt && retryAttempt.status !== "marked");
  const activeAttempt = retryOpen ? retryAttempt : firstAttempt;
  const markedAttempt =
    retryAttempt?.status === "marked"
      ? retryAttempt
      : firstAttempt?.status === "marked"
        ? firstAttempt
        : undefined;
  return { firstAttempt, retryId, retryAttempt, retryOpen, activeAttempt, markedAttempt };
}

/**
 * How many of the session's questions are marked.
 *
 * A question counts once all of its parts are: 3(a) marked and 3(b) still
 * blank is a question still to finish, and calling it done would be the same
 * miscount the other way round. Only first attempts count, as the session's
 * score does.
 */
export function countMarkedExamQuestions(
  runs: readonly Pick<ExamSessionQuestionRun, "from" | "count">[],
  parts: readonly Pick<ExamSessionQuestion, "id">[],
  attempts: readonly Pick<PublicExamAttempt, "questionId" | "attemptNumber" | "status">[]
) {
  const markedPartIds = new Set(
    attempts
      .filter((item) => item.attemptNumber === 1 && item.status === "marked")
      .map((item) => item.questionId)
  );
  return runs.filter((run) =>
    parts.slice(run.from, run.from + run.count).every((part) => markedPartIds.has(part.id))
  ).length;
}
