import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { start } from "workflow/api";
import { parsePracticePaperGenerationRequest } from "@/lib/ai/practice-paper-generation";
import { isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { mapPracticePaperJobData } from "@/lib/practice/practice-papers";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  refundAiBudget,
} from "@/services/ai/budgets";
import { getAdminDb } from "@/services/firebase/admin";
import { generatePracticePaperWorkflow } from "@/workflows/practice-paper-generation";

export const runtime = "nodejs";

const RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * Builds a failed paper again on the same job, from the request it was
 * created with.
 *
 * A failure refunds its allowance, so a retry is charged like a new paper.
 * Temporary supporting files are deleted when a build ends, so the retry reads
 * only the folder sources that still exist.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  if (!isAnyAiProviderConfigured()) {
    return apiFailure("AI features are not configured", 503, "not_configured");
  }
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { jobId } = await params;
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(jobId)) {
    return apiFailure("Job not found", 404, "job_not_found");
  }

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const jobRef = userRef.collection("practicePaperJobs").doc(jobId);
  const artifactRef = userRef.collection("practicePaperJobArtifacts").doc(jobId);

  const snapshot = await jobRef.get();
  if (!snapshot.exists) return apiFailure("Job not found", 404, "job_not_found");
  const data = snapshot.data() ?? {};
  if (data.status !== "failed") {
    // A second press after the first retry queued gets the same job back.
    return data.status === "queued" || data.status === "running"
      ? Response.json(mapPracticePaperJobData(jobId, data))
      : apiFailure("Only a paper that failed can be tried again.", 409, "job_not_failed");
  }
  const originalRequest = parsePracticePaperGenerationRequest(data.request);
  if (!originalRequest) {
    return apiFailure(
      "The original request for this paper is unavailable. Start a new paper instead.",
      409,
      "request_unavailable"
    );
  }

  const sourceSnapshots = await Promise.all(
    originalRequest.sourceIds.map((sourceId) =>
      userRef.collection("sources").doc(sourceId).get()
    )
  );
  const sourceIds = sourceSnapshots
    .filter((source) => source.exists)
    .map((source) => source.id);

  let budget;
  try {
    budget = await checkAiBudget({
      uid,
      action: "practicePaperGeneration",
      skipBurstLimit: true,
    });
  } catch {
    return apiFailure(
      "AI usage limits are temporarily unavailable.",
      503,
      "budget_unavailable"
    );
  }
  if (!budget.allowed) {
    return createAiBudgetLimitResponse("practicePaperGeneration", budget);
  }

  const requeued = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(jobRef);
    const currentData = current.data() ?? {};
    if (!current.exists || currentData.status !== "failed") return false;
    transaction.update(jobRef, {
      request: { ...originalRequest, sourceIds },
      status: "queued",
      stage: "queued",
      progress: 0,
      cancellationRequested: false,
      budgetGrant: budget.grant,
      budgetRefunded: false,
      retryCount:
        (typeof currentData.retryCount === "number" ? currentData.retryCount : 0) + 1,
      failureCode: FieldValue.delete(),
      failureMessage: FieldValue.delete(),
      failureDismissed: FieldValue.delete(),
      providerStartedAt: FieldValue.delete(),
      startedAt: FieldValue.delete(),
      completedAt: FieldValue.delete(),
      expiresAt: FieldValue.delete(),
      workflowRunId: FieldValue.delete(),
      clarificationResearchAction: FieldValue.delete(),
      updatedAt: Date.now(),
    });
    transaction.delete(artifactRef);
    return true;
  });
  if (!requeued) {
    await refundAiBudget(budget.grant);
    const current = await jobRef.get();
    return Response.json(mapPracticePaperJobData(jobId, current.data() ?? {}));
  }

  try {
    const run = await start(generatePracticePaperWorkflow, [uid, jobId]);
    await jobRef.update({ workflowRunId: run.runId, updatedAt: Date.now() });
    const current = await jobRef.get();
    return Response.json(
      mapPracticePaperJobData(jobId, current.data() ?? {}),
      { status: 202 }
    );
  } catch {
    const now = Date.now();
    await Promise.all([
      refundAiBudget(budget.grant),
      jobRef.update({
        status: "failed",
        failureCode: "workflow_start_failed",
        failureMessage: "Jami could not queue that paper just now.",
        budgetRefunded: true,
        expiresAt: Timestamp.fromMillis(now + RETENTION_MS),
        completedAt: now,
        updatedAt: now,
      }),
    ]);
    return apiFailure(
      "Jami could not queue that paper just now.",
      503,
      "workflow_start_failed"
    );
  }
}
