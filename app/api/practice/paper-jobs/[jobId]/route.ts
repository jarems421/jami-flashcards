import type { NextRequest } from "next/server";
import type { AiBudgetGrant } from "@/lib/ai/budgets";
import { Timestamp } from "firebase-admin/firestore";
import { getBearerToken } from "@/lib/auth/bearer";
import {
  canCancelPracticePaperJob,
} from "@/lib/practice/practice-paper-jobs";
import {
  mapPracticePaperJobData,
} from "@/lib/practice/practice-papers";
import { refundAiBudget } from "@/services/ai/budgets";
import {
  cleanPracticePaperWorkflowRemnants,
  cleanTemporaryPracticePaperSources,
} from "@/services/ai/practice-paper-workflow.server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

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

function validJobId(value: string) {
  return /^[A-Za-z0-9_-]{16,160}$/.test(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { jobId } = await params;
  if (!validJobId(jobId)) return failure("Job not found", 404, "job_not_found");
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("practicePaperJobs")
    .doc(jobId)
    .get();
  if (!snapshot.exists) return failure("Job not found", 404, "job_not_found");
  return Response.json(mapPracticePaperJobData(jobId, snapshot.data() ?? {}));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { jobId } = await params;
  if (!validJobId(jobId)) return failure("Job not found", 404, "job_not_found");
  const db = getAdminDb();
  const jobRef = db
    .collection("users")
    .doc(uid)
    .collection("practicePaperJobs")
    .doc(jobId);
  let grant: AiBudgetGrant | undefined;
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) return null;
    const job = mapPracticePaperJobData(jobId, snapshot.data() ?? {});
    if (!canCancelPracticePaperJob(job.status)) return job;
    const data = snapshot.data() ?? {};
    const refundable = !data.providerStartedAt && data.budgetRefunded !== true;
    if (refundable) grant = data.budgetGrant as AiBudgetGrant | undefined;
    const now = Date.now();
    transaction.update(jobRef, {
      status: "cancelled",
      cancellationRequested: true,
      budgetRefunded: refundable,
      expiresAt: Timestamp.fromMillis(now + 30 * 24 * 60 * 60_000),
      completedAt: now,
      updatedAt: now,
    });
    return mapPracticePaperJobData(jobId, {
      ...data,
      status: "cancelled",
      cancellationRequested: true,
      completedAt: now,
      updatedAt: now,
    });
  });
  if (!result) return failure("Job not found", 404, "job_not_found");
  if (grant) await refundAiBudget(grant);
  await Promise.all([
    cleanPracticePaperWorkflowRemnants(uid, jobId),
    cleanTemporaryPracticePaperSources(uid, jobId),
  ]);
  return Response.json(result);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { jobId } = await params;
  if (!validJobId(jobId)) return failure("Job not found", 404, "job_not_found");
  const ref = getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("practicePaperJobs")
    .doc(jobId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return failure("Job not found", 404, "job_not_found");
  if (snapshot.data()?.status === "ready") {
    await ref.update({ readyUnread: false, updatedAt: Date.now() });
  }
  return Response.json(mapPracticePaperJobData(jobId, {
    ...snapshot.data(),
    readyUnread: false,
  }));
}
