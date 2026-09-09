import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import { featureFlags } from "@/lib/app/feature-flags";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string; attemptId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId, attemptId } = await params;
  if (![sessionId, attemptId].every((id) => EXAM_ID_PATTERN.test(id))) return apiFailure("Not found", 404, "not_found");
  const attempt = (await getAdminDb().collection("users").doc(uid).collection("examAttempts").doc(attemptId).get()).data();
  if (attempt?.sessionId !== sessionId || attempt.answerDeletedAt || typeof attempt.workingSnapshotPath !== "string" || !attempt.workingSnapshotPath.startsWith(`users/${uid}/examAttemptEvidence/${attemptId}/`)) return apiFailure("Not found", 404, "not_found");
  const [bytes] = await getAdminStorageBucket().file(attempt.workingSnapshotPath).download();
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
