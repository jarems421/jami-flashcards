import type { NextRequest } from "next/server";
import { loadPaperGenerationBenchmarkAsset } from "@/services/ai/paper-generation-benchmark.server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";

export const runtime = "nodejs";

function valid(value: string) { return /^[A-Za-z0-9_-]{1,220}$/.test(value); }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; caseId: string; assetId: string }> }
) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const { runId, caseId, assetId } = await params;
  if (!valid(runId) || !valid(caseId) || !valid(assetId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const asset = await loadPaperGenerationBenchmarkAsset(runId, caseId, assetId);
  if (!asset) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private,no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
