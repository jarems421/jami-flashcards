import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { enqueuePracticePaperMarking, PracticePaperMarkingQueueError } from "@/services/ai/practice-paper-marking-jobs.server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return apiFailure("Invalid request body", 400, "invalid_request");
  }
  try {
    const job = await enqueuePracticePaperMarking({
      uid,
      paperId: typeof body.notebookId === "string" ? body.notebookId : "",
      idempotencyKey: request.headers.get("x-idempotency-key") ?? undefined,
      kind: "question_recheck",
      questionId: typeof body.questionId === "string" ? body.questionId : "",
      reason: typeof body.reason === "string" ? body.reason : "",
    });
    return Response.json(job, { status: 202 });
  } catch (error) {
    if (error instanceof PracticePaperMarkingQueueError) {
      return apiFailure(error.message, error.status, error.code);
    }
    return apiFailure("Jami could not queue that recheck just now.", 503, "queue_failed");
  }
}
