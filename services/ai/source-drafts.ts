import { auth } from "@/services/firebase/client";
import type {
  SourceDraftDepth,
  SourceDraftKind,
} from "@/lib/ai/source-draft-quality";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";

function friendlyError(status: number, message?: string) {
  if (status === 429) return "Jami has reached today's draft limit. Try again tomorrow.";
  if (status === 503) return "AI drafting is not configured in this deployment yet.";
  if (status === 422) {
    return message || "Jami could not find enough material in this source to draft from.";
  }
  return message || "Jami could not generate drafts just now.";
}

/**
 * Ask Jami to draft flashcards or practice questions from a source.
 *
 * The route writes the drafts to users/{uid}/generatedContentDrafts itself, so
 * they flow straight into the existing review, edit, and convert pipeline. The
 * returned drafts are for immediate display; the drawer reloads from Firestore.
 */
export async function generateSourceDrafts(input: {
  sourceId: string;
  kind: SourceDraftKind;
  /** How thorough to be. Decides how many drafts and how granular each is. */
  depth: SourceDraftDepth;
  /** Recent tutor conversation about this source, to steer what gets drafted. */
  focus?: string;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();
  const response = await fetch("/api/ai/source-drafts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(friendlyError(response.status, data?.error));
  }

  return {
    drafts: Array.isArray(data?.drafts) ? (data.drafts as GeneratedContentDraft[]) : [],
    removedDraftCount:
      typeof data?.removedDraftCount === "number" ? data.removedDraftCount : 0,
    requestedCount:
      typeof data?.requestedCount === "number" ? data.requestedCount : undefined,
  };
}
