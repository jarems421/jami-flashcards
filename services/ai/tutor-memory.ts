import type { TutorMemoryKind } from "@/lib/ai/tutor-memory";
import {
  tutorSettingsFailureMessage,
  tutorSettingsHeaders,
} from "@/services/ai/tutor-personalisation";

/** One memory as the student sees it. */
export type TutorMemoryEntry = {
  id: string;
  kind: TutorMemoryKind;
  text: string;
  folderId?: string;
  createdAt: number;
  updatedAt: number;
  /** When it will be forgotten unless it comes up again. */
  fadesAt?: number;
};

export type TutorMemoryView = {
  enabled: boolean;
  items: TutorMemoryEntry[];
};

export type TutorMemoryChange =
  | { target: "enabled"; enabled: boolean }
  | { target: "edit"; id: string; text: string }
  | { target: "forget"; id: string }
  | { target: "forget-all" };

export async function loadTutorMemoryView(signal?: AbortSignal): Promise<TutorMemoryView> {
  const response = await fetch("/api/ai/assistant/memory", {
    headers: await tutorSettingsHeaders(),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(
      await tutorSettingsFailureMessage(response, "Jami could not load what it remembers.")
    );
  }
  return (await response.json()) as TutorMemoryView;
}

/** Applies one change and returns the memory as it now stands. */
export async function changeTutorMemory(change: TutorMemoryChange): Promise<TutorMemoryView> {
  const response = await fetch("/api/ai/assistant/memory", {
    method: "PATCH",
    headers: await tutorSettingsHeaders(true),
    body: JSON.stringify(change),
  });
  if (!response.ok) {
    throw new Error(
      await tutorSettingsFailureMessage(response, "Jami could not save that change.")
    );
  }
  return (await response.json()) as TutorMemoryView;
}
