import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import {
  revisionSessionResponse,
  revisionSessionsEnabled,
} from "@/services/learning/revision-session-context.server";
import { loadRevisionSession } from "@/services/learning/revision-sessions.server";

export const runtime = "nodejs";

/** A session as the screen may see it: the current step, and no answers early. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  if (!revisionSessionsEnabled()) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  const record = await loadRevisionSession(uid, sessionId.slice(0, 120));
  if (!record) return apiFailure("That session could not be found.", 404, "not_found");
  return revisionSessionResponse(record);
}
