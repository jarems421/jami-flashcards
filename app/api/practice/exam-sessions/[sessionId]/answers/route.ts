import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { checkAiBudget, createAiBudgetLimitResponse, getAiTokenCap, refundAiBudget } from "@/services/ai/budgets";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { EXAM_ANSWER_MAX_LENGTH, EXAM_ID_PATTERN, examAnswerUnlocksModelAnswer, examDocument, examResultForAttempt, type ExamAttempt, type ExamSession } from "@/lib/practice/exam-questions";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import { buildSingleQuestionAnswerParts, buildSingleQuestionPaper } from "@/lib/practice/single-question-paper";
import { markSingleQuestionAdaptively } from "@/services/ai/practice-paper-marking.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { recordExamDifficultyContribution } from "@/services/practice/exam-difficulty.server";
import { projectExamAttempt } from "@/lib/practice/exam-projections";
import { examQuestionVisualParts, loadExamQuestionSecret, loadServableExamQuestion } from "@/services/practice/exam-evidence.server";
import { validateExamWorking } from "@/services/practice/exam-working.server";

export const runtime = "nodejs";
export const maxDuration = 60;

function needsVerification(item: PracticePaperMarkSchemeItem, marks: number, working: boolean) {
  return marks >= 6 || ["banded", "weightedTraits", "competency"].includes(item.marking) ||
    (working && marks >= 4) ||
    ((item.marking === "additive" || item.marking === "pointPool") && item.points.some((point) => point.dep.length > 0 || point.ft));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const deadlineAt = Date.now() + 55_000;
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
  let uploadedPath: string | undefined;
  const supersededPath = typeof existing?.workingSnapshotPath === "string" ? existing.workingSnapshotPath : undefined;
  let keptPath: string | null | undefined;
  let working: Awaited<ReturnType<typeof validateExamWorking>> | undefined;
  let frozen: ExamAttempt;
  try {
    // A failed mark leaves the answer the student's to change, so the sheet is
    // accepted again too -- otherwise a retry marks work they can no longer see.
    if ((existing?.status === "draft" || existing?.status === "marking_failed") && body?.workingSnapshot !== undefined) {
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
      if (attempt.status === "marking" && Date.now() - attempt.updatedAt < 90_000) throw new Error("already_marking");
      if (number === 2 && (first.data()?.status !== "marked" || !first.data()?.result?.attempted)) throw new Error("retry_not_ready");
      const editable = attempt.status === "draft" || attempt.status === "marking_failed";
      if (!editable && attempt.status !== "marking") throw new Error("attempt_locked");
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
      });
      transaction.set(ref, value);
      // The session read participates in finish/delete conflict detection.
      transaction.update(sessionRef, { updatedAt: now });
      return value as unknown as ExamAttempt;
    });
    keptPath = frozen.workingSnapshotPath ?? null;
  } catch (error) {
    const code = error instanceof Error ? error.message : "submission_failed";
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

  const budget = await checkAiBudget({ uid, action: "examQuestionMarking" });
  if (!budget.allowed) {
    await ref.update({ status: "marking_failed", updatedAt: Date.now() });
    return createAiBudgetLimitResponse("examQuestionMarking", budget);
  }
  enterAiSpendContext(aiSpendContextFor(uid, "examQuestionMarking"));
  try {
    const [bankQuestion, secret] = await Promise.all([
      loadServableExamQuestion(questionId, uid), loadExamQuestionSecret(questionId, uid),
    ]);
    if (secret.markSchemeItem.maxMarks !== question.marks || secret.questionId !== questionId) throw new Error("scheme_mismatch");
    const paper = buildSingleQuestionPaper({
      id: `exam-${attemptId}`, folderId: session.folderId, title: `${session.subject} ${question.label}`,
      question: { id: question.id, label: question.label, prompt: question.prompt, marks: question.marks, assets: question.assets },
      markSchemeItem: secret.markSchemeItem, studyLevel: session.studyLevel, qualification: session.course.qualification,
      awardingBody: question.provenance.boardLabel, specification: question.provenance.specificationTitle,
      component: question.provenance.componentTitle, markSchemeKind: question.origin === "jami_generated" ? "generated" : "official",
    });
    const originalPaperParts = await examQuestionVisualParts(bankQuestion);
    const bytes = frozen.workingSnapshotPath ? (await getAdminStorageBucket().file(frozen.workingSnapshotPath).download())[0] : undefined;
    const answerParts = buildSingleQuestionAnswerParts({
      questionId, answerText: frozen.answerText,
      workingImage: bytes ? { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } } : undefined,
    });
    const marked = await markSingleQuestionAdaptively({
      paper, answerParts, originalPaperParts, maxOutputTokens: getAiTokenCap("examQuestionMarking"), deadlineAt,
      forceVerification: needsVerification(secret.markSchemeItem, question.marks, Boolean(bytes)),
    });
    if (!marked.result.questionResults[0]) throw new Error("missing_question_result");
    const result = examResultForAttempt(marked.result.questionResults[0], frozen.answerText);
    await db.runTransaction(async (transaction) => {
      const [current, currentSession] = await Promise.all([transaction.get(ref), transaction.get(sessionRef)]);
      if (current.data()?.idempotencyKey !== key || current.data()?.status !== "marking" || currentSession.data()?.answersDeletedAt) throw new Error("stale_marking");
      transaction.update(ref, examDocument({
        status: "marked", result, officialMarkScheme: examAnswerUnlocksModelAnswer(result, frozen.answerText) ? secret.officialMarkScheme : null,
        audit: { ...marked.audit, studentReviewed: false }, markedAt: Date.now(), updatedAt: Date.now(),
      }));
      if (number === 1) transaction.update(sessionRef, {
        answeredCount: (currentSession.data()?.answeredCount ?? 0) + 1,
        awardedTotal: (currentSession.data()?.awardedTotal ?? 0) + result.awardedMarks,
        updatedAt: Date.now(),
      });
    });
    if (number === 1 && result.attempted) await recordExamDifficultyContribution({
      uid, attemptId, questionId, studyLevel: session.studyLevel, fraction: result.awardedMarks / question.marks,
      durationMs: Math.max(0, (frozen.submittedAt ?? Date.now()) - frozen.startedAt),
    });
    return Response.json({ attempt: projectExamAttempt(attemptId, (await ref.get()).data()!) });
  } catch {
    const current = (await ref.get()).data();
    if (current?.status === "marked") return Response.json({ attempt: projectExamAttempt(attemptId, current) });
    await db.runTransaction(async (transaction) => {
      const currentAttempt = await transaction.get(ref);
      if (currentAttempt.data()?.idempotencyKey === key && currentAttempt.data()?.status === "marking") {
        transaction.update(ref, { status: "marking_failed", updatedAt: Date.now() });
      }
    });
    await refundAiBudget(budget.grant).catch(() => undefined);
    return apiFailure("Jami couldn't mark this one — your answer is saved.", 503, "marking_failed");
  }
}
