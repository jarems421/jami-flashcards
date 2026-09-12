import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { checkAiBudget, createAiBudgetLimitResponse, refundAiBudget } from "@/services/ai/budgets";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { EXAM_ANSWER_MAX_LENGTH, EXAM_ID_PATTERN, EXAM_AI_JOB_DEADLINE_MS, examDocument, type ExamAttempt, type ExamMarkingJob, type ExamSession, examOperationIsLive } from "@/lib/practice/exam-questions";
import { examMarkingFailure } from "@/lib/practice/exam-marking-failure";
import { featureFlags } from "@/lib/app/feature-flags";
import { projectExamAttempt } from "@/lib/practice/exam-projections";
import { enqueueExamQuestionMarking } from "@/services/practice/exam-marking.server";
import { validateExamWorking } from "@/services/practice/exam-working.server";

export const runtime = "nodejs";
/** Validation, one upload and a queue write. The marking is no longer here. */
export const maxDuration = 30;

/**
 * Freeze the answer, queue the marking, answer the student.
 *
 * The marking used to happen here, which meant it had to finish in the 55
 * seconds this request had left -- a budget set by the serverless function
 * rather than by anything about marking. Three sequential provider calls do
 * not fit in it: the marker's own measurements size a single supervisor report
 * at 408 seconds, and the stage that overran was reliably the adjudicator, the
 * one bought precisely because the first two markers disagreed.
 *
 * So this request now does only the part that must be synchronous -- validate
 * the evidence, freeze it, take the allowance -- and hands the marking to a
 * durable job. The response still carries the attempt, now reading `marking`,
 * which is the state the page already polls.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const questionId = typeof body?.questionId === "string" ? body.questionId : "";
  const key = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!EXAM_ID_PATTERN.test(sessionId) || !EXAM_ID_PATTERN.test(questionId) || !key || key.length > 160) {
    return apiFailure("This answer could not be submitted.", 400, "invalid_request");
  }
  const answerText = typeof body?.answerText === "string" ? body.answerText.trim() : "";
  if (answerText.length > EXAM_ANSWER_MAX_LENGTH) return apiFailure("Your answer is too long.", 400, "answer_too_long");
  const number = body?.attemptNumber === 2 ? 2 : 1;
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const sessionRef = userRef.collection("examSessions").doc(sessionId);
  const session = (await sessionRef.get()).data() as ExamSession | undefined;
  const question = session?.questions.find((item) => item.id === questionId);
  if (!session || !question) return apiFailure("Question not found.", 404, "question_not_found");
  const attemptId = number === 1 ? question.attemptId : question.attemptId.replace(/_1$/, "_2");
  const ref = userRef.collection("examAttempts").doc(attemptId);
  const existing = (await ref.get()).data();
  // Deterministic attempt identity makes a replay cheap even after a lost response.
  if (existing?.status === "marked") return Response.json({ attempt: projectExamAttempt(attemptId, existing) });

  /*
   * The allowance is taken before the evidence is frozen, not after.
   *
   * Freezing first and then discovering the student is out of allowance left
   * the attempt submitted, locked against editing, and unmarkable -- so the
   * order is now: refuse while the answer is still theirs to change.
   */
  const budget = await checkAiBudget({ uid, action: "examQuestionMarking" });
  if (!budget.allowed) return createAiBudgetLimitResponse("examQuestionMarking", budget);

  /*
   * This submission's marking, named before it exists so every write the job
   * makes can be checked against it. A student who resubmits gets a new token,
   * and the job it replaced can no longer touch the attempt.
   */
  const markingToken = randomUUID();
  let uploadedPath: string | undefined;
  const supersededPath = typeof existing?.workingSnapshotPath === "string" ? existing.workingSnapshotPath : undefined;
  let keptPath: string | null | undefined;
  let working: Awaited<ReturnType<typeof validateExamWorking>> | undefined;
  let frozen: ExamAttempt;
  try {
    // Only a draft accepts new evidence. Once submitted, the answer and the
    // sheet are the record of what was sent, and a failed mark re-runs the
    // marker over that exact evidence rather than quietly marking something
    // else -- see the frozen-submission rule in the plan.
    if (existing?.status === "draft" && body?.workingSnapshot !== undefined) {
      working = await validateExamWorking(body.workingSnapshot);
      uploadedPath = `users/${uid}/examAttemptEvidence/${attemptId}/${randomUUID()}.png`;
      await getAdminStorageBucket().file(uploadedPath).save(working.bytes, {
        resumable: false, contentType: "image/png",
        metadata: { cacheControl: "private, no-store" },
      });
    }
    frozen = await db.runTransaction(async (transaction) => {
      const [currentSession, current, first] = await Promise.all([
        transaction.get(sessionRef), transaction.get(ref),
        transaction.get(userRef.collection("examAttempts").doc(question.attemptId)),
      ]);
      const state = currentSession.data();
      const attempt = current.data();
      if (!attempt || state?.status !== "active" || state.answersDeletedAt || attempt.answerDeletedAt) throw new Error("attempt_locked");
      if (attempt.status === "marked") throw new Error("already_marked");
      if (examOperationIsLive(attempt, Date.now())) throw new Error("already_marking");
      if (number === 2 && (first.data()?.status !== "marked" || !first.data()?.result?.attempted)) throw new Error("retry_not_ready");
      const editable = attempt.status === "draft";
      if (!editable && !["marking", "marking_failed"].includes(attempt.status)) {
        throw new Error("attempt_locked");
      }
      // A resubmission that carries no new sheet keeps the one already frozen.
      const keptPath = uploadedPath ?? (editable ? attempt.workingSnapshotPath ?? null : null);
      if (editable && !answerText && !keptPath) throw new Error("answer_required");
      const now = Date.now();
      const value = examDocument({
        ...attempt, ...(editable ? {
          answerText, workingIncluded: Boolean(keptPath),
          workingSnapshotPath: keptPath,
          workingWidth: uploadedPath ? working?.width : attempt.workingWidth,
          workingHeight: uploadedPath ? working?.height : attempt.workingHeight,
          submittedAt: attempt.submittedAt ?? now,
        } : {}),
        status: "marking", idempotencyKey: key, updatedAt: now,
        markingFailure: undefined,
        /*
         * Everything the job needs that this request will not be around to
         * give it: how long it may run, and the allowance to hand back if it
         * never produces a mark. Any checkpoints a previous attempt paid for
         * are deliberately dropped -- a resubmission is new evidence, and
         * reusing a report of the old answer would mark the wrong work.
         */
        marking: {
          token: markingToken,
          startedAt: now,
          deadlineAt: now + EXAM_AI_JOB_DEADLINE_MS,
          budgetGrant: budget.grant,
          attempts: (attempt.marking?.attempts ?? 0) + 1,
        } satisfies ExamMarkingJob,
      });
      transaction.set(ref, value);
      // The session read participates in finish/delete conflict detection.
      transaction.update(sessionRef, { updatedAt: now });
      return value as unknown as ExamAttempt;
    });
    keptPath = frozen.workingSnapshotPath ?? null;
  } catch (error) {
    const code = error instanceof Error ? error.message : "submission_failed";
    await refundAiBudget(budget.grant).catch(() => undefined);
    if (code === "already_marked") return Response.json({ attempt: projectExamAttempt(attemptId, (await ref.get()).data()!) });
    return apiFailure(code === "answer_required" ? "Add an answer or some working before submitting." :
      code === "already_marking" ? "Your answer is already being marked." :
      code === "attempt_locked" ? "This answer cannot be changed now." :
      "Your working could not be saved. Please try again.", 409, code === "invalid_working" ? code : "attempt_unavailable");
  } finally {
    // Whichever sheet the attempt did not keep is removed: a rejected upload,
    // or the one a resubmitted sheet superseded. A submission that never
    // committed keeps everything -- the sheet already frozen is still theirs.
    const orphans = keptPath === undefined ? [uploadedPath] : [uploadedPath, supersededPath];
    for (const orphan of orphans) {
      if (!orphan || orphan === keptPath) continue;
      await getAdminStorageBucket().file(orphan).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
  }

  /*
   * Queued, not marked. A job that cannot even be started settles the attempt
   * itself, so the reply reads the document back rather than describing a
   * state it only assumes.
   */
  await enqueueExamQuestionMarking(uid, attemptId, markingToken);
  const settled = (await ref.get()).data();
  if (settled?.status === "marking_failed") {
    return apiFailure(examMarkingFailure("marking_failed", Date.now()).message, 503, "marking_failed");
  }
  return Response.json({
    attempt: projectExamAttempt(attemptId, settled ?? (frozen as unknown as Record<string, unknown>)),
  });
}
