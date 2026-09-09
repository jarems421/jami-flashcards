import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import { reviewPendingExamQuestionsWithAi } from "@/services/practice/exam-corpus-review.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Run the reviewer over pending questions, a bounded batch at a time.
 *
 * Each question costs a vision request, so the batch is capped and the caller
 * decides whether to go round again -- a run that quietly walks a whole corpus
 * is a bill nobody chose. The response reports what is left.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const paperId = typeof body.paperId === "string" ? body.paperId : undefined;
  if (paperId && !EXAM_ID_PATTERN.test(paperId)) {
    return Response.json({ error: "invalid_paper" }, { status: 400 });
  }
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 10;
  try {
    return Response.json(await reviewPendingExamQuestionsWithAi({ limit, paperId }));
  } catch {
    return Response.json({ error: "auto_review_failed" }, { status: 503 });
  }
}
