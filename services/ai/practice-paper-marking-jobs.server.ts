import "server-only";

import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import type { AiBudgetGrant } from "@/lib/ai/budgets";
import {
  mapPracticePaperMarkingJobData,
  type PracticePaperMarkingJob,
  type PracticePaperMarkingJobKind,
} from "@/lib/practice/practice-papers";
import { checkAiBudget, refundAiBudget } from "@/services/ai/budgets";
import { getAdminDb } from "@/services/firebase/admin";
import { markPracticePaperWorkflow } from "@/workflows/practice-paper-marking";

export class PracticePaperMarkingQueueError extends Error {
  constructor(
    readonly code:
      | "workflow_disabled"
      | "providers_unavailable"
      | "paper_not_found"
      | "paper_not_submitted"
      | "paper_not_marked"
      | "question_not_found"
      | "allowance_unavailable"
      | "daily_limit"
      | "workflow_start_failed",
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "PracticePaperMarkingQueueError";
  }
}

function enabled() {
  return process.env.PRACTICE_PAPER_MARKING_WORKFLOW_ENABLED === "true";
}

function safeId(value: unknown, maximum = 160) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length <= maximum && /^[A-Za-z0-9_-]+$/.test(normalized)
    ? normalized
    : "";
}

async function startJob(uid: string, jobId: string) {
  const jobRef = getAdminDb().collection("users").doc(uid)
    .collection("practicePaperMarkingJobs").doc(jobId);
  try {
    const run = await start(markPracticePaperWorkflow, [uid, jobId]);
    await jobRef.update({ workflowRunId: run.runId, updatedAt: Date.now() });
  } catch {
    await jobRef.update({
      status: "failed",
      failureCode: "workflow_start_failed",
      failureMessage: "Jami could not queue the marking just now. Your submitted work is safe.",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    throw new PracticePaperMarkingQueueError(
      "workflow_start_failed",
      "Jami could not queue the marking just now. Your submitted work is safe.",
      503
    );
  }
}

export async function enqueuePracticePaperMarking(input: {
  uid: string;
  paperId: string;
  idempotencyKey?: string;
  kind?: PracticePaperMarkingJobKind;
  questionId?: string;
  reason?: string;
}): Promise<PracticePaperMarkingJob> {
  if (!enabled()) {
    throw new PracticePaperMarkingQueueError(
      "workflow_disabled",
      "Background paper marking is not enabled in this deployment yet.",
      503
    );
  }
  if (
    !isAnyAiProviderConfigured("worker") ||
    !isAnyAiProviderConfigured("supervisor") ||
    !isAnyAiProviderConfigured("documentVision")
  ) {
    throw new PracticePaperMarkingQueueError(
      "providers_unavailable",
      "Paper marking is temporarily unavailable in this deployment.",
      503
    );
  }
  const paperId = safeId(input.paperId);
  if (!paperId) {
    throw new PracticePaperMarkingQueueError("paper_not_found", "Practice paper not found.", 404);
  }
  const kind: PracticePaperMarkingJobKind = input.kind === "question_recheck"
    ? "question_recheck"
    : "full";
  const questionId = kind === "question_recheck" ? safeId(input.questionId, 80) : "";
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  const db = getAdminDb();
  const userRef = db.collection("users").doc(input.uid);
  const paperRef = userRef.collection("pastPapers").doc(paperId);
  const paperSnapshot = await paperRef.get();
  if (!paperSnapshot.exists) {
    throw new PracticePaperMarkingQueueError("paper_not_found", "Practice paper not found.", 404);
  }
  const paper = paperSnapshot.data() ?? {};
  const attemptId = safeId(paper.activeAttemptId);
  if (!attemptId) {
    throw new PracticePaperMarkingQueueError("paper_not_submitted", "Submit the paper before asking Jami to mark it.", 409);
  }
  if (kind === "full" && paper.status !== "submitted") {
    throw new PracticePaperMarkingQueueError("paper_not_submitted", "Submit the paper before asking Jami to mark it.", 409);
  }
  if (kind === "question_recheck") {
    const questionResults = paper.result && typeof paper.result === "object"
      ? (paper.result as { questionResults?: unknown }).questionResults
      : null;
    const hasQuestion = Array.isArray(questionResults) && questionResults.some((candidate) =>
      candidate && typeof candidate === "object" && (candidate as { questionId?: unknown }).questionId === questionId
    );
    if (paper.status !== "marked" || !hasQuestion || reason.length < 3) {
      throw new PracticePaperMarkingQueueError(
        questionId ? "paper_not_marked" : "question_not_found",
        questionId ? "This paper is not ready for that recheck." : "Question not found.",
        409
      );
    }
  }

  const requestedJobId = safeId(input.idempotencyKey, 120);
  const jobId = requestedJobId.length >= 16 ? requestedJobId : randomUUID();
  const jobRef = userRef.collection("practicePaperMarkingJobs").doc(jobId);
  const existing = await jobRef.get();
  if (existing.exists) {
    const data = existing.data() ?? {};
    if (["cancelled", "failed", "paused"].includes(String(data.status))) {
      await jobRef.update({
        status: "queued",
        stage: "queued",
        progress: 0,
        cancellationRequested: false,
        failureCode: null,
        failureMessage: null,
        completedAt: null,
        retryCount: (typeof data.retryCount === "number" ? data.retryCount : 0) + 1,
        updatedAt: Date.now(),
      });
      await startJob(input.uid, jobId);
      const restarted = await jobRef.get();
      return mapPracticePaperMarkingJobData(jobId, restarted.data() ?? {});
    }
    return mapPracticePaperMarkingJobData(jobId, data);
  }

  let budget;
  try {
    budget = await checkAiBudget({
      uid: input.uid,
      action: "practicePaperMarking",
      skipBurstLimit: true,
    });
  } catch {
    throw new PracticePaperMarkingQueueError(
      "allowance_unavailable",
      "AI usage limits are temporarily unavailable.",
      503
    );
  }
  if (!budget.allowed) {
    throw new PracticePaperMarkingQueueError(
      "daily_limit",
      "Jami has reached today's paper-marking limit. Try again tomorrow.",
      429,
      budget.retryAfterSeconds
    );
  }

  const now = Date.now();
  const record = {
    paperId,
    attemptId,
    kind,
    questionId: questionId || null,
    reason: reason || null,
    status: "queued",
    stage: "queued",
    progress: 0,
    title: typeof paper.title === "string" ? paper.title.slice(0, 160) : "Practice paper",
    budgetGrant: budget.grant,
    cancellationRequested: false,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const created = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(jobRef);
    if (current.exists) return false;
    transaction.create(jobRef, record);
    transaction.set(userRef.collection("practicePaperMarkingJobArtifacts").doc(jobId), {
      createdAt: now,
      updatedAt: now,
    });
    return true;
  });
  if (!created) {
    await refundAiBudget(budget.grant as AiBudgetGrant);
    const current = await jobRef.get();
    return mapPracticePaperMarkingJobData(jobId, current.data() ?? {});
  }
  try {
    await startJob(input.uid, jobId);
  } catch (error) {
    // A queued allowance stays attached to this immutable attempt so retrying
    // the same job never consumes another daily mark.
    throw error;
  }
  const started = await jobRef.get();
  return mapPracticePaperMarkingJobData(jobId, started.data() ?? record);
}
