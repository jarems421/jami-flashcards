import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { start } from "workflow/api";
import { getAiInputTokenCap } from "@/lib/ai/budgets";
import { getAiTokenCap, refundAiBudget } from "@/services/ai/budgets";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  EXAM_AI_JOB_DEADLINE_MS,
  examDocument,
  examResultForAttempt,
  withCriterionTariffs,
  type ExamAttempt,
  type ExamSession,
} from "@/lib/practice/exam-questions";
import {
  examReviewFailure,
  type ExamMarkingFailureCode,
} from "@/lib/practice/exam-marking-failure";
import type {
  PracticePaperMarkerStage,
  PracticePaperMarkerStageResult,
} from "@/lib/practice/marker-stages";
import { schemeCriteria, type PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import type { PracticePaperResult } from "@/lib/practice/practice-papers";
import {
  buildSingleQuestionAnswerParts,
  buildSingleQuestionPaper,
} from "@/lib/practice/single-question-paper";
import { reviewSingleQuestionIndependently } from "@/services/ai/practice-paper-marking.server";
import { correctExamDifficultyContribution } from "@/services/practice/exam-difficulty.server";
import {
  examQuestionVisualParts,
  loadExamQuestionSecret,
  loadServableExamQuestion,
} from "@/services/practice/exam-evidence.server";
import { reviewExamQuestionWorkflow } from "@/workflows/exam-question-review";

/**
 * The student's one independent check of a mark, off the request that asked.
 *
 * Same reasoning as marking, and a worse ratio. A check is a juror read
 * followed, when it disagrees, by a supervisor reconciliation; `markerTimeoutMs`
 * sizes those reports at 515 and 408 seconds, and the route gave both of them 55
 * between them. It has never had room to finish.
 *
 * The job carries its own token, separate from the `reviewKey` the client sends.
 * That key is derived from the session and question, so it is the same string
 * for every check of a given answer -- which is what an idempotency key is for,
 * and exactly what disqualifies it as an identity. A student whose check fails
 * may ask again, so the attempt can carry a second job within seconds of the
 * first; every write here is conditional on the token still matching.
 */

function refsFor(uid: string, attemptId: string) {
  const userRef = getAdminDb().collection("users").doc(uid);
  return { userRef, attemptRef: userRef.collection("examAttempts").doc(attemptId) };
}

async function loadAttempt(uid: string, attemptId: string) {
  const { userRef, attemptRef } = refsFor(uid, attemptId);
  const attempt = (await attemptRef.get()).data() as ExamAttempt | undefined;
  if (!attempt) return null;
  const sessionRef = userRef.collection("examSessions").doc(attempt.sessionId);
  const session = (await sessionRef.get()).data() as ExamSession | undefined;
  if (!session) return null;
  return { attemptRef, sessionRef, attempt, session };
}

/**
 * Whether this check still has anything to deliver to.
 *
 * Identified by the job's own token rather than the request's idempotency key,
 * which is the same string for every check of a given answer.
 *
 * A finished session is deliberately *not* a reason to stop. A student may
 * check a mark after finishing -- the mark report is reachable from history --
 * so unlike marking, only the answer going away ends this.
 */
export async function examReviewIsCancelled(uid: string, attemptId: string, token: string) {
  const loaded = await loadAttempt(uid, attemptId);
  if (!loaded) return true;
  const { attempt, session } = loaded;
  return (
    attempt.reviewStatus !== "reviewing" ||
    attempt.review?.token !== token ||
    attempt.reviewUsed === true ||
    attempt.status !== "marked" ||
    Boolean(attempt.answerDeletedAt) ||
    Boolean(session.answersDeletedAt)
  );
}

/** Queued by the review route once the attempt is locked. */
export async function enqueueExamQuestionReview(uid: string, attemptId: string, token: string) {
  const { attemptRef } = refsFor(uid, attemptId);
  try {
    const run = await start(reviewExamQuestionWorkflow, [uid, attemptId, token]);
    await attemptRef.update({ "review.runId": run.runId, reviewStartedAt: Date.now() });
    return true;
  } catch {
    // A job that never started will never write its own failure, so the
    // attempt is settled here rather than left reading `reviewing`.
    await failExamQuestionReview(uid, attemptId, "marking_failed", token);
    return false;
  }
}

/**
 * Stage checkpoints, written as each provider call comes back.
 *
 * A student gets one check, so a resumed one paying for the juror twice is
 * worse here than in marking. Field-merged and refused once the key has moved
 * on, so a superseded check cannot leave its report where the next one reads it.
 */
async function saveStage(
  uid: string,
  attemptId: string,
  token: string,
  stage: PracticePaperMarkerStage,
  result: PracticePaperMarkerStageResult
) {
  const db = getAdminDb();
  const { attemptRef } = refsFor(uid, attemptId);
  await db.runTransaction(async (transaction) => {
    const attempt = (await transaction.get(attemptRef)).data() as ExamAttempt | undefined;
    if (attempt?.review?.token !== token) return;
    transaction.update(attemptRef, {
      [`review.stages.${stage}`]: examDocument(result),
      // The job's heartbeat: a check whose stages are still arriving is
      // plainly not stranded.
      reviewStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

function failureCodeFor(reason: string): ExamMarkingFailureCode {
  if (reason === "input_too_large") return "input_too_large";
  if (reason === "question_changed") return "question_changed";
  return "marking_failed";
}

/**
 * Settle a check that produced nothing.
 *
 * `reviewUsed` is deliberately left alone. A check that did not happen has not
 * been spent, and the student keeps the one they are allowed -- which is also
 * why the mark and the feedback are untouched here.
 */
export async function failExamQuestionReview(
  uid: string,
  attemptId: string,
  code: ExamMarkingFailureCode,
  token: string
) {
  const db = getAdminDb();
  const { attemptRef } = refsFor(uid, attemptId);
  const grant = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef);
    const attempt = snapshot.data() as ExamAttempt | undefined;
    if (!attempt || attempt.reviewStatus !== "reviewing") return undefined;
    // A superseded check does not get to fail the one that replaced it.
    if (attempt.review?.token !== token) return undefined;
    transaction.update(attemptRef, {
      reviewStatus: "failed",
      reviewFailure: examReviewFailure(code, Date.now()),
      review: FieldValue.delete(),
      updatedAt: Date.now(),
    });
    return attempt.review?.budgetGrant;
  });
  // The allowance, not the money: a call the provider answered was paid for
  // whatever this does.
  if (grant) await refundAiBudget(grant).catch(() => undefined);
}

export async function runExamQuestionReview(uid: string, attemptId: string, token: string) {
  if (!featureFlags.enablePastPaperPractice) return "cancelled" as const;
  const db = getAdminDb();
  const loaded = await loadAttempt(uid, attemptId);
  if (!loaded) return "cancelled" as const;
  const { attemptRef, sessionRef, attempt, session } = loaded;
  if (await examReviewIsCancelled(uid, attemptId, token)) return "cancelled" as const;

  const question = session.questions.find((item) => item.id === attempt.questionId);
  const original = attempt.result;
  if (!question || !original) return "cancelled" as const;
  const deadlineAt = attempt.review?.deadlineAt ?? Date.now() + EXAM_AI_JOB_DEADLINE_MS;

  enterAiSpendContext(aiSpendContextFor(uid, "examQuestionReview"));
  try {
    const [bankQuestion, secret] = await Promise.all([
      loadServableExamQuestion(attempt.questionId, uid, question.contentVersion),
      loadExamQuestionSecret(attempt.questionId, uid, question.contentVersion),
    ]);
    const scheme = {
      ...secret.markSchemeItem,
      questionId: attempt.questionId,
      maxMarks: question.marks,
    } as PracticePaperMarkSchemeItem;
    const paper = buildSingleQuestionPaper({
      id: `exam-review-${attemptId}`, folderId: session.folderId,
      title: `${session.subject} ${question.label}`,
      question: { id: question.id, label: question.label, prompt: question.prompt, marks: question.marks, assets: question.assets },
      markSchemeItem: scheme, studyLevel: session.studyLevel, qualification: session.course.qualification,
      awardingBody: question.provenance.boardLabel, specification: question.provenance.specificationTitle,
      component: question.provenance.componentTitle,
      markSchemeKind: question.origin === "jami_generated" ? "generated" : "official",
    });
    const bytes = attempt.workingSnapshotPath
      ? (await getAdminStorageBucket().file(attempt.workingSnapshotPath).download())[0]
      : undefined;
    const answerParts = buildSingleQuestionAnswerParts({
      questionId: attempt.questionId, answerText: attempt.answerText,
      workingImage: bytes ? { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } } : undefined,
    });
    const originalResult: PracticePaperResult = {
      awardedMarks: original.awardedMarks,
      totalMarks: original.maxMarks,
      percentage: original.maxMarks ? Math.round((original.awardedMarks / original.maxMarks) * 100) : 0,
      summary: original.feedback,
      strengths: [], priorities: [], questionResults: [original],
    };
    const review = await reviewSingleQuestionIndependently({
      paper, answerParts, originalResult,
      originalPaperParts: await examQuestionVisualParts(bankQuestion),
      maxOutputTokens: getAiTokenCap("examQuestionReview"),
      inputTokenCap: getAiInputTokenCap("examQuestionReview"),
      deadlineAt,
      cachedStageResults: attempt.review?.stages,
      onStageResult: (stage, result) => saveStage(uid, attemptId, token, stage, result),
    });
    const rawResult = review.result.questionResults[0];
    if (!rawResult) throw new Error("review_result_missing");
    // The scheme is in hand here and nowhere downstream, so each criterion
    // takes its tariff with it.
    const result = examResultForAttempt(
      withCriterionTariffs(rawResult, schemeCriteria(secret.markSchemeItem))
    );
    const delta = result.awardedMarks - original.awardedMarks;
    const now = Date.now();
    const written = await db.runTransaction(async (transaction) => {
      const [current, currentSession] = await Promise.all([
        transaction.get(attemptRef), transaction.get(sessionRef),
      ]);
      const latest = current.data() as ExamAttempt | undefined;
      if (
        latest?.reviewUsed === true ||
        latest?.review?.token !== token ||
        latest?.answerDeletedAt ||
        currentSession.data()?.answersDeletedAt
      ) {
        return false;
      }
      transaction.update(attemptRef, examDocument({
        result,
        reviewUsed: true,
        reviewStatus: "complete",
        reviewOriginalScore: original.awardedMarks,
        audit: { ...(attempt.audit ?? {}), reviewedScore: result.awardedMarks, studentReviewed: true },
        reviewAudit: { ...review.audit, originalResult: original, createdAt: now },
        updatedAt: now,
      }));
      transaction.update(attemptRef, { review: FieldValue.delete(), reviewFailure: FieldValue.delete() });
      if (delta !== 0) {
        transaction.update(sessionRef, { awardedTotal: FieldValue.increment(delta), updatedAt: now });
      }
      return true;
    });
    /*
     * A check nobody is waiting for is not written back. The student deleted
     * their answers or asked again while this ran, and whichever it was is more
     * recent than this result.
     */
    if (!written) return "cancelled" as const;
    if (delta !== 0) {
      await correctExamDifficultyContribution({
        uid, attemptId, questionId: attempt.questionId, studyLevel: session.studyLevel,
        newFraction: result.awardedMarks / question.marks,
      }).catch(() => undefined);
    }
    return "checked" as const;
  } catch (error) {
    await failExamQuestionReview(
      uid,
      attemptId,
      failureCodeFor(error instanceof Error ? error.message : ""),
      token
    );
    return "failed" as const;
  }
}
