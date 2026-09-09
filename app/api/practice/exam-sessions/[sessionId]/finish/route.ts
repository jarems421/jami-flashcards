import type { NextRequest } from "next/server";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { getAdminDb } from "@/services/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { EXAM_ID_PATTERN, type ExamSession } from "@/lib/practice/exam-questions";
import { featureFlags } from "@/lib/app/feature-flags";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  if (!EXAM_ID_PATTERN.test(sessionId)) return apiFailure("Session not found.", 404, "session_not_found");
  const db = getAdminDb();
  const user = db.collection("users").doc(uid);
  const ref = user.collection("examSessions").doc(sessionId);
  try {
    const session = await db.runTransaction(async (transaction) => {
      const [snapshot, attempts] = await Promise.all([
        transaction.get(ref), transaction.get(user.collection("examAttempts").where("sessionId", "==", sessionId)),
      ]);
      if (!snapshot.exists) throw new Error("missing");
      const session = snapshot.data() as ExamSession;
      if (session.status === "completed") return session;
      if (attempts.docs.some((doc) => doc.data().status === "marking" || doc.data().reviewStatus === "reviewing")) throw new Error("marking");
      const marked = attempts.docs.filter((doc) => doc.data().attemptNumber === 1 && doc.data().status === "marked");
      const markedIds = new Set(marked.map((doc) => doc.data().questionId));
      const completed = { ...session, status: "completed" as const, answeredCount: marked.length,
        awardedTotal: marked.reduce((sum, doc) => sum + (doc.data().result?.awardedMarks ?? 0), 0),
        completedAt: Date.now(), updatedAt: Date.now() };
      transaction.update(ref, completed);
      for (const question of session.questions) {
        // Only the shared bank keeps stats; a generated filler is seen once.
        if (question.origin === "official_past_paper" && !markedIds.has(question.id)) transaction.set(db.collection("examQuestionStats").doc(`${question.id}_${session.studyLevel}`),
          { questionId: question.id, studyLevel: session.studyLevel, abandonmentCount: FieldValue.increment(1), updatedAt: Date.now() }, { merge: true });
      }
      return completed;
    });
    return Response.json({ session });
  } catch (error) {
    const code = error instanceof Error ? error.message : "finish_failed";
    if (code === "missing") return apiFailure("Session not found.", 404, "session_not_found");
    if (code === "marking") return apiFailure("Wait for marking to finish, then try again.", 409, "session_busy");
    return apiFailure("This session could not be finished.", 503, "finish_failed");
  }
}
