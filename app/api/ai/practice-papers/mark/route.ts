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
  let notebookId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    notebookId = typeof body.notebookId === "string" ? body.notebookId : "";
  } catch {
    return failure("Invalid request body", 400, "invalid_request");
  }
  try {
    const job = await enqueuePracticePaperMarking({
      uid,
      paperId: notebookId,
      idempotencyKey: request.headers.get("x-idempotency-key") ?? undefined,
      kind: "full",
    });
    return Response.json(job, { status: 202 });
  } catch (error) {
    if (error instanceof PracticePaperMarkingQueueError) {
      return failure(error.message, error.status, error.code);
    }
    return failure("Jami could not queue the marking just now.", 503, "queue_failed");
  }
}
