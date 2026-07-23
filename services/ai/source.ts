import { auth } from "@/services/firebase/client";
import type {
  SourceTutorFailure,
  SourceTutorHistoryMessage,
  SourceTutorOutcome,
  SourceTutorSourceReference,
} from "@/lib/ai/source-tutor";
import type { GeneratedContentDraft } from "@/services/study/generated-content";

function friendlyError(status: number, message?: string) {
  if (status === 429) return "Source Tutor has reached today's limit. Try again later.";
  if (status === 503) return "Source Tutor is not configured in this deployment yet.";
  if (status >= 500) return message || "Source Tutor could not answer just now.";
  return message || "Source Tutor could not answer just now.";
}

async function authedRequest<T>(
  url: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> }
): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch(url, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(friendlyError(res.status, data?.error));
  }

  return data as T;
}

async function authedPost<T>(url: string, body: Record<string, unknown>) {
  return authedRequest<T>(url, { method: "POST", body });
}

function sourceTutorHistoryUrl(sourceIds: string[]) {
  const search = new URLSearchParams();
  sourceIds.forEach((sourceId) => search.append("sourceId", sourceId));
  return `/api/ai/source-tutor?${search.toString()}`;
}

function isSourceTutorOutcome(value: unknown): value is SourceTutorOutcome {
  return value === "grounded" || value === "partial" || value === "insufficient";
}

export type SourceTutorResponse = {
  status: SourceTutorOutcome;
  reply: string;
  threadId?: string;
  sourcesUsed: SourceTutorSourceReference[];
  sourceFailures: SourceTutorFailure[];
};

export async function askSourceTutor(input: { sourceIds: string[]; message: string }) {
  const data = await authedPost<{
    status?: unknown;
    reply?: string;
    threadId?: string;
    sourcesUsed?: SourceTutorSourceReference[];
    sourceFailures?: SourceTutorFailure[];
  }>("/api/ai/source-tutor", input);
  const reply = typeof data.reply === "string" ? data.reply.trim() : "";
  if (!reply || !isSourceTutorOutcome(data.status)) {
    throw new Error("Source Tutor returned an incomplete answer. Try again.");
  }
  return {
    status: data.status,
    reply,
    threadId: typeof data.threadId === "string" ? data.threadId : undefined,
    sourcesUsed: Array.isArray(data.sourcesUsed) ? data.sourcesUsed : [],
    sourceFailures: Array.isArray(data.sourceFailures) ? data.sourceFailures : [],
  } satisfies SourceTutorResponse;
}

export async function getSourceTutorHistory(sourceIds: string[]) {
  const data = await authedRequest<{
    threadId?: string;
    history?: SourceTutorHistoryMessage[];
  }>(sourceTutorHistoryUrl(sourceIds), { method: "GET" });

  return {
    threadId: typeof data.threadId === "string" ? data.threadId : undefined,
    history: Array.isArray(data.history) ? data.history : [],
  };
}

export async function clearSourceTutorHistory(sourceIds: string[]) {
  await authedRequest<{ deleted?: boolean }>("/api/ai/source-tutor", {
    method: "DELETE",
    body: { sourceIds },
  });
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
