import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import type { ExamAttempt, ExamReviewJob, ExamSession } from "@/lib/practice/exam-questions";
import {
  EXAM_AI_JOB_DEADLINE_MS,
  EXAM_ID_PATTERN,
  examOperationIsLive,
} from "@/lib/practice/exam-questions";
import { examReviewFailureMessage } from "@/lib/practice/exam-marking-failure";
import { checkAiBudget, createAiBudgetLimitResponse, refundAiBudget } from "@/services/ai/budgets";
import { getAdminDb } from "@/services/firebase/admin";
import { featureFlags } from "@/lib/app/feature-flags";
import { enqueueExamQuestionReview } from "@/services/practice/exam-review.server";
import { projectExamAttempt } from "@/lib/practice/exam-projections";

export const runtime = "nodejs";
/** A lock, a budget check and a queue write. The checking is no longer here. */
export const maxDuration = 30;

/**
 * Lock the attempt, queue the check, answer the student.
 *
 * The check used to run inside this request, which gave a juror read and a
 * supervisor reconciliation 55 seconds between them -- against reports that
 * `markerTimeoutMs` sizes at 515 and 408. It never had room to finish. The
 * request now does only what must be synchronous, and a durable job does the
 * rest; `reviewStatus: "reviewing"` is the state the page already polls.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  if (!EXAM_ID_PATTERN.test(sessionId) || !EXAM_ID_PATTERN.test(questionId)) {
    return apiFailure("Question not found.", 404, "question_not_found");
  }

  const db = getAdminDb();
  const sessionRef = db.collection("users").doc(uid).collection("examSessions").doc(sessionId);
  const session = (await sessionRef.get()).data() as ExamSession | undefined;
  const question = session?.questions.find((item) => item.id === questionId);
  if (!session || !question) return apiFailure("Question not found.", 404, "question_not_found");
  const attemptRef = db.collection("users").doc(uid).collection("examAttempts").doc(question.attemptId);
  const attemptSnapshot = await attemptRef.get();
  const attempt = attemptSnapshot.data() as ExamAttempt | undefined;
  if (!attempt || attempt.status !== "marked" || !attempt.result) {
    return apiFailure("Mark this answer before asking for a check.", 409, "review_not_ready");
  }
  if (attempt.reviewUsed) return Response.json({ attempt: projectExamAttempt(attempt.id, attemptSnapshot.data()!) });
  if (attempt.answerDeletedAt || !attempt.result.attempted) {
    return apiFailure("This answer is not available for review.", 409, "review_not_ready");
  }
  const key = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!key || key.length > 160) return apiFailure("Invalid request.", 400, "invalid_request");

  /*
   * The allowance is taken before the attempt is locked, not after. Locking
   * first and then discovering the student is out of allowance left the
   * attempt reading `reviewing` with nothing coming.
   */
  const budget = await checkAiBudget({ uid, action: "examQuestionReview" });
  if (!budget.allowed) return createAiBudgetLimitResponse("examQuestionReview", budget);

  /*
   * This check's job, named before it exists.
   *
   * Separate from the idempotency key above, which is derived from the session
   * and question and so is the same string every time this answer is checked.
   * That is what an idempotency key is for, and exactly what disqualifies it as
   * a job identity: a stranded job whose student asked again would still match
   * it, and could write its result over the newer check's.
   */
  const reviewToken = randomUUID();

  const locked = await db.runTransaction(async (transaction) => {
    const [current, currentSession] = await Promise.all([
      transaction.get(attemptRef), transaction.get(sessionRef),
    ]);
    const data = current.data() as ExamAttempt | undefined;
    if (data?.reviewUsed) return "complete";
    if (data?.answerDeletedAt || currentSession.data()?.answersDeletedAt || data?.status !== "marked") {
      return "unavailable";
    }
    if (examOperationIsLive(data, Date.now())) return "busy";
    const now = Date.now();
    transaction.update(attemptRef, {
      reviewStatus: "reviewing",
      reviewKey: key,
      reviewStartedAt: now,
      // `satisfies` rather than a bare object: Firestore's `update` takes an
      // untyped map, so a job written here with a field missing compiles
      // cleanly and fails only at runtime, in a background job, on a race.
      review: {
        token: reviewToken,
        startedAt: now,
        deadlineAt: now + EXAM_AI_JOB_DEADLINE_MS,
        budgetGrant: budget.grant,
      } satisfies ExamReviewJob,
      reviewFailure: FieldValue.delete(),
      updatedAt: now,
    });
    return "locked";
  });
  /*
   * Every path that does not start a job hands the allowance back. Taking it
   * before the lock is what makes an exhausted allowance refusable while the
   * mark is still untouched; it also means nothing else here may keep it.
   */
  if (locked !== "locked") {
    await refundAiBudget(budget.grant).catch(() => undefined);
    if (locked === "complete") {
      return Response.json({ attempt: projectExamAttempt(attempt.id, (await attemptRef.get()).data()!) });
    }
    return apiFailure("This mark is already being checked or is unavailable.", 409, "review_unavailable");
  }

  /*
   * Queued, not checked. A job that cannot even be started settles the attempt
   * itself, so the reply reads the document back rather than describing a state
   * it only assumes.
   */
  await enqueueExamQuestionReview(uid, attempt.id, reviewToken);
  const settled = (await attemptRef.get()).data();
  if (settled?.reviewStatus === "failed") {
    return apiFailure(examReviewFailureMessage("marking_failed"), 503, "review_failed");
  }
  return Response.json({ attempt: projectExamAttempt(attempt.id, settled ?? attemptSnapshot.data()!) });
}
