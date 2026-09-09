import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { ingestExamPaper, type ExamPaperIngestionManifest } from "@/services/practice/exam-question-ingestion.server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as { manifest?: ExamPaperIngestionManifest; dryRun?: boolean };
  if (!body.manifest) return Response.json({ error: "manifest_required" }, { status: 400 });
  try { return Response.json(await ingestExamPaper(body.manifest, { dryRun: body.dryRun === true })); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "ingestion_failed" }, { status: 422 }); }
}
