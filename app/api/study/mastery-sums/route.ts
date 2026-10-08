import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { readTopicMasterySums } from "@/services/study/mastery-summary.server";
import { createLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";

const log = createLogger({ route: "study.mastery-sums" });

/** The signed-in student's summed early-practice score for each topic. */
export async function GET(request: NextRequest) {
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");

  try {
    return Response.json(
      { topics: await readTopicMasterySums(uid) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    log.error("mastery.read_failed", { error });
    return apiFailure("Your earlier practice could not be read just now.", 503, "mastery_unavailable");
  }
}
