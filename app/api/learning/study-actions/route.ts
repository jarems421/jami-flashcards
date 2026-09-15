import type { NextRequest } from "next/server";
import { featureFlags } from "@/lib/app/feature-flags";
import { createLogger } from "@/lib/observability/logger";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { loadStudyActions } from "@/services/learning/study-actions.server";

export const runtime = "nodejs";

const log = createLogger({ route: "learning.study-actions" });

/** The signed-in student's next study actions, for Today. Reads only; no AI. */
export async function GET(request: NextRequest) {
  if (!featureFlags.enableLearnerProfile || !featureFlags.enableStudyActions) {
    return apiFailure("Not found", 404, "not_found");
  }
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");

  const startedAt = Date.now();
  try {
    const result = await loadStudyActions({ uid });
    log.info("study_actions.completed", {
      consumer: "today",
      latencyMs: Date.now() - startedAt,
      folders: result.evaluatedFolders,
      failedFolders: result.failedFolders,
      actions: result.actions.length,
      reasons: result.actions.map((action) => action.reason),
    });
    return Response.json(result);
  } catch (error) {
    log.warn("study_actions.failed", {
      consumer: "today",
      latencyMs: Date.now() - startedAt,
      error,
    });
    return apiFailure("Recommendations are unavailable right now.", 503, "study_actions_unavailable");
  }
}
