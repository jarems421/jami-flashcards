import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { featureFlags } from "@/lib/app/feature-flags";

export const runtime = "nodejs";

/**
 * Read one preparation job.
 *
 * The job record exists so a student who reloads, or who started preparing on
 * another device, can still see how it went. Ownership is checked against the
 * stored userId; a job id on its own proves nothing.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  if (!featureFlags.enableStudyModes) {
    return Response.json(
      { error: "Study modes are not enabled.", code: "not_enabled" },
      { status: 404 }
    );
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return Response.json(
      { error: "Unauthorized", code: "unauthorized" },
      { status: 401 }
    );
  }

  let uid: string;
  try {
    uid = (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return Response.json(
      { error: "Unauthorized", code: "unauthorized" },
      { status: 401 }
    );
  }

  const { jobId } = await context.params;
  const snapshot = await getAdminDb()
    .collection("cardStudyAssetJobs")
    .doc(jobId)
    .get();
  const data = snapshot.data();
  // Someone else's job is reported as missing rather than forbidden, so the
  // response cannot be used to discover which job ids exist.
  if (!snapshot.exists || !data || data.userId !== uid) {
    return Response.json(
      { error: "Job not found", code: "not_found" },
      { status: 404 }
    );
  }

  return Response.json({
    jobId: snapshot.id,
    deckId: data.deckId ?? null,
    status: data.status ?? "running",
    requested: data.requested ?? 0,
    prepared: data.prepared ?? 0,
    reused: data.reused ?? 0,
    failed: data.failed ?? 0,
  });
}
