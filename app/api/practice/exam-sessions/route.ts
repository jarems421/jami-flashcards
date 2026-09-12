import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { isExamCalculatorChoice, normalizeDifficultyMix } from "@/lib/practice/exam-questions";
import { createExamSession, ExamQuestionBankError, listExamSessions } from "@/services/practice/exam-question-bank.server";
import { queueOfficialExamSourceDiscovery } from "@/services/practice/exam-source-discovery.server";
import { checkAiBudget, createAiBudgetLimitResponse, refundAiBudget } from "@/services/ai/budgets";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import { aiSpendContextFor } from "@/services/ai/spend.server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  try {
    const before = Number(request.nextUrl.searchParams.get("before"));
    return Response.json(
      await listExamSessions(
        uid,
        request.nextUrl.searchParams.get("folderId") ?? undefined,
        Number.isFinite(before) && before > 0 ? before : undefined
      )
    );
  } catch {
    return apiFailure("Practice history could not be loaded.", 503, "history_failed");
  }
}

export async function POST(request: NextRequest) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return apiFailure("Invalid request body.", 400, "invalid_request");
  }
  const mix = normalizeDifficultyMix(body.mix);
  const folderId = typeof body.folderId === "string" ? body.folderId.trim() : "";
  if (!mix || !folderId) return apiFailure("Choose a folder and 1 to 20 questions.", 400, "invalid_request");
  const allowGenerated = body.allowGenerated === true;
  const generationBudget = allowGenerated ? await checkAiBudget({ uid, action: "practicePaperGeneration" }) : null;
  if (generationBudget && !generationBudget.allowed) return createAiBudgetLimitResponse("practicePaperGeneration", generationBudget);
  if (generationBudget?.allowed) enterAiSpendContext(aiSpendContextFor(uid, "practicePaperGeneration"));
  try {
    const session = await createExamSession({
      uid,
      folderId,
      mix,
      topicIds: Array.isArray(body.topicIds) ? body.topicIds.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
      originNotebookId: typeof body.originNotebookId === "string" ? body.originNotebookId.trim() : undefined,
      allowGenerated,
      useAvailableOnly: body.useAvailableOnly === true,
      ...(isExamCalculatorChoice(body.calculator) ? { calculator: body.calculator } : {}),
    });
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    if (generationBudget?.allowed) await refundAiBudget(generationBudget.grant).catch(() => undefined);
    if (error instanceof ExamQuestionBankError) {
      // The shortage detail travels as fields on the error, not encoded into
      // its code. It was `coverage_gap:{"easy":2}` split on ":", which cuts at
      // the first colon inside the JSON -- so the parse always failed, the
      // client never saw a missing mix, and the fallback card never rendered.
      const code = error.code;
      // A shortage is the signal that this course needs papers. Go and look
      // for them behind the answer rather than making the student wait on a
      // crawl that cannot help the session they are trying to start.
      if (code === "coverage_gap" && error.course) {
        void queueOfficialExamSourceDiscovery({
          board: error.course.board,
          specificationId: error.course.specificationId,
          subject: error.course.specificationTitle,
        }).catch(() => undefined);
      }
      return apiFailure(error.message, error.status, code, {
        missingByDifficulty: error.missingByDifficulty,
        availableMix: error.availableMix,
      });
    }
    return apiFailure("This session could not be created.", 503, "session_create_failed");
  }
}
