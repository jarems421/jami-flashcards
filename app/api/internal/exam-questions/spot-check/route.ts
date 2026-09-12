import type { NextRequest } from "next/server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import {
  recordExamPaperSpotCheck,
  revokeExamQuestionBatch,
  sampleApprovedExamQuestions,
} from "@/services/practice/exam-corpus-review.server";

export const runtime = "nodejs";

/**
 * Draw a random sample of one paper's approved questions.
 *
 * The reviewer that approved them is a model, and this is the person reading
 * behind it. Nothing here changes anything: drawing a sample is free and can be
 * done again, which is the point -- a reviewer who loses their place should not
 * be discouraged from starting over.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const paperId = request.nextUrl.searchParams.get("paperId")?.trim() ?? "";
  if (!EXAM_ID_PATTERN.test(paperId)) {
    return Response.json({ error: "invalid_paper" }, { status: 400 });
  }
  const requested = Number(request.nextUrl.searchParams.get("size") ?? 10);
  const size = Number.isFinite(requested) ? requested : 10;
  try {
    return Response.json(await sampleApprovedExamQuestions({ paperId, size }));
  } catch {
    return Response.json({ error: "sample_failed" }, { status: 503 });
  }
}

/**
 * Record the outcome of a sample, and withdraw whatever it rejected.
 *
 * The two happen together on purpose. A spot-check that withdrew questions but
 * was never recorded leaves a paper that looks unchecked; one recorded without
 * the withdrawals leaves questions the reviewer rejected still being served.
 * The revocation runs first, so a failure between them errs towards the paper
 * staying unservable rather than towards bad questions staying live.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const paperId = typeof body.paperId === "string" ? body.paperId : "";
  if (!EXAM_ID_PATTERN.test(paperId)) {
    return Response.json({ error: "invalid_paper" }, { status: 400 });
  }
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? body.size : 0;
  const rejectedIds = Array.isArray(body.rejectedQuestionIds)
    ? body.rejectedQuestionIds.filter((item): item is string => typeof item === "string" && EXAM_ID_PATTERN.test(item))
    : [];
  const notes = typeof body.notes === "string" ? body.notes : undefined;
  if (size < 1) return Response.json({ error: "invalid_sample_size" }, { status: 400 });
  if (rejectedIds.length > size) {
    return Response.json({ error: "more_rejected_than_sampled" }, { status: 400 });
  }
  try {
    if (rejectedIds.length > 0) {
      await revokeExamQuestionBatch({
        questionIds: rejectedIds,
        reviewerUid: auth.uid,
        reason: notes?.trim() || "Rejected during a spot-check of this paper.",
      });
    }
    return Response.json(
      await recordExamPaperSpotCheck({
        paperId,
        reviewerUid: auth.uid,
        size,
        rejected: rejectedIds.length,
        notes,
      })
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "spot_check_failed";
    return Response.json({ error: code }, { status: code === "paper_not_found" ? 404 : 503 });
  }
}
