import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import {
  backfillPaperSheets,
  listExamSheetBackfillPapers,
} from "@/services/practice/exam-sheet-backfill.server";

export const runtime = "nodejs";

/**
 * Giving papers already in the bank the pages a student writes on.
 *
 * A GET reports what is left to do and costs nothing. A POST does one bounded
 * slice of one paper and says where to resume, so a long paper is walked the
 * way an ingestion is rather than run inside one request.
 *
 * No model is called on either path. See `exam-sheet-backfill.server.ts` for
 * why this exists rather than a re-ingest.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  try {
    return Response.json({ papers: await listExamSheetBackfillPapers() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "sheets_unavailable" },
      { status: 422 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = (await request.json().catch(() => ({}))) as {
    paperId?: string;
    from?: number;
    limit?: number;
  };
  if (!body.paperId || !EXAM_ID_PATTERN.test(body.paperId)) {
    return Response.json({ error: "paper_required" }, { status: 400 });
  }
  try {
    const result = await backfillPaperSheets({
      paperId: body.paperId,
      from: Number(body.from) || 0,
      limit: Number(body.limit) || 4,
    });
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "sheets_failed" },
      { status: 422 }
    );
  }
}
