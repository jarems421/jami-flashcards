import type { NextRequest } from "next/server";
import { featureFlags } from "@/lib/app/feature-flags";
import { readPracticeDrafts } from "@/lib/learning/interventions/practice-request";
import { servableExamSpecificationConcepts } from "@/lib/practice/exam-specification-concepts";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";
import { createLogger } from "@/lib/observability/logger";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { getAdminDb } from "@/services/firebase/admin";
import { storeInterventionPractice } from "@/services/learning/practice-material.server";

export const runtime = "nodejs";

const log = createLogger({ route: "learning.interventions.practice" });

/**
 * Keeping questions the student has agreed to.
 *
 * A route rather than a client write because a practice paper is not the
 * browser's to create: the rules admit only an *uploaded* paper with no
 * questions and no marks from there, and the answer-bearing scheme has to go
 * somewhere no client can read. See `storeInterventionPractice`.
 *
 * The questions are validated again here even though they were validated when
 * they were generated. They have been through a person since: the review
 * screen lets the student rewrite a prompt, change an answer or edit a scheme
 * point, and a scheme that no longer accounts for its question's tariff cannot
 * be marked. Trusting the client's copy would mean a student could store, by
 * accident, a paper Jami then fails to mark.
 */
export async function POST(request: NextRequest) {
  if (!featureFlags.enableLearnerProfile || !featureFlags.enableStudyActions) {
    return apiFailure("Not found", 404, "not_found");
  }
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiFailure("Malformed request.", 400, "bad_request");
  }

  const conceptId = typeof body.conceptId === "string" ? body.conceptId.trim().slice(0, 160) : "";
  const folderId = typeof body.folderId === "string" ? body.folderId.trim().slice(0, 120) : "";
  const interventionId =
    typeof body.interventionId === "string" ? body.interventionId.trim().slice(0, 400) : "";
  if (!conceptId || !folderId || !interventionId) {
    return apiFailure("A concept, a folder and a recommendation are required.", 400, "bad_request");
  }

  /*
   * The folder is read rather than trusted, for the same reason the generator
   * reads it: a specification supplied by the caller would let a concept be
   * validated against a course the student is not taking.
   */
  const folderSnapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("studyFolders")
    .doc(folderId)
    .get();
  if (!folderSnapshot.exists) return apiFailure("That folder is not yours.", 404, "unknown_folder");
  const folder = mapStudyFolderData(
    folderSnapshot.id,
    folderSnapshot.data() as Record<string, unknown>
  );
  const specificationId = folder.archived ? "" : folder.examCourse?.specificationId ?? "";
  if (!specificationId) {
    return apiFailure("This folder has no course to keep material for.", 409, "no_specification");
  }

  const concept = servableExamSpecificationConcepts(specificationId).find(
    (entry) => entry.id === conceptId
  );
  if (!concept) {
    return apiFailure("That concept is not part of this course.", 409, "unknown_concept");
  }

  // The same fail-closed validator the generator was held to.
  const read = readPracticeDrafts(body.questions);
  if (!read.ok) {
    log.warn("questions.rejected", { reason: read.reason });
    return apiFailure(
      read.reason === "schemes_disagree_with_marks"
        ? "A mark scheme no longer accounts for every mark its question is worth."
        : "These questions could not be saved.",
      422,
      read.reason
    );
  }

  try {
    const stored = await storeInterventionPractice({
      uid,
      folderId,
      conceptId: concept.id,
      conceptLabel: concept.label,
      interventionId,
      questions: read.questions,
    });
    log.info("practice.stored", { questions: read.questions.length, dropped: read.dropped });
    return Response.json(stored);
  } catch (error) {
    log.warn("practice.store_failed", { error });
    return apiFailure("Could not save these questions.", 503, "store_failed");
  }
}
