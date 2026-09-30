import type { NextRequest } from "next/server";
import {
  apiFailure,
  authenticateRequest,
  authenticateWriteRequest,
} from "@/services/auth/authenticate-request.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { normalizeSourceDraftDepth } from "@/lib/ai/source-draft-quality";
import {
  PRACTICE_SET_MAX_FOCUS_LENGTH,
  practiceSetCountForDepth,
  practiceSetTitle,
} from "@/lib/practice/practice-sets";
import {
  createPracticeSet,
  listReadyPracticeSets,
  loadSourcePracticeSetScope,
  PracticeSetError,
  type CreatePracticeSetInput,
} from "@/services/practice/practice-sets.server";
import { checkAiBudget, createAiBudgetLimitResponse, refundAiBudget } from "@/services/ai/budgets";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { createLogger } from "@/lib/observability/logger";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
/** Writing a set is a supervisor call per five questions; the platform default is too short. */
export const maxDuration = 300;

function readText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function readIds(value: unknown, maxItems: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && /^[\w.:-]{1,160}$/.test(item)).slice(0, maxItems)
    : [];
}

export async function GET(request: NextRequest) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  try {
    return Response.json({ sets: await listReadyPracticeSets(uid) });
  } catch {
    return apiFailure("Practice sets could not be loaded.", 503, "practice_sets_failed");
  }
}

/**
 * Makes a practice set from a source, or from one of Jami's recommendations.
 *
 * Tutor's own sets are made by the Tutor study-material route, which checks
 * the chat they came from; this one takes a source the student owns, or a
 * folder and the topic the Learning Engine picked out.
 */
export async function POST(request: NextRequest) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiFailure("Invalid request body.", 400, "invalid_request");
  }

  const focus = readText(body.focus, PRACTICE_SET_MAX_FOCUS_LENGTH);
  let input: CreatePracticeSetInput;
  try {
    if (body.origin === "source") {
      const sourceId = readText(body.sourceId, 160);
      if (!sourceId) return apiFailure("Choose a source.", 400, "invalid_request");
      const scope = await loadSourcePracticeSetScope(uid, sourceId);
      // The student's recent Tutor chat about this source, when they chose to use it.
      const conversation =
        typeof body.conversation === "string" ? body.conversation.trim().slice(0, 1_500) : "";
      input = {
        uid,
        origin: "source",
        focus: focus || `The key ideas in ${scope.title}`,
        title: focus ? practiceSetTitle(focus) : scope.title,
        count: practiceSetCountForDepth(normalizeSourceDraftDepth(body.depth)),
        ...(scope.folderId ? { folderId: scope.folderId } : {}),
        context: conversation
          ? `Tutoring conversation about this source (most recent last):\n${conversation}\n\n${scope.context}`
          : scope.context,
        sourceIds: [sourceId],
      };
    } else if (body.origin === "learning") {
      const folderId = readText(body.folderId, 160);
      if (!folderId || !focus) return apiFailure("Choose a folder and a topic.", 400, "invalid_request");
      input = {
        uid,
        origin: "learning",
        focus,
        folderId,
        topicIds: readIds(body.topicIds, 10),
        conceptIds: readIds(body.conceptIds, 10),
        context: "Jami recommended this from the student's recent marked work in this folder.",
      };
    } else {
      return apiFailure("Choose where the practice set comes from.", 400, "invalid_request");
    }
  } catch (error) {
    if (error instanceof PracticeSetError) return apiFailure(error.message, error.status, error.code);
    return apiFailure("That practice set could not be prepared.", 503, "practice_set_failed");
  }

  const budget = await checkAiBudget({ uid, action: "practicePaperGeneration" }).catch(() => null);
  if (!budget) {
    return apiFailure("AI usage limits are temporarily unavailable. Try again shortly.", 503, "budget_unavailable");
  }
  if (!budget.allowed) return createAiBudgetLimitResponse("practicePaperGeneration", budget);
  enterAiSpendContext(aiSpendContextFor(uid, "practicePaperGeneration"));

  const log = createLogger({ route: "practice.practice-sets", requestId: randomUUID(), uid });
  try {
    const session = await createPracticeSet(input);
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    await refundAiBudget(budget.grant).catch(() => undefined);
    if (error instanceof PracticeSetError) return apiFailure(error.message, error.status, error.code);
    log.error("practice_set.create_failed", { origin: input.origin, error });
    return apiFailure("Jami could not write that practice set just now. Try again in a moment.", 503, "practice_set_failed");
  }
}
