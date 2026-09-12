import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import {
  ExamTopicTaggingError,
  tagExamQuestionTopics,
} from "@/services/practice/exam-topic-tagging.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Tag untagged questions on one specification, a bounded batch at a time.
 *
 * Each question costs a provider request, so the batch is capped and the caller
 * decides whether to go round again -- a run that quietly walks a whole corpus
 * is a bill nobody chose. The response reports what is left.
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
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 10;
  try {
    return Response.json(await tagExamQuestionTopics({ specificationId, limit, paperId }));
  } catch (error) {
    // A specification with no checked catalogue is a configuration answer, not
    // an outage: the caller is told which, so it is not retried forever.
    if (error instanceof ExamTopicTaggingError) {
      return Response.json({ error: error.code }, { status: 409 });
    }
    return Response.json({ error: "topic_tagging_failed" }, { status: 503 });
  }
}
