import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { enqueuePracticePaperMarking, PracticePaperMarkingQueueError } from "@/services/ai/practice-paper-marking-jobs.server";
import { getAdminAuth } from "@/services/firebase/admin";

export const runtime = "nodejs";

function failure(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status });
}

export async function POST(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return failure("Unauthorized", 401, "unauthorized");
  let uid: string;
  try { uid = (await getAdminAuth().verifyIdToken(token)).uid; } catch {
    return failure("Unauthorized", 401, "unauthorized");
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return failure("Invalid request body", 400, "invalid_request");
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
      return failure(error.message, error.status, error.code);
    }
    return failure("Jami could not queue that recheck just now.", 503, "queue_failed");
  }
}
