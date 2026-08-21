import type { NextRequest } from "next/server";
import {
  loadPaperGenerationBenchmarkArtifact,
  reviewPaperGenerationBenchmarkCase,
} from "@/services/ai/paper-generation-benchmark.server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";

export const runtime = "nodejs";

function valid(value: string) { return /^[A-Za-z0-9_-]{8,220}$/.test(value); }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; caseId: string }> }
) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const { runId, caseId } = await params;
  if (!valid(runId) || !valid(caseId)) return Response.json({ error: "not_found" }, { status: 404 });
  const artifact = await loadPaperGenerationBenchmarkArtifact(runId, caseId);
  return artifact ? Response.json({ artifact }) : Response.json({ error: "not_found" }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; caseId: string }> }
) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const { runId, caseId } = await params;
  if (!valid(runId) || !valid(caseId)) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const review = await reviewPaperGenerationBenchmarkCase({
      reviewerUid: auth.uid,
      runId,
      caseId,
      usable: body.usable === true,
      scores: body.scores,
      blockers: body.blockers,
      comments: typeof body.comments === "string" ? body.comments : undefined,
    });
    return Response.json({ review });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the review." }, { status: 400 });
  }
}
