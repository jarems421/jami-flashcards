import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { EXAM_ID_PATTERN, examOperationIsLive } from "@/lib/practice/exam-questions";
import { featureFlags } from "@/lib/app/feature-flags";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  if (!EXAM_ID_PATTERN.test(sessionId)) return apiFailure("Session not found.", 404, "session_not_found");
  const db = getAdminDb();
  const user = db.collection("users").doc(uid);
  const ref = user.collection("examSessions").doc(sessionId);
  const cleanupRef = db.collection("examEvidenceCleanup").doc(`${uid}_${sessionId}`);
  let paths: string[];
  try {
    paths = await db.runTransaction(async (transaction) => {
      const [session, attempts, cleanup] = await Promise.all([transaction.get(ref), transaction.get(user.collection("examAttempts").where("sessionId", "==", sessionId)), transaction.get(cleanupRef)]);
      if (!session.exists) throw new Error("missing");
      if (attempts.docs.some((doc) => examOperationIsLive(doc.data(), Date.now()))) throw new Error("busy");
      const paths: string[] = [];
      for (const attempt of attempts.docs) {
        const data = attempt.data();
        if (typeof data.workingSnapshotPath === "string") paths.push(data.workingSnapshotPath);
        const result = data.result;
        transaction.update(attempt.ref, {
          answerText: "", workingSnapshotPath: null, workingIncluded: false,
          workingWidth: FieldValue.delete(), workingHeight: FieldValue.delete(),
          audit: FieldValue.delete(), reviewAudit: FieldValue.delete(),
          status: data.status === "marked" ? "marked" : "deleted",
          ...(result ? { result: {
            questionId: result.questionId, label: result.label, awardedMarks: result.awardedMarks,
            maxMarks: result.maxMarks, counted: result.counted, attempted: result.attempted,
            confidence: "medium", feedback: "Your answer and feedback have been deleted.",
            strengths: [], improvements: [],
          } } : {}),
          officialMarkScheme: FieldValue.delete(), answerDeletedAt: Date.now(), updatedAt: Date.now(),
        });
        transaction.delete(user.collection("examScratchpads").doc(attempt.id));
      }
      transaction.update(ref, { answersDeletedAt: Date.now(), status: "completed", updatedAt: Date.now() });
      const pending = [...new Set<string>([...(cleanup.data()?.paths ?? []), ...paths])];
      transaction.set(cleanupRef, { paths: pending, updatedAt: Date.now() });
      return pending;
    });
    // Keep a private cleanup queue so a storage outage cannot silently orphan answers.
    const pending: string[] = [];
    for (const path of paths) {
      if (!path.startsWith(`users/${uid}/examAttemptEvidence/`)) continue;
      try { await getAdminStorageBucket().file(path).delete({ ignoreNotFound: true }); } catch { pending.push(path); }
    }
    await cleanupRef.set({ paths: pending, updatedAt: Date.now() });
    if (pending.length) return apiFailure("Your answers are hidden. Please retry to finish removing the saved images.", 503, "cleanup_pending");
    return Response.json({ deleted: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "delete_failed";
    if (code === "missing") return apiFailure("Session not found.", 404, "session_not_found");
    if (code === "busy") return apiFailure("Wait for marking to finish before deleting your answers.", 409, "session_busy");
    return apiFailure("Your answers could not be deleted just now.", 503, "delete_failed");
  }
}
