import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/observability/logger";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { revisionSessionsEnabled } from "@/services/learning/revision-session-context.server";
import { loadRevisionOptions } from "@/services/learning/revision-options.server";

export const runtime = "nodejs";
export const maxDuration = 30;

const log = createLogger({ route: "learning.revision-sessions.options" });

/**
 * What a student can start a session on in one folder.
 *
 * Labels, headings and a "Jami suggests" flag -- never a mastery figure. The
 * engine's view shapes the order; it is not shown as a number.
 */
export async function GET(request: NextRequest) {
  if (!revisionSessionsEnabled()) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const folderId = request.nextUrl.searchParams.get("folderId")?.trim().slice(0, 200) ?? "";
  if (!folderId) return apiFailure("Which folder?", 400, "bad_request");

  try {
    const loaded = await loadRevisionOptions(uid, folderId);
    if (!loaded) return apiFailure("That folder could not be found.", 404, "not_found");
    return Response.json({
      folder: { id: loaded.folder.id, name: loaded.folder.name },
      options: loaded.options,
    });
  } catch (error) {
    log.warn("options.failed", { error });
    return apiFailure("Jami couldn't list this folder's topics just now.", 503, "options_failed");
  }
}
