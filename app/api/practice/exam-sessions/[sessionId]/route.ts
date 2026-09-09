import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import { ExamQuestionBankError, getExamSession } from "@/services/practice/exam-question-bank.server";
import { featureFlags } from "@/lib/app/feature-flags";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  if (!EXAM_ID_PATTERN.test(sessionId)) return apiFailure("Session not found.", 404, "session_not_found");
  try { return Response.json(await getExamSession(uid, sessionId)); }
  catch (error) {
    if (error instanceof ExamQuestionBankError) return apiFailure(error.message, error.status, error.code);
    return apiFailure("This session could not be loaded.", 503, "session_load_failed");
  }
}
