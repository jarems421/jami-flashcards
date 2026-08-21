import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { mapPracticePaperMarkingJobData } from "@/lib/practice/practice-papers";
import {
  enqueuePracticePaperMarking,
  PracticePaperMarkingQueueError,
} from "@/services/ai/practice-paper-marking-jobs.server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

async function authenticate(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try { return (await getAdminAuth().verifyIdToken(token)).uid; } catch { return null; }
}

function failure(error: string, status: number, code: string, retryAfterSeconds?: number) {
  return Response.json(
    { error, code, retryAfterSeconds },
    { status, headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined }
  );
}

export async function GET(request: NextRequest) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const snapshot = await getAdminDb().collection("users").doc(uid)
    .collection("practicePaperMarkingJobs").orderBy("updatedAt", "desc").limit(12).get();
  return Response.json({
    jobs: snapshot.docs.map((document) =>
      mapPracticePaperMarkingJobData(document.id, document.data())
    ),
  });
}

export async function POST(request: NextRequest) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return failure("Invalid request body", 400, "invalid_request");
  }
  try {
    const job = await enqueuePracticePaperMarking({
      uid,
      paperId: typeof body.paperId === "string"
        ? body.paperId
        : typeof body.notebookId === "string" ? body.notebookId : "",
      idempotencyKey: request.headers.get("x-idempotency-key") ?? undefined,
      kind: body.kind === "question_recheck" ? "question_recheck" : "full",
      questionId: typeof body.questionId === "string" ? body.questionId : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    return Response.json(job, { status: 202 });
  } catch (error) {
    if (error instanceof PracticePaperMarkingQueueError) {
      return failure(error.message, error.status, error.code, error.retryAfterSeconds);
    }
    return failure("Jami could not queue the marking just now.", 503, "queue_failed");
  }
}
