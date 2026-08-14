import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { start } from "workflow/api";
import { parsePracticePaperGenerationRequest } from "@/lib/ai/practice-paper-generation";
import { isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { getBearerToken } from "@/lib/auth/bearer";
import { mapPracticePaperJobData } from "@/lib/practice/practice-papers";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  refundAiBudget,
} from "@/services/ai/budgets";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { generatePracticePaperWorkflow } from "@/workflows/practice-paper-generation";

export const runtime = "nodejs";

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

function normalizeIdempotencyKey(value: string | null) {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{16,120}$/.test(normalized)
    ? normalized
    : randomUUID();
}

export async function GET(request: NextRequest) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("practicePaperJobs")
    .orderBy("updatedAt", "desc")
    .limit(12)
    .get();
  return Response.json({
    jobs: snapshot.docs.map((document) =>
      mapPracticePaperJobData(document.id, document.data())
    ),
  });
}

export async function POST(request: NextRequest) {
  if (!isAnyAiProviderConfigured()) {
    return failure("AI features are not configured", 503, "not_configured");
  }
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");

  let parsedRequest;
  let temporarySourceIds: string[] = [];
  try {
    const body = await request.json() as Record<string, unknown>;
    parsedRequest = parsePracticePaperGenerationRequest(body);
    temporarySourceIds = Array.isArray(body.temporarySourceIds)
      ? Array.from(new Set(body.temporarySourceIds.flatMap((value) =>
          typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value.trim())
            ? [value.trim()]
            : []
        ))).slice(0, 15)
      : [];
  } catch {
    return failure("Invalid request body", 400, "invalid_request");
  }
  if (!parsedRequest) {
    return failure("Invalid practice paper request", 400, "invalid_request");
  }
  if (temporarySourceIds.some((sourceId) => !parsedRequest.sourceIds.includes(sourceId))) {
    return failure("Temporary sources must be included in the selected source list.", 400, "invalid_request");
  }

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const folder = await userRef
    .collection("studyFolders")
    .doc(parsedRequest.folderId)
    .get();
  if (!folder.exists) return failure("Folder not found", 404, "folder_not_found");
  if (temporarySourceIds.length > 0) {
    const temporarySources = await Promise.all(
      temporarySourceIds.map((sourceId) => userRef.collection("sources").doc(sourceId).get())
    );
    const valid = temporarySources.every((source) => {
      const data = source.data() ?? {};
      return source.exists &&
        data.type === "file" &&
        typeof data.title === "string" &&
        data.title.startsWith("Temporary paper context: ") &&
        Array.isArray(data.folderIds) &&
        data.folderIds.includes(parsedRequest.folderId) &&
        typeof data.storagePath === "string" &&
        data.storagePath.startsWith(`users/${uid}/sourceFiles/${source.id}/`);
    });
    if (!valid) {
      return failure("One or more temporary files are invalid.", 400, "invalid_temporary_source");
    }
  }

  const jobId = normalizeIdempotencyKey(
    request.headers.get("x-idempotency-key")
  );
  const jobRef = userRef.collection("practicePaperJobs").doc(jobId);
  const existing = await jobRef.get();
  if (existing.exists) {
    return Response.json(mapPracticePaperJobData(jobId, existing.data() ?? {}));
  }

  let budget;
  try {
    budget = await checkAiBudget({
      uid,
      action: "practicePaperGeneration",
      skipBurstLimit: true,
    });
  } catch {
    return failure(
      "AI usage limits are temporarily unavailable.",
      503,
      "budget_unavailable"
    );
  }
  if (!budget.allowed) {
    return createAiBudgetLimitResponse("practicePaperGeneration", budget);
  }

  const paperId = randomUUID();
  const now = Date.now();
  const title = parsedRequest.request.slice(0, 160) || "Practice paper";
  const created = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(jobRef);
    if (current.exists) return false;
    transaction.create(jobRef, {
      paperId,
      folderId: parsedRequest.folderId,
      status: "queued",
      stage: "queued",
      progress: 0,
      title,
      request: parsedRequest,
      temporarySourceIds,
      budgetGrant: budget.grant,
      budgetRefunded: false,
      cancellationRequested: false,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return true;
  });
  if (!created) {
    await refundAiBudget(budget.grant);
    const current = await jobRef.get();
    return Response.json(mapPracticePaperJobData(jobId, current.data() ?? {}));
  }

  try {
    // Workflow history contains only opaque ownership identifiers. The step
    // loads the private request and budget grant from the server-owned job.
    const run = await start(generatePracticePaperWorkflow, [uid, jobId]);
    await jobRef.update({ workflowRunId: run.runId, updatedAt: Date.now() });
    return Response.json(
      mapPracticePaperJobData(jobId, {
        paperId,
        folderId: parsedRequest.folderId,
        status: "queued",
        stage: "queued",
        progress: 0,
        title,
        workflowRunId: run.runId,
        cancellationRequested: false,
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 202 }
    );
  } catch {
    await Promise.all([
      refundAiBudget(budget.grant),
      jobRef.update({
        status: "failed",
        failureCode: "workflow_start_failed",
        failureMessage: "Jami could not queue that paper just now.",
        budgetRefunded: true,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ]);
    return failure(
      "Jami could not queue that paper just now.",
      503,
      "workflow_start_failed"
    );
  }
}
