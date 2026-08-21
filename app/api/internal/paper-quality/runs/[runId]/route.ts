import type { NextRequest } from "next/server";
import { start } from "workflow/api";
import {
  approvePaperGenerationBenchmarkRun,
  cancelPaperGenerationBenchmarkRun,
  getPaperGenerationBenchmarkRun,
  resumePaperGenerationBenchmarkRun,
} from "@/services/ai/paper-generation-benchmark.server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { runPaperGenerationBenchmarkWorkflow } from "@/workflows/paper-generation-benchmark";

export const runtime = "nodejs";

function valid(value: string) { return /^[A-Za-z0-9_-]{16,160}$/.test(value); }

export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const { runId } = await params;
  if (!valid(runId)) return Response.json({ error: "not_found" }, { status: 404 });
  const detail = await getPaperGenerationBenchmarkRun(runId);
  return detail ? Response.json(detail) : Response.json({ error: "not_found" }, { status: 404 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const { runId } = await params;
  if (!valid(runId)) return Response.json({ error: "not_found" }, { status: 404 });
  await cancelPaperGenerationBenchmarkRun(runId);
  return Response.json({ ok: true });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const { runId } = await params;
  if (!valid(runId)) return Response.json({ error: "not_found" }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
  try {
    if (body.action === "approve") {
      return Response.json(await approvePaperGenerationBenchmarkRun(runId, auth.uid));
    }
    if (body.action === "resume" && typeof body.spendCeilingUsd === "number") {
      await resumePaperGenerationBenchmarkRun(runId, body.spendCeilingUsd);
      const workflow = await start(runPaperGenerationBenchmarkWorkflow, [runId]);
      return Response.json({ ok: true, workflowRunId: workflow.runId }, { status: 202 });
    }
    return Response.json({ error: "invalid_action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the benchmark." }, { status: 400 });
  }
}
