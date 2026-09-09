import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import {
  decideExamQuestionReview,
  listExamQuestionsAwaitingReview,
} from "@/services/practice/exam-corpus-review.server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const paperId = request.nextUrl.searchParams.get("paperId")?.trim() || undefined;
  if (paperId && !EXAM_ID_PATTERN.test(paperId)) {
    return Response.json({ error: "invalid_paper" }, { status: 400 });
  }
  try {
    return Response.json({ questions: await listExamQuestionsAwaitingReview(paperId) });
  } catch {
    return Response.json({ error: "review_list_failed" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  const decision = body.decision === "accept" || body.decision === "reject" ? body.decision : null;
  if (!EXAM_ID_PATTERN.test(questionId) || !decision) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    await decideExamQuestionReview({ questionId, decision, reviewerUid: auth.uid });
    return Response.json({ questionId, decision });
  } catch (error) {
    const code = error instanceof Error ? error.message : "review_failed";
    return Response.json(
      {
        error: code,
        message: code === "publication_blocked"
          ? "This question failed a structural check at ingestion, so it cannot be approved. Re-ingest the paper instead."
          : undefined,
      },
      { status: code === "question_not_found" ? 404 : 422 }
    );
  }
}
