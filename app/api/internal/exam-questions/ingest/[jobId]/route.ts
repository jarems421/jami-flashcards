import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import { examIngestionProgress } from "@/lib/practice/exam-ingestion-job";
import {
  advanceExamIngestionJob,
  getExamIngestionJob,
} from "@/services/practice/exam-ingestion-job.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Where a job got to, without doing any more work. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const { jobId } = await params;
  if (!EXAM_ID_PATTERN.test(jobId)) return Response.json({ error: "invalid_job" }, { status: 400 });
  const job = await getExamIngestionJob(jobId);
  if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
  return Response.json({ job, progress: examIngestionProgress(job) });
}

/**
 * Do the next bounded piece of work.
 *
 * One stage per call, so nothing has to fit a whole paper into one request,
 * and a stage that fails is retried on its own rather than taking the paid
 * work before it down with it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const { jobId } = await params;
  if (!EXAM_ID_PATTERN.test(jobId)) return Response.json({ error: "invalid_job" }, { status: 400 });
  try {
    const job = await advanceExamIngestionJob(jobId);
    return Response.json({ job, progress: examIngestionProgress(job) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "step_failed";
    return Response.json({ error: code }, { status: code === "job_not_found" ? 404 : 503 });
  }
}
