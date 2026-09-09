import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import { buildSingleQuestionAnswerParts, buildSingleQuestionPaper } from "@/lib/practice/single-question-paper";
import type { ExamAttempt, ExamSession } from "@/lib/practice/exam-questions";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import type { PracticePaperResult } from "@/lib/practice/practice-papers";
import { checkAiBudget, createAiBudgetLimitResponse, getAiTokenCap, refundAiBudget } from "@/services/ai/budgets";
import { reviewSingleQuestionIndependently } from "@/services/ai/practice-paper-marking.server";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { correctExamDifficultyContribution } from "@/services/practice/exam-difficulty.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { examDocument, examResultForAttempt } from "@/lib/practice/exam-questions";
import { examQuestionVisualParts, loadExamQuestionSecret, loadServableExamQuestion } from "@/services/practice/exam-evidence.server";
import { projectExamAttempt } from "@/lib/practice/exam-projections";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  if (!EXAM_ID_PATTERN.test(sessionId) || !EXAM_ID_PATTERN.test(questionId)) return apiFailure("Question not found.", 404, "question_not_found");

  const db = getAdminDb();
  const sessionRef = db.collection("users").doc(uid).collection("examSessions").doc(sessionId);
  const sessionSnapshot = await sessionRef.get();
  const session = sessionSnapshot.data() as ExamSession | undefined;
  const question = session?.questions.find((item) => item.id === questionId);
  if (!session || !question) return apiFailure("Question not found.", 404, "question_not_found");
  const attemptRef = db.collection("users").doc(uid).collection("examAttempts").doc(question.attemptId);
  const attemptSnapshot = await attemptRef.get();
  const attempt = attemptSnapshot.data() as ExamAttempt | undefined;
  if (!attempt || attempt.status !== "marked" || !attempt.result) return apiFailure("Mark this answer before asking for a check.", 409, "review_not_ready");
  if (attempt.reviewUsed) return Response.json({ attempt: projectExamAttempt(attempt.id, attemptSnapshot.data()!) });
  if (attempt.answerDeletedAt || !attempt.result.attempted) return apiFailure("This answer is not available for review.", 409, "review_not_ready");
  const key = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!key || key.length > 160) return apiFailure("Invalid request.", 400, "invalid_request");
  const locked = await db.runTransaction(async (transaction) => {
    const [current, currentSession] = await Promise.all([transaction.get(attemptRef), transaction.get(sessionRef)]);
    const data = current.data();
    if (data?.reviewUsed) return "complete";
    if (data?.answerDeletedAt || currentSession.data()?.answersDeletedAt || data?.status !== "marked") return "unavailable";
    if (data.reviewStatus === "reviewing" && Date.now() - (data.reviewStartedAt ?? 0) < 90_000) return "busy";
    transaction.update(attemptRef, { reviewStatus: "reviewing", reviewKey: key, reviewStartedAt: Date.now() });
    return "locked";
  });
  if (locked === "complete") return Response.json({ attempt: projectExamAttempt(attempt.id, (await attemptRef.get()).data()!) });
  if (locked !== "locked") return apiFailure("This mark is already being checked or is unavailable.", 409, "review_unavailable");

  const budget = await checkAiBudget({ uid, action: "examQuestionReview" });
  if (!budget.allowed) {
    await attemptRef.update({ reviewStatus: "failed" });
    return createAiBudgetLimitResponse("examQuestionReview", budget);
  }
  enterAiSpendContext(aiSpendContextFor(uid, "examQuestionReview"));
  try {
    const [bankQuestion, secret] = await Promise.all([
      loadServableExamQuestion(questionId, uid),
      loadExamQuestionSecret(questionId, uid, question.contentVersion),
    ]);
    const scheme = { ...secret.markSchemeItem, questionId, maxMarks: question.marks } as PracticePaperMarkSchemeItem;
    const paper = buildSingleQuestionPaper({
      id: `exam-review-${attempt.id}`,
      folderId: session.folderId,
      title: `${session.subject} ${question.label}`,
      question: { id: question.id, label: question.label, prompt: question.prompt, marks: question.marks, assets: question.assets },
      markSchemeItem: scheme,
      studyLevel: session.studyLevel,
      qualification: session.course.qualification,
      awardingBody: question.provenance.boardLabel,
      specification: question.provenance.specificationTitle,
      component: question.provenance.componentTitle,
      markSchemeKind: question.origin === "jami_generated" ? "generated" : "official",
    });
    let workingImage;
    if (attempt.workingSnapshotPath) {
      const [buffer] = await getAdminStorageBucket().file(attempt.workingSnapshotPath).download();
      workingImage = { inlineData: { mimeType: "image/png" as const, data: buffer.toString("base64") } };
    }
    const answerParts = buildSingleQuestionAnswerParts({ questionId, answerText: attempt.answerText, workingImage });
    const originalResult: PracticePaperResult = {
      awardedMarks: attempt.result.awardedMarks,
      totalMarks: attempt.result.maxMarks,
      percentage: attempt.result.maxMarks ? Math.round((attempt.result.awardedMarks / attempt.result.maxMarks) * 100) : 0,
      summary: attempt.result.feedback,
      strengths: [], priorities: [], questionResults: [attempt.result],
    };
    const review = await reviewSingleQuestionIndependently({
      paper, answerParts, originalResult, originalPaperParts: await examQuestionVisualParts(bankQuestion),
      maxOutputTokens: getAiTokenCap("examQuestionReview"), deadlineAt: Date.now() + 55_000,
    });
    const rawResult = review.result.questionResults[0];
    if (!rawResult) throw new Error("review_result_missing");
    const result = examResultForAttempt(rawResult);
    const delta = result.awardedMarks - attempt.result.awardedMarks;
    const now = Date.now();
    await db.runTransaction(async (transaction) => {
      const [current, currentSession] = await Promise.all([transaction.get(attemptRef), transaction.get(sessionRef)]);
      if (current.data()?.reviewUsed === true || current.data()?.reviewKey !== key || currentSession.data()?.answersDeletedAt) throw new Error("review_used");
      transaction.update(attemptRef, examDocument({
        result,
        reviewUsed: true,
        reviewStatus: "complete",
        reviewOriginalScore: attempt.result!.awardedMarks,
        audit: { ...(attempt.audit ?? {}), reviewedScore: result.awardedMarks, studentReviewed: true },
        reviewAudit: { ...review.audit, originalResult: attempt.result, createdAt: now },
        updatedAt: now,
      }));
      if (delta !== 0) transaction.update(sessionRef, { awardedTotal: FieldValue.increment(delta), updatedAt: now });
    });
    if (delta !== 0) {
      await correctExamDifficultyContribution({ uid, attemptId: attempt.id, questionId, studyLevel: session.studyLevel, newFraction: result.awardedMarks / question.marks }).catch(() => undefined);
    }
    return Response.json({ attempt: projectExamAttempt(attempt.id, (await attemptRef.get()).data()!) });
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(attemptRef);
      if (!current.data()?.reviewUsed && current.data()?.reviewKey === key) transaction.update(attemptRef, { reviewStatus: "failed" });
    });
    await refundAiBudget(budget.grant).catch(() => undefined);
    return apiFailure(error instanceof Error && error.message === "review_used" ? "This mark has already been checked." : "Jami couldn't check this mark just now.", error instanceof Error && error.message === "review_used" ? 409 : 503, "review_failed");
  }
}
