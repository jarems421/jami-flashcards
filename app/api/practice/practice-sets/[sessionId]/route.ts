import type { NextRequest } from "next/server";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import { PracticeSetError, updatePracticeSet } from "@/services/practice/practice-sets.server";

export const runtime = "nodejs";

/** Keeps a practice set, or turns it down. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  if (!EXAM_ID_PATTERN.test(sessionId)) return apiFailure("Practice set not found.", 404, "not_found");
  let action: unknown;
  try {
    action = ((await request.json()) as Record<string, unknown>).action;
  } catch {
    return apiFailure("Invalid request body.", 400, "invalid_request");
  }
  if (action !== "accept" && action !== "dismiss") {
    return apiFailure("Choose to keep or dismiss the set.", 400, "invalid_request");
  }
  try {
    return Response.json({ session: await updatePracticeSet(uid, sessionId, action) });
  } catch (error) {
    if (error instanceof PracticeSetError) return apiFailure(error.message, error.status, error.code);
    return apiFailure("That practice set could not be updated.", 503, "practice_set_update_failed");
  }
}
