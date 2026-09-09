import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import type { ExamPaperIngestionManifest } from "@/lib/practice/exam-ingestion-manifest";
import { startExamIngestionJob } from "@/services/practice/exam-ingestion-job.server";

export const runtime = "nodejs";

/**
 * Start ingesting a paper, and return immediately.
 *
 * Ingestion used to be one request that read two PDFs, made five model calls,
 * rendered a region for every question and wrote them all. The same paper
 * finished at 86 seconds and timed out at 103, on the same code -- and every
 * failure threw away the model calls that had already been paid for. It is a
 * job now; the caller advances it a stage at a time.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as {
    manifest?: ExamPaperIngestionManifest;
    dryRun?: boolean;
  };
  if (!body.manifest) return Response.json({ error: "manifest_required" }, { status: 400 });
  try {
    const job = await startExamIngestionJob({
      manifest: body.manifest,
      dryRun: body.dryRun === true,
    });
    return Response.json({ job }, { status: 202 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "ingestion_failed" },
      { status: 422 }
    );
  }
}
