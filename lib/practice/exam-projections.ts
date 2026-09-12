import {
  examAnswerUnlocksModelAnswer,
  examDocument,
  examResultForAttempt,
  type ExamAttempt,
  type ExamQuestion,
  type ExamSessionQuestion,
} from "@/lib/practice/exam-questions";
import type { PracticePaperQuestionResult } from "@/lib/practice/practice-papers";
import { candidateExamAssets } from "@/lib/practice/exam-assets";
import type { ExamSession } from "@/lib/practice/exam-questions";

export type PublicExamQuestionResult = Omit<PracticePaperQuestionResult, "confidence">;

export type PublicExamAttempt = Omit<
  ExamAttempt,
  | "audit"
  | "result"
  | "statsContributionFraction"
  | "workingSnapshotPath"
  | "marking"
  | "review"
  | "reviewKey"
  | "reviewAudit"
> & {
  result?: PublicExamQuestionResult;
};

/** Keep model-routing, calibration and private evidence details server-side. */
export function projectExamAttempt(
  id: string,
  value: Record<string, unknown>,
): PublicExamAttempt {
  const attempt = value as unknown as ExamAttempt;
  const result = attempt.status === "marked" && attempt.result
    ? { ...examResultForAttempt(attempt.result) } as Partial<PracticePaperQuestionResult>
    : undefined;
  const unlocked = attempt.status === "marked" && Boolean(attempt.result) &&
    examAnswerUnlocksModelAnswer(attempt.result!);
  if (result) {
    delete result.confidence;
    result.criterionResults = result.criterionResults?.map(({ criterion, awarded, awardedMarks, maxMarks, evidence, schemeValue, candidateValue }) => ({ criterion, awarded, awardedMarks, maxMarks, evidence, schemeValue, candidateValue }));
  }
  return examDocument({
    id, userId: attempt.userId, sessionId: attempt.sessionId, questionId: attempt.questionId,
    attemptNumber: attempt.attemptNumber, answerText: attempt.answerText, status: attempt.status,
    result, officialMarkScheme: unlocked ? attempt.officialMarkScheme : undefined,
    workingIncluded: attempt.workingIncluded, workingWidth: attempt.workingWidth, workingHeight: attempt.workingHeight,
    reviewUsed: attempt.reviewUsed, reviewStatus: attempt.reviewStatus,
    reviewOriginalScore: attempt.reviewOriginalScore, answerDeletedAt: attempt.answerDeletedAt,
    // Why the last marking produced nothing. Written by the durable job rather
    // than returned from the submit request, which is long gone by then, and
    // safe to project: it is the sentence the student is meant to read.
    markingFailure: attempt.status === "marking_failed" || attempt.status === "draft"
      ? attempt.markingFailure
      : undefined,
    // The mark check's own reason, on the same terms. Cleared the moment a
    // check succeeds, so a stale sentence cannot sit under a finished check.
    reviewStartedAt: attempt.reviewStatus === "reviewing" ? attempt.reviewStartedAt : undefined,
    reviewFailure: attempt.reviewStatus === "failed" ? attempt.reviewFailure : undefined,
    startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, markedAt: attempt.markedAt, updatedAt: attempt.updatedAt,
  }) as PublicExamAttempt;
}

/**
 * The half of a bank question a student is allowed to see.
 *
 * Built by naming every field rather than deleting a few, so a field added to
 * `ExamQuestion` later cannot arrive on the client by default. The mark scheme
 * lives in a separate document and never passes through here at all; the
 * storage path is dropped because assets are streamed through an authorised
 * route, not fetched from a bucket the client can address.
 */
export function projectExamSessionQuestion(
  question: ExamSessionQuestion | ExamQuestion,
  attemptId: string
): ExamSessionQuestion {
  return {
    id: question.id,
    attemptId,
    label: question.label,
    prompt: question.prompt,
    marks: question.marks,
    difficulty: question.difficulty,
    origin: question.origin,
    provenance: question.provenance,
    contentVersion: question.contentVersion,
    topicIds: question.topicIds ?? [],
    assets: candidateExamAssets(question).map((asset) => {
      const visible = { ...asset };
      delete visible.storagePath;
      return visible;
    }),
  };
}

/** Re-project old snapshots too: persisted sessions may predate the split. */
export function projectExamSession(session: ExamSession): ExamSession {
  return {
    ...session,
    questions: session.questions.map((question) =>
      projectExamSessionQuestion(question, question.attemptId)),
  };
}
