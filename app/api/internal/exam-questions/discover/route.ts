import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { isExamBoardId } from "@/lib/practice/exam-formats";
import { findIngestibleExamPapers } from "@/services/practice/exam-corpus-review.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The papers a licensed course has available, ready to ingest.
 *
 * Read-only: it reads board catalogues and returns manifests, and writes
 * nothing. Ingesting one is a separate, deliberate call per paper, because
 * each costs two vision passes over two PDFs and there is no reason to spend
 * that on a list somebody has not looked at yet.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const board = typeof body.board === "string" ? body.board : "";
  const specificationId = typeof body.specificationId === "string" ? body.specificationId.trim() : "";
  if (!isExamBoardId(board) || !specificationId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const found = await findIngestibleExamPapers({ board, specificationId });
    if (!found.course) return Response.json({ error: "course_not_in_catalogue" }, { status: 404 });
    return Response.json(found);
  } catch {
    return Response.json({ error: "discovery_failed" }, { status: 503 });
  }
}
