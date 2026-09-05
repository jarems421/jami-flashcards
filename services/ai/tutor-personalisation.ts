import { auth } from "@/services/firebase/client";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import type {
  TutorCheckUnderstanding,
  TutorExplanationDepth,
  TutorFeedbackDirectness,
  TutorHelpApproach,
  TutorPreferences,
} from "@/lib/ai/tutor-personalisation";
import type { StudyLevel } from "@/lib/profile/study-level";

export type TutorFolderSummary = {
  id: string;
  name: string;
  subject: string | null;
  studyLevel: StudyLevel | null;
  hasInstructions: boolean;
  instructionsUpdatedAt: number;
};

export type TutorFolderInstructions = {
  id: string;
  name: string;
  subject: string | null;
  studyLevel: StudyLevel | null;
  instructions: string;
  instructionsUpdatedAt: number;
};

export type TutorPersonalisation = {
  preferences: TutorPreferences;
  accountStudyLevel: StudyLevel | null;
  accountStudySubjects: string[];
  folders: TutorFolderSummary[];
  folder: TutorFolderInstructions | null;
};

async function headers(json = false) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to change Tutor settings.");
  return {
    Authorization: `Bearer ${await user.getIdToken()}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/**
 * The message to show, preferring what the route said over a generic failure.
 *
 * The two refusals a student can actually cause -- a demo account, and a folder
 * deleted in another tab -- both explain themselves, and repeating "something
 * went wrong" over them would throw that away.
 */
async function failureMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function loadTutorPersonalisation(input: {
  folderId?: string;
  signal?: AbortSignal;
}): Promise<TutorPersonalisation> {
  const query = input.folderId
    ? `?folderId=${encodeURIComponent(input.folderId)}`
    : "";
  const response = await fetch(`/api/ai/assistant/personalisation${query}`, {
    headers: await headers(),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(
      await failureMessage(response, "Jami could not load your Tutor settings.")
    );
  }
  return (await response.json()) as TutorPersonalisation;
}

export async function saveTutorPreferences(input: {
  helpApproach?: TutorHelpApproach;
  explanationDepth?: TutorExplanationDepth;
  feedbackDirectness?: TutorFeedbackDirectness;
  checkUnderstanding?: TutorCheckUnderstanding;
  customGuidance?: string;
  folderGuideCompleted?: boolean;
}) {
  const response = await fetch("/api/ai/assistant/personalisation", {
    method: "PATCH",
    headers: await headers(true),
    body: JSON.stringify({ target: "preferences", ...input }),
  });
  if (!response.ok) {
    throw new Error(
      await failureMessage(response, "Jami could not save your preferences.")
    );
  }
  const result = (await response.json()) as { preferences: TutorPreferences };
  return result.preferences;
}

/**
 * The study level and the courses behind it, saved together.
 *
 * One write rather than two, because they are one answer: moving from GCSE to
 * University while the old subject list is still stored would leave Jami
 * pitching undergraduate work at a set of GCSEs.
 */
export async function saveTutorStudyProfile(input: {
  studyLevel: StudyLevel | null;
  studySubjects: readonly string[];
}) {
  const response = await fetch("/api/ai/assistant/personalisation", {
    method: "PATCH",
    headers: await headers(true),
    body: JSON.stringify({
      target: "study-profile",
      studyLevel: input.studyLevel,
      studySubjects: input.studySubjects,
    }),
  });
  if (!response.ok) {
    throw new Error(
      await failureMessage(response, "Jami could not save your study level.")
    );
  }
  /*
   * The level lives on the user document, which Today and the study surfaces
   * read through the shared cache. Without this a student could change their
   * level and watch the rest of the app keep pitching at the old one until the
   * cache aged out.
   */
  if (auth.currentUser) invalidateDashboardData(auth.currentUser.uid);
  return (await response.json()) as {
    studyLevel: StudyLevel | null;
    studySubjects: string[];
  };
}

export async function saveFolderTutorInstructions(input: {
  folderId: string;
  instructions: string;
}) {
  const response = await fetch("/api/ai/assistant/personalisation", {
    method: "PATCH",
    headers: await headers(true),
    body: JSON.stringify({ target: "folder-instructions", ...input }),
  });
  if (!response.ok) {
    throw new Error(
      await failureMessage(response, "Jami could not save these instructions.")
    );
  }
  const result = (await response.json()) as {
    folder: { id: string; instructions: string; instructionsUpdatedAt: number };
  };
  return result.folder;
}
