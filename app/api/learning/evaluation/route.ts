import type { NextRequest } from "next/server";
import { featureFlags } from "@/lib/app/feature-flags";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { evaluateLearnerModel } from "@/services/learning/learner-model-evaluation.server";

export const runtime = "nodejs";

/**
 * How well the learner model has predicted the signed-in student's own
 * answers in one folder or deck. Aggregate calibration numbers only.
 */
export async function GET(request: NextRequest) {
  if (!featureFlags.enableLearnerProfile) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");

  const folderId = request.nextUrl.searchParams.get("folderId")?.trim().slice(0, 160) || undefined;
  const deckId = request.nextUrl.searchParams.get("deckId")?.trim().slice(0, 160) || undefined;
  if (!folderId && !deckId) {
    return apiFailure("Choose a folder or deck to evaluate.", 400, "invalid_request");
  }
  try {
    const evaluation = await evaluateLearnerModel({
      uid,
      ...(folderId ? { folderId } : { deckId }),
    });
    if (!evaluation) return apiFailure("That folder or deck could not be found.", 404, "not_found");
    return Response.json({ evaluation });
  } catch {
    return apiFailure("The evaluation could not be run right now.", 503, "evaluation_unavailable");
  }
}
