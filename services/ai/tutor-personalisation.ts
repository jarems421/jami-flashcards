import { auth } from "@/services/firebase/client";
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
