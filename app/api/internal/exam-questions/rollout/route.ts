import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { isExamBoardId } from "@/lib/practice/exam-formats";
import { ENGLAND_MATHS_AND_SCIENCE } from "@/lib/practice/exam-corpus-plan";
import {
  queueExamCorpusBatch,
  seedExamFormatCatalogue,
} from "@/services/practice/exam-corpus-rollout.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The courses in the rollout, and whether each can be addressed by pattern. */
export async function GET(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  return Response.json({ targets: ENGLAND_MATHS_AND_SCIENCE });
}

/**
 * Seed the catalogue, or queue a whole course's papers.
 *
 * Queuing finds the papers without making a single model call, so what a run
 * will cost is known before any of it is spent.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  if (body.action === "seed") {
    try {
      return Response.json(await seedExamFormatCatalogue());
    } catch {
      return Response.json({ error: "seed_failed" }, { status: 503 });
    }
  }

  const board = typeof body.board === "string" ? body.board : "";
  const specificationId = typeof body.specificationId === "string" ? body.specificationId.trim() : "";
  const years = Array.isArray(body.years)
    ? body.years.filter((year): year is number => typeof year === "number" && year > 2000 && year < 2100).slice(0, 12)
    : [];
  if (!isExamBoardId(board) || !specificationId || years.length === 0) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const batch = await queueExamCorpusBatch({
      board,
      specificationId,
      years,
      dryRun: body.dryRun === true,
    });
    return Response.json({ batch }, { status: 202 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "queue_failed";
    return Response.json({ error: code }, { status: code === "specification_not_in_rollout" ? 404 : 503 });
  }
}
