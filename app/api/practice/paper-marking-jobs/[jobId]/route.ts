import { Timestamp } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { canCancelPracticePaperMarkingJob } from "@/lib/practice/practice-paper-marking-jobs";
import { mapPracticePaperMarkingJobData } from "@/lib/practice/practice-papers";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

async function authenticate(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try { return (await getAdminAuth().verifyIdToken(token)).uid; } catch { return null; }
}

function failure(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status });
}

function validJobId(value: string) {
  return /^[A-Za-z0-9_-]{16,160}$/.test(value);
}

async function getJob(uid: string, jobId: string) {
  return getAdminDb().collection("users").doc(uid)
    .collection("practicePaperMarkingJobs").doc(jobId).get();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { jobId } = await params;
  if (!validJobId(jobId)) return failure("Job not found", 404, "job_not_found");
  const snapshot = await getJob(uid, jobId);
  if (!snapshot.exists) return failure("Job not found", 404, "job_not_found");
  return Response.json(mapPracticePaperMarkingJobData(jobId, snapshot.data() ?? {}));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { jobId } = await params;
  if (!validJobId(jobId)) return failure("Job not found", 404, "job_not_found");
  const ref = getAdminDb().collection("users").doc(uid)
    .collection("practicePaperMarkingJobs").doc(jobId);
  const result = await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const job = mapPracticePaperMarkingJobData(jobId, snapshot.data() ?? {});
    if (!canCancelPracticePaperMarkingJob(job.status)) return job;
    const now = Date.now();
    const data = snapshot.data() ?? {};
    transaction.update(ref, {
      status: "cancelled",
      cancellationRequested: true,
      failureCode: null,
      failureMessage: null,
      expiresAt: Timestamp.fromMillis(now + 30 * 24 * 60 * 60_000),
      completedAt: now,
      updatedAt: now,
    });
    return mapPracticePaperMarkingJobData(jobId, {
      ...data,
      status: "cancelled",
      cancellationRequested: true,
      completedAt: now,
      updatedAt: now,
    });
  });
  if (!result) return failure("Job not found", 404, "job_not_found");
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
  const ref = getAdminDb().collection("users").doc(uid)
    .collection("practicePaperMarkingJobs").doc(jobId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return failure("Job not found", 404, "job_not_found");
  if (snapshot.data()?.status === "ready") {
    await ref.update({ readyUnread: false, updatedAt: Date.now() });
  }
  return Response.json(mapPracticePaperMarkingJobData(jobId, {
    ...snapshot.data(), readyUnread: false,
  }));
}
