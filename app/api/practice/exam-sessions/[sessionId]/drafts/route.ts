import type { NextRequest } from "next/server";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { getAdminDb } from "@/services/firebase/admin";
import { EXAM_ANSWER_MAX_LENGTH, EXAM_ID_PATTERN, type ExamSession } from "@/lib/practice/exam-questions";
import { featureFlags } from "@/lib/app/feature-flags";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const attemptId = typeof body?.attemptId === "string" ? body.attemptId : "";
  const answerText = typeof body?.answerText === "string" ? body.answerText : "";
  if (!EXAM_ID_PATTERN.test(sessionId) || !EXAM_ID_PATTERN.test(attemptId) || answerText.length > EXAM_ANSWER_MAX_LENGTH) return apiFailure("Draft not found.", 400, "invalid_request");
  const db = getAdminDb();
  const user = db.collection("users").doc(uid);
  const sessionRef = user.collection("examSessions").doc(sessionId);
  const ref = user.collection("examAttempts").doc(attemptId);
  try {
    await db.runTransaction(async (transaction) => {
      const [sessionSnapshot, snapshot] = await Promise.all([transaction.get(sessionRef), transaction.get(ref)]);
      const session = sessionSnapshot.data() as ExamSession | undefined;
      const question = session?.questions.find((item) => item.attemptId === attemptId || item.attemptId.replace(/_1$/, "_2") === attemptId);
      if (!session || !question || session.status !== "active" || session.answersDeletedAt) throw new Error("locked");
      const data = snapshot.data();
      if (snapshot.exists && (data?.sessionId !== sessionId || data.status !== "draft")) throw new Error("locked");
      if (!snapshot.exists) {
        if (attemptId === question.attemptId) throw new Error("missing");
        const first = await transaction.get(user.collection("examAttempts").doc(question.attemptId));
        if (first.data()?.status !== "marked" || !first.data()?.result?.attempted) throw new Error("locked");
        transaction.create(ref, { id: attemptId, userId: uid, sessionId, questionId: question.id, attemptNumber: 2, answerText, status: "draft", workingIncluded: false, reviewUsed: false, startedAt: Date.now(), updatedAt: Date.now() });
      } else {
        transaction.update(ref, { answerText, updatedAt: Date.now() });
      }
      transaction.update(sessionRef, { currentQuestionId: question.id, updatedAt: Date.now() });
    });
    return Response.json({ saved: true });
  } catch {
    return apiFailure("This answer has already been submitted or the session has finished.", 409, "attempt_locked");
  }
}
