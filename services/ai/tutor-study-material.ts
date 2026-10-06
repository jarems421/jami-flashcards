import { auth } from "@/services/firebase/client";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import {
  normalizeTutorStudyMaterialResult,
  type TutorStudyMaterialChoice,
  type TutorStudyMaterialKind,
  type TutorStudyMaterialResult,
} from "@/lib/ai/tutor-study-material";
import { reportAllowanceRefusal } from "@/services/billing/allowance-events";

export type TutorFlashcardDraftPreview = {
  id: string;
  front: string;
  back: string;
};

function friendlyError(status: number, kind: TutorStudyMaterialKind, message?: string) {
  if (status === 401) return "Sign in again to make these.";
  if (status === 429) return message || "Jami has reached today's limit for this. Try again later.";
  if (message) return message;
  return kind === "flashcards"
    ? "Jami could not make those flashcards just now. Try again in a moment."
    : "Jami could not write that practice set just now. Try again in a moment.";
}

/**
 * Makes the flashcards or practice set Tutor agreed to on one of its answers.
 *
 * Returns what was made -- drafts to review, or a set to start -- and the
 * record the chat keeps of it.
 */
export async function requestTutorStudyMaterial(input: {
  threadId: string;
  messageId: string;
  kind: TutorStudyMaterialKind;
  context: JamiAssistantContext;
  /** What the student chose, when Tutor asked what to make first. */
  choice?: TutorStudyMaterialChoice;
  signal?: AbortSignal;
}): Promise<{ result: TutorStudyMaterialResult; drafts?: TutorFlashcardDraftPreview[] }> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const response = await fetch("/api/ai/assistant/study-material", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({
      threadId: input.threadId,
      messageId: input.messageId,
      kind: input.kind,
      context: input.context,
      ...(input.choice ? { choice: input.choice } : {}),
    }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    reportAllowanceRefusal(data);
    throw new Error(
      friendlyError(response.status, input.kind, typeof data?.error === "string" ? data.error : undefined)
    );
  }
  const result = normalizeTutorStudyMaterialResult(data?.result);
  if (!result) throw new Error(friendlyError(502, input.kind));
  const drafts = Array.isArray(data?.drafts)
    ? data.drafts.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const item = candidate as Record<string, unknown>;
        return typeof item.id === "string" && typeof item.front === "string" && typeof item.back === "string"
          ? [{ id: item.id, front: item.front, back: item.back }]
          : [];
      })
    : undefined;
  return { result, ...(drafts ? { drafts } : {}) };
}
