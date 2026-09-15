import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import {
  ExamQuestionDetailsTaggingError,
  tagExamQuestionDetails,
} from "@/services/practice/exam-question-details-tagging.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Tag one specification's questions with concepts and command words, a bounded
 * batch at a time.
 *
 * Each question costs a provider request, so the batch is capped and the caller
 * decides whether to go round again, continuing from the cursor it was given.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const specificationId = typeof body.specificationId === "string" ? body.specificationId.trim() : "";
  if (!specificationId || specificationId.length > 160) {
    return Response.json({ error: "invalid_specification" }, { status: 400 });
  }
  const paperId = typeof body.paperId === "string" ? body.paperId : undefined;
  if (paperId && !EXAM_ID_PATTERN.test(paperId)) {
    return Response.json({ error: "invalid_paper" }, { status: 400 });
  }
  const cursor = typeof body.cursor === "string" ? body.cursor : undefined;
  if (cursor && !EXAM_ID_PATTERN.test(cursor)) {
    return Response.json({ error: "invalid_cursor" }, { status: 400 });
  }
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 10;
  try {
    return Response.json(await tagExamQuestionDetails({ specificationId, limit, paperId, cursor }));
  } catch (error) {
    // No checked catalogue is a configuration answer, not an outage, so it is not retried forever.
    if (error instanceof ExamQuestionDetailsTaggingError) {
      return Response.json({ error: error.code }, { status: 409 });
    }
    return Response.json({ error: "details_tagging_failed" }, { status: 503 });
  }
}
