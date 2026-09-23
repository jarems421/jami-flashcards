import "server-only";

import { isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { featureFlags } from "@/lib/app/feature-flags";
import { projectRevisionSession } from "@/lib/revision/view";
import type { RevisionSessionRecord, RevisionTarget } from "@/lib/revision/types";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";
import type { RevisionConceptContext } from "@/services/ai/revision-session.server";
import { apiFailure } from "@/services/auth/authenticate-request.server";
import { getAdminDb } from "@/services/firebase/admin";

/** Whether this deployment can run a Revision Session at all. */
export function revisionSessionsEnabled() {
  return (
    featureFlags.enableRevisionSessions &&
    featureFlags.enableLearnerProfile &&
    featureFlags.enableStudyActions
  );
}

/** The routes' answer when the surface is off, so an unused deployment reveals nothing. */
export function revisionSessionsUnavailable() {
  if (!revisionSessionsEnabled()) return apiFailure("Not found", 404, "not_found");
  if (!isAnyAiProviderConfigured()) {
    return apiFailure("Jami's teaching isn't switched on here.", 503, "ai_unavailable");
  }
  return null;
}

/**
 * What the model is told about the subject, read from the student's own folder.
 *
 * The course and level only -- enough to pitch the lesson. Never their other
 * work, their marks or anything they have written: a lesson is about the
 * concept, and what the student knows is the engine's business, not the
 * prompt's.
 */
export async function loadRevisionConceptContext(
  uid: string,
  target: RevisionTarget
): Promise<RevisionConceptContext> {
  const context: RevisionConceptContext = { conceptLabel: target.conceptLabel };
  if (!target.folderId) return context;
  try {
    const snapshot = await getAdminDb()
      .collection("users")
      .doc(uid)
      .collection("studyFolders")
      .doc(target.folderId)
      .get();
    if (!snapshot.exists) return context;
    const folder = mapStudyFolderData(snapshot.id, snapshot.data() as Record<string, unknown>);
    const course = folder.examCourse
      ? [folder.examCourse.board, folder.examCourse.qualification, folder.examCourse.specificationTitle]
          .filter(Boolean)
          .join(" ")
      : "";
    return {
      ...context,
      ...(course ? { course } : {}),
      ...(folder.studyLevel ? { level: String(folder.studyLevel) } : {}),
    };
  } catch {
    // A lesson pitched without the course is still a lesson.
    return context;
  }
}

/** What every session route answers with. */
export function revisionSessionResponse(
  record: RevisionSessionRecord,
  extra: { feedback?: string; selfGrade?: { answer: string; solution: string } } = {},
  status = 200
) {
  return Response.json({ session: projectRevisionSession(record), ...extra }, { status });
}
