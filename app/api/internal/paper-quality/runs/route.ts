import type { NextRequest } from "next/server";
import { start } from "workflow/api";
import {
  createPaperGenerationBenchmarkRun,
  getPaperBenchmarkReadiness,
  listPaperGenerationBenchmarkRuns,
} from "@/services/ai/paper-generation-benchmark.server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { runPaperGenerationBenchmarkWorkflow } from "@/workflows/paper-generation-benchmark";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const [readiness, runs] = await Promise.all([
    getPaperBenchmarkReadiness(),
    listPaperGenerationBenchmarkRuns(),
  ]);
  return Response.json({ readiness, runs });
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  let spendCeilingUsd = 0;
  let kind: "pilot" | "baseline" = "baseline";
  try {
    const body = await request.json() as Record<string, unknown>;
    spendCeilingUsd = typeof body.spendCeilingUsd === "number" ? body.spendCeilingUsd : 0;
    kind = body.kind === "pilot" ? "pilot" : "baseline";
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const run = await createPaperGenerationBenchmarkRun({ reviewerUid: auth.uid, spendCeilingUsd, kind });
    const workflow = await start(runPaperGenerationBenchmarkWorkflow, [run.id]);
    return Response.json({ run, workflowRunId: workflow.runId }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not start the benchmark." }, { status: 400 });
  }
}
