import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { featureFlags } from "@/lib/app/feature-flags";
import { isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { servableExamSpecificationConcepts } from "@/lib/practice/exam-specification-concepts";
import { createLogger } from "@/lib/observability/logger";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  refundAiBudget,
} from "@/services/ai/budgets";
import { getAdminDb } from "@/services/firebase/admin";
import { generateInterventionFlashcards } from "@/services/learning/flashcard-intervention.server";
import { generateInterventionPractice } from "@/services/learning/practice-intervention.server";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";

export const runtime = "nodejs";

const log = createLogger({ route: "learning.interventions.generate" });

/** Enough decks to find the student's existing cards on a concept; a folder rarely has more. */
const DECK_SCAN_LIMIT = 30;

/**
 * Material written in answer to one recommendation.
 *
 * Returns a draft and stores nothing. The student reads what Jami wrote,
 * changes or deletes any of it, and only their confirmation puts anything in
 * their deck or their folder -- so this route is deliberately incapable of
 * adding to a student's material on its own.
 *
 * Generating also does not complete the intervention. A draft nobody accepted
 * helped nobody, and cards nobody has answered say nothing about what anyone
 * knows; the recommendation closes when the work behind it is actually done.
 */

type GenerateKind = "create_flashcards" | "create_practice";

function readBody(body: Record<string, unknown>) {
  const kind = body.kind === "create_practice" ? "create_practice" : "create_flashcards";
  const conceptId = typeof body.conceptId === "string" ? body.conceptId.trim().slice(0, 160) : "";
  const folderId = typeof body.folderId === "string" ? body.folderId.trim().slice(0, 120) : "";
  const interventionId =
    typeof body.interventionId === "string" ? body.interventionId.trim().slice(0, 400) : "";
  return { kind: kind as GenerateKind, conceptId, folderId, interventionId };
}

/**
 * The specification the concept must belong to, from the student's own folder.
 *
 * Read here rather than accepted from the request. A specification id supplied
 * by the caller would let a concept be validated against a course the student
 * is not taking, which is exactly the check `buildFlashcardRequest` exists to
 * perform.
 */
async function loadSpecification(uid: string, folderId: string) {
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("studyFolders")
    .doc(folderId)
    .get();
  if (!snapshot.exists) return null;
  const folder = mapStudyFolderData(snapshot.id, snapshot.data() as Record<string, unknown>);
  if (folder.archived) return null;
  return folder.examCourse?.specificationId ?? null;
}

/** The folder's decks, so the generator can be told which cards already exist. */
async function loadFolderDeckIds(uid: string, folderId: string) {
  try {
    const snapshot = await getAdminDb()
      .collection("decks")
      .where("userId", "==", uid)
      .where("folderIds", "array-contains", folderId)
      .limit(DECK_SCAN_LIMIT)
      .get();
    return snapshot.docs.map((document) => document.id);
  } catch (error) {
    // Costs the exclusions, not the generation: the student will see any
    // repetition in the draft, which is where it is meant to be caught.
    log.warn("decks.unavailable", { error });
    return [];
  }
}

export async function POST(request: NextRequest) {
  if (!featureFlags.enableLearnerProfile || !featureFlags.enableStudyActions) {
    return apiFailure("Not found", 404, "not_found");
  }
  if (!featureFlags.enableFlashcardAi) {
    return apiFailure("Jami cannot write study material here.", 403, "generation_disabled");
  }
  if (!isAnyAiProviderConfigured()) {
    return apiFailure("AI features are not configured.", 503, "ai_unavailable");
  }

  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");

  let input: ReturnType<typeof readBody>;
  try {
    input = readBody((await request.json()) as Record<string, unknown>);
  } catch {
    return apiFailure("Malformed request.", 400, "bad_request");
  }
  if (!input.conceptId || !input.folderId || !input.interventionId) {
    return apiFailure("A concept, a folder and a recommendation are required.", 400, "bad_request");
  }

  const requestLog = createLogger({
    route: "learning.interventions.generate",
    requestId: randomUUID(),
    uid,
  });

  const specificationId = await loadSpecification(uid, input.folderId);
  if (!specificationId) {
    // No course on the folder means no catalogue to validate the concept
    // against, and generating against an unvalidated heading is the one thing
    // the request builder refuses to do.
    return apiFailure("This folder has no course to write material for.", 409, "no_specification");
  }

  const concept = servableExamSpecificationConcepts(specificationId).find(
    (entry) => entry.id === input.conceptId
  );
  if (!concept) {
    return apiFailure("That concept is not part of this course.", 409, "unknown_concept");
  }

  const budget = await checkAiBudget({ uid, action: "interventionMaterial" });
  if (!budget.allowed) return createAiBudgetLimitResponse("interventionMaterial", budget);

  const startedAt = Date.now();
  try {
    if (input.kind === "create_practice") {
      const result = await generateInterventionPractice({
        conceptId: concept.id,
        conceptLabel: concept.label,
        specificationId,
        interventionId: input.interventionId,
      });
      if (!result.ok) {
        await refundAiBudget(budget.grant).catch(() => undefined);
        requestLog.warn("practice.refused", { reason: result.reason });
        return apiFailure(
          "Jami could not write usable questions for this. Nothing has been saved.",
          502,
          result.reason
        );
      }
      requestLog.info("practice.ready", {
        questions: result.questions.length,
        dropped: result.dropped,
        latencyMs: Date.now() - startedAt,
      });
      return Response.json({
        kind: "create_practice",
        conceptId: concept.id,
        conceptLabel: concept.label,
        interventionId: input.interventionId,
        questions: result.questions,
        dropped: result.dropped,
      });
    }

    const result = await generateInterventionFlashcards({
      uid,
      conceptId: concept.id,
      conceptLabel: concept.label,
      specificationId,
      interventionId: input.interventionId,
      deckIds: await loadFolderDeckIds(uid, input.folderId),
    });
    if (!result.ok) {
      await refundAiBudget(budget.grant).catch(() => undefined);
      requestLog.warn("flashcards.refused", { reason: result.reason });
      return apiFailure(
        result.reason === "all_duplicates"
          ? "Everything Jami wrote repeated a card you already have."
          : "Jami could not write usable cards for this. Nothing has been saved.",
        502,
        result.reason
      );
    }
    requestLog.info("flashcards.ready", {
      cards: result.drafts.length,
      dropped: result.droppedDuplicates,
      latencyMs: Date.now() - startedAt,
    });
    return Response.json({
      kind: "create_flashcards",
      conceptId: concept.id,
      conceptLabel: concept.label,
      interventionId: input.interventionId,
      cards: result.drafts,
      dropped: result.droppedDuplicates,
    });
  } catch (error) {
    await refundAiBudget(budget.grant).catch(() => undefined);
    requestLog.warn("generation.failed", { error, latencyMs: Date.now() - startedAt });
    return apiFailure("Jami could not write this right now.", 503, "generation_failed");
  }
}
