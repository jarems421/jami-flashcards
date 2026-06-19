import { auth } from "@/services/firebase/client";
import type { GeneratedContentDraft } from "@/services/study/generated-content";

function friendlyError(status: number, message?: string) {
  if (status === 429) return "Source AI budget is taking a short break. Try again later.";
  if (status === 503) return "Source AI is not configured in this deployment yet.";
  return message || "Source AI could not answer just now.";
}

async function authedPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(friendlyError(res.status, data?.error));
  }

  return data as T;
}

export async function askSourceTutor(input: { sourceIds: string[]; message: string }) {
  const data = await authedPost<{
    reply?: string;
    threadId?: string;
    sourcesUsed?: Array<{ id: string; title: string }>;
    sourceFailures?: Array<{ id: string; title: string; reason: string }>;
  }>("/api/ai/source-tutor", input);
  const reply = typeof data.reply === "string" ? data.reply.trim() : "";
  if (!reply) throw new Error("Source Tutor could not answer just now.");
  return {
    reply,
    threadId: typeof data.threadId === "string" ? data.threadId : undefined,
    sourcesUsed: Array.isArray(data.sourcesUsed) ? data.sourcesUsed : [],
    sourceFailures: Array.isArray(data.sourceFailures) ? data.sourceFailures : [],
  };
}

export async function generateSourceDrafts(input: {
  sourceId: string;
  kind: "flashcard" | "practice-question";
  count?: number;
}) {
  const data = await authedPost<{
    drafts?: GeneratedContentDraft[];
    removedDraftCount?: number;
    requestedCount?: number;
  }>("/api/ai/source-drafts", input);

  return {
    drafts: Array.isArray(data.drafts) ? data.drafts : [],
    removedDraftCount: typeof data.removedDraftCount === "number" ? data.removedDraftCount : 0,
    requestedCount: typeof data.requestedCount === "number" ? data.requestedCount : undefined,
  };
}
