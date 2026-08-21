import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { start } from "workflow/api";
import { parsePracticePaperGenerationRequest } from "@/lib/ai/practice-paper-generation";
import { normalizePracticePaperBrief } from "@/lib/practice/exam-formats";
import { getBearerToken } from "@/lib/auth/bearer";
import { mapPracticePaperJobData } from "@/lib/practice/practice-papers";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { generatePracticePaperWorkflow } from "@/workflows/practice-paper-generation";

export const runtime = "nodejs";

const RETENTION_MS = 30 * 24 * 60 * 60_000;

function failure(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status });
}

async function authenticate(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { jobId } = await params;
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(jobId)) {
    return failure("Job not found", 404, "job_not_found");
  }
  let action: "confirm" | "correct" | "use_custom";
  let correction = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== "confirm" && body.action !== "correct" && body.action !== "use_custom") {
      return failure("Choose how Jami should continue.", 400, "invalid_action");
    }
    action = body.action;
    correction = typeof body.correction === "string" ? body.correction.trim().slice(0, 800) : "";
  } catch {
    return failure("Invalid request body", 400, "invalid_request");
  }
  if (action === "correct" && correction.length < 2) {
    return failure("Tell Jami what to correct.", 400, "correction_required");
  }

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const jobRef = userRef.collection("practicePaperJobs").doc(jobId);
  const artifactRef = userRef.collection("practicePaperJobArtifacts").doc(jobId);
  const reset = await db.runTransaction(async (transaction) => {
    const [jobSnapshot, artifactSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(artifactRef),
    ]);
    if (!jobSnapshot.exists) return null;
    const data = jobSnapshot.data() ?? {};
    if (data.status !== "needs_confirmation") return { conflict: true as const };
    const requestValue = parsePracticePaperGenerationRequest(data.request);
    if (!requestValue) throw new Error("The original paper request is unavailable.");
    const now = Date.now();
    let nextRequest = requestValue;
    if (action === "correct") {
      const detail = `\n\nStudent correction to the inferred exam format: ${correction}`;
      nextRequest = {
        ...requestValue,
        request: `${requestValue.request.slice(0, Math.max(0, 2_000 - detail.length))}${detail}`,
      };
    }
    const currentBrief = normalizePracticePaperBrief(data.paperBrief);
    const nextBrief = action === "use_custom" && currentBrief
      ? { ...currentBrief, verificationStatus: "custom" as const, requiresConfirmation: false }
      : currentBrief;
    transaction.update(jobRef, {
      request: nextRequest,
      status: "queued",
      stage: "queued",
      progress: 0,
      paperBrief: nextBrief ?? FieldValue.delete(),
      formatConfirmed: action === "confirm",
      customFormatAllowed: action === "use_custom",
      cancellationRequested: false,
      completedAt: FieldValue.delete(),
      expiresAt: FieldValue.delete(),
      workflowRunId: FieldValue.delete(),
      retryCount: (typeof data.retryCount === "number" ? data.retryCount : 0) + 1,
      updatedAt: now,
    });
    if (artifactSnapshot.exists) {
      if (action === "correct") {
        transaction.delete(artifactRef);
      } else if (action === "use_custom") {
        const artifact = artifactSnapshot.data() ?? {};
        const generation = artifact.generation as Record<string, unknown> | undefined;
        const response = generation?.response as Record<string, unknown> | undefined;
        const assessmentProfile = response?.assessmentProfile as Record<string, unknown> | undefined;
        if (generation && response && assessmentProfile) {
          const customProfile = { ...assessmentProfile };
          delete customProfile.profileId;
          delete customProfile.profileVersion;
          transaction.update(artifactRef, {
            "generation.response.assessmentProfile": {
              ...customProfile,
              verificationStatus: "custom",
            },
            "format.promptContext": FieldValue.delete(),
            updatedAt: now,
          });
        } else {
          transaction.update(artifactRef, { "format.promptContext": FieldValue.delete(), updatedAt: now });
        }
      }
    }
    return { conflict: false as const, previousBrief: currentBrief };
  });
  if (!reset) return failure("Job not found", 404, "job_not_found");
  if (reset.conflict) return failure("This paper no longer needs confirmation.", 409, "job_not_waiting");

  try {
    const run = await start(generatePracticePaperWorkflow, [uid, jobId]);
    await jobRef.update({ workflowRunId: run.runId, updatedAt: Date.now() });
    const current = await jobRef.get();
    return Response.json(mapPracticePaperJobData(jobId, current.data() ?? {}), { status: 202 });
  } catch {
    const now = Date.now();
    await jobRef.update({
      status: "needs_confirmation",
      paperBrief: reset.previousBrief ?? null,
      expiresAt: Timestamp.fromMillis(now + RETENTION_MS),
      completedAt: now,
      updatedAt: now,
    });
    return failure("Jami could not resume that paper just now.", 503, "workflow_start_failed");
  }
}
