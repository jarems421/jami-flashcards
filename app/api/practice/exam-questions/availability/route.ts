import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { ExamQuestionBankError, getExamQuestionAvailability } from "@/services/practice/exam-question-bank.server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const folderId = request.nextUrl.searchParams.get("folderId")?.trim() ?? "";
  const topicIds = request.nextUrl.searchParams.getAll("topicId").slice(0, 20);
  if (!folderId) return apiFailure("Choose a folder.", 400, "folder_required");
  try {
    return Response.json(await getExamQuestionAvailability({ uid, folderId, topicIds }));
  } catch (error) {
    if (error instanceof ExamQuestionBankError) return apiFailure(error.message, error.status, error.code);
    return apiFailure("Question availability could not be loaded.", 503, "availability_failed");
  }
}
