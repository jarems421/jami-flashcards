import { auth } from "@/services/firebase/client";
import type { ExamSession } from "@/lib/practice/exam-questions";
import type { SourceDraftDepth } from "@/lib/ai/source-draft-quality";
import type { PracticeSetAction } from "@/lib/practice/practice-sets";

function friendlyError(status: number, message?: string) {
  if (status === 401) return "Sign in again to use practice sets.";
  if (status === 429) return message || "Jami has reached the practice limit for now. Try again later.";
  if (status === 503) return message || "Practice sets are unavailable for a moment. Try again shortly.";
  return message || "Jami could not do that just now.";
}

async function request(path: string, init?: RequestInit) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(friendlyError(response.status, typeof data?.error === "string" ? data.error : undefined));
  }
  return data ?? {};
}

/** Practice sets waiting to be started, newest first. */
export async function listReadyPracticeSets() {
  const data = await request("/api/practice/practice-sets");
  return (Array.isArray(data.sets) ? data.sets : []) as ExamSession[];
}

/** A marked practice set written from one source, on what the student asked it to focus on. */
export async function createSourcePracticeSet(input: {
  sourceId: string;
  depth: SourceDraftDepth;
  focus?: string;
  /** Recent Tutor conversation about the source, to weight the questions towards it. */
  conversation?: string;
}) {
  const data = await request("/api/practice/practice-sets", {
    method: "POST",
    body: JSON.stringify({ origin: "source", ...input }),
  });
  return data.session as ExamSession;
}

/** A practice set for something Jami's recommendations picked out. */
export async function createRecommendedPracticeSet(input: {
  folderId: string;
  focus: string;
  topicIds?: string[];
  conceptIds?: string[];
}) {
  const data = await request("/api/practice/practice-sets", {
    method: "POST",
    body: JSON.stringify({ origin: "learning", ...input }),
  });
  return data.session as ExamSession;
}

export async function updatePracticeSet(sessionId: string, action: PracticeSetAction) {
  const data = await request(`/api/practice/practice-sets/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
  });
  return data.session as ExamSession;
}
