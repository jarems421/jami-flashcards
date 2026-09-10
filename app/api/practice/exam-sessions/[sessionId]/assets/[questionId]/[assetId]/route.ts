import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { EXAM_ID_PATTERN, type ExamSession } from "@/lib/practice/exam-questions";
import { loadServableExamQuestion } from "@/services/practice/exam-evidence.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { featureFlags } from "@/lib/app/feature-flags";
import { candidateExamAssets } from "@/lib/practice/exam-assets";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string; questionId: string; assetId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId, questionId, assetId } = await params;
  if (![sessionId, questionId, assetId].every((value) => EXAM_ID_PATTERN.test(value))) return apiFailure("Asset not found.", 404, "asset_not_found");
  const db = getAdminDb();
  const sessionSnapshot = await db.collection("users").doc(uid).collection("examSessions").doc(sessionId).get();
  const session = sessionSnapshot.data() as ExamSession | undefined;
  const sessionQuestion = session?.questions.find(
    (item) => item.id === questionId && item.assets.some((asset) => asset.id === assetId)
  );
  if (!sessionSnapshot.exists || !sessionQuestion) {
    return apiFailure("Asset not found.", 404, "asset_not_found");
  }
  /*
   * The image this session was built on. Serving whatever sits under the id
   * today meant a re-ingest changed the picture in front of a student who was
   * part-way through answering it.
   */
  const question = await loadServableExamQuestion(
    questionId,
    uid,
    sessionQuestion.contentVersion
  ).catch(() => null);
  if (!question) {
    return apiFailure("Asset not found.", 404, "asset_not_found");
  }
  const asset = candidateExamAssets(question).find((item) => item.id === assetId);
  const path = typeof asset?.storagePath === "string" ? asset.storagePath : "";
  const mimeType = typeof asset?.mimeType === "string" ? asset.mimeType : "";
  if (!path.startsWith("internal/examQuestionBank/") || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return apiFailure("Asset not found.", 404, "asset_not_found");
  const [bytes] = await getAdminStorageBucket().file(path).download();
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
