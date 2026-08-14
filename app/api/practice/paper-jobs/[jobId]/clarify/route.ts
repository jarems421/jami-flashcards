import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { start } from "workflow/api";
import { parsePracticePaperGenerationRequest } from "@/lib/ai/practice-paper-generation";
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
  let answer = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 800) : "";
  } catch {
    return failure("Invalid request body", 400, "invalid_request");
  }
  if (answer.length < 2) {
    return failure("Add the detail Jami asked for.", 400, "clarification_required");
  }

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const jobRef = userRef.collection("practicePaperJobs").doc(jobId);
  const artifactRef = userRef.collection("practicePaperJobArtifacts").doc(jobId);
  let clarificationQuestion = "";
  const reset = await db.runTransaction(async (transaction) => {
    const [snapshot, artifactSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(artifactRef),
    ]);
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    if (data.status !== "needs_clarification") return { conflict: true as const, data };
    const existingRequest = parsePracticePaperGenerationRequest(data.request);
    if (!existingRequest) throw new Error("The original paper request is unavailable.");
    clarificationQuestion = typeof data.clarificationQuestion === "string"
      ? data.clarificationQuestion.slice(0, 600)
      : "Clarify the assessment format.";
    const clarification = `\n\nJami asked: ${clarificationQuestion}\nStudent clarified: ${answer}`;
    const nextRequest = {
      ...existingRequest,
      request: `${existingRequest.request.slice(0, Math.max(0, 2_000 - clarification.length))}${clarification}`,
    };
    // Reuse completed research for ordinary content clarifications. Questions
    // that can change the authoritative assessment evidence invalidate it so
    // the resumed workflow researches the newly supplied format/course detail.
    const researchMustBeRepeated = /\b(?:exam(?:ination)?\s*board|specification|syllabus|institution|university|module|course|qualification|paper\s*code|assessment\s*(?:brief|format)|official\s*format)\b/i
      .test(`${clarificationQuestion}\n${answer}`);
    const now = Date.now();
    transaction.update(jobRef, {
      request: nextRequest,
      status: "queued",
      stage: "queued",
      progress: 0,
      cancellationRequested: false,
      clarificationQuestion: FieldValue.delete(),
      completedAt: FieldValue.delete(),
      expiresAt: FieldValue.delete(),
      workflowRunId: FieldValue.delete(),
      retryCount: (typeof data.retryCount === "number" ? data.retryCount : 0) + 1,
      clarificationResearchAction: researchMustBeRepeated
        ? "rerun_authoritative_evidence"
        : "reuse_completed_evidence",
      updatedAt: now,
    });
    if (artifactSnapshot.exists) {
      if (researchMustBeRepeated) {
        transaction.delete(artifactRef);
      } else {
        transaction.update(artifactRef, {
          generation: FieldValue.delete(),
          figures: FieldValue.delete(),
          expiresAt: FieldValue.delete(),
        });
      }
    }
    return { conflict: false as const, data: { ...data, request: nextRequest, updatedAt: now } };
  });
  if (!reset) return failure("Job not found", 404, "job_not_found");
  if (reset.conflict) {
    return failure("This paper no longer needs clarification.", 409, "job_not_waiting");
  }

  try {
    const run = await start(generatePracticePaperWorkflow, [uid, jobId]);
    await jobRef.update({ workflowRunId: run.runId, updatedAt: Date.now() });
    const current = await jobRef.get();
    return Response.json(mapPracticePaperJobData(jobId, current.data() ?? {}), { status: 202 });
  } catch {
    const now = Date.now();
    await jobRef.update({
      status: "needs_clarification",
      clarificationQuestion,
      expiresAt: Timestamp.fromMillis(now + RETENTION_MS),
      completedAt: now,
      updatedAt: now,
    });
    return failure("Jami could not resume that paper just now.", 503, "workflow_start_failed");
  }
}
