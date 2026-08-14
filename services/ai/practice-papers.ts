import type {
  PracticePaperGenerationRequest,
} from "@/lib/ai/practice-paper-generation";
import {
  mapPracticePaperJobData,
  mapPracticePaperData,
  type PracticePaper,
  type PracticePaperJob,
} from "@/lib/practice/practice-papers";
import { auth } from "@/services/firebase/client";

function friendlyError(status: number, message?: string) {
  if (status === 401) return "Sign in again to create a practice paper.";
  if (status === 413) return message || "That is too much material for one paper.";
  if (status === 429) return message || "Jami has reached the practice-paper limit for now.";
  if (status === 503) return "AI features are not configured in this deployment yet.";
  return message || "Jami could not create that paper just now.";
}

async function authenticatedPaperJobRequest(
  path: string,
  init?: RequestInit
) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(
      friendlyError(
        response.status,
        typeof data?.error === "string" ? data.error : undefined
      )
    );
  }
  if (!data) throw new Error("Jami returned an incomplete paper job.");
  return data;
}

export async function createPracticePaperJob(
  input: PracticePaperGenerationRequest,
  idempotencyKey: string,
  temporarySourceIds: string[] = []
): Promise<PracticePaperJob> {
  const data = await authenticatedPaperJobRequest("/api/practice/paper-jobs", {
    method: "POST",
    headers: { "x-idempotency-key": idempotencyKey },
    body: JSON.stringify({ ...input, temporarySourceIds }),
  });
  return mapPracticePaperJobData(
    typeof data.id === "string" ? data.id : idempotencyKey,
    data
  );
}

export async function getPracticePaperJob(jobId: string) {
  const data = await authenticatedPaperJobRequest(
    `/api/practice/paper-jobs/${encodeURIComponent(jobId)}`
  );
  return mapPracticePaperJobData(jobId, data);
}

export async function getRecentPracticePaperJobs(): Promise<PracticePaperJob[]> {
  const data = await authenticatedPaperJobRequest("/api/practice/paper-jobs");
  return Array.isArray(data.jobs)
    ? data.jobs.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const record = candidate as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : "";
        return id ? [mapPracticePaperJobData(id, record)] : [];
      })
    : [];
}

export async function cancelPracticePaperJob(jobId: string) {
  const data = await authenticatedPaperJobRequest(
    `/api/practice/paper-jobs/${encodeURIComponent(jobId)}`,
    { method: "DELETE" }
  );
  return mapPracticePaperJobData(jobId, data);
}

export async function clarifyPracticePaperJob(jobId: string, answer: string) {
  const data = await authenticatedPaperJobRequest(
    `/api/practice/paper-jobs/${encodeURIComponent(jobId)}/clarify`,
    { method: "POST", body: JSON.stringify({ answer }) }
  );
  return mapPracticePaperJobData(jobId, data);
}

export async function acknowledgePracticePaperJob(jobId: string) {
  const data = await authenticatedPaperJobRequest(
    `/api/practice/paper-jobs/${encodeURIComponent(jobId)}`,
    { method: "PATCH" }
  );
  return mapPracticePaperJobData(jobId, data);
}

async function runPracticePaperAction(
  action: "prepare" | "mark",
  notebookId: string
): Promise<PracticePaper> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const response = await fetch(`/api/ai/practice-papers/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ notebookId }),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(
      friendlyError(
        response.status,
        typeof data?.error === "string" ? data.error : undefined
      )
    );
  }
  if (!data) throw new Error("Jami returned an incomplete practice paper.");
  return mapPracticePaperData(notebookId, data);
}

export function prepareUploadedPracticePaper(notebookId: string) {
  return runPracticePaperAction("prepare", notebookId);
}

export function markPracticePaper(notebookId: string) {
  return runPracticePaperAction("mark", notebookId);
}

export async function remarkPracticePaperQuestion(input: {
  notebookId: string;
  questionId: string;
  reason: string;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const response = await fetch("/api/ai/practice-papers/remark-question", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(
      friendlyError(
        response.status,
        typeof data?.error === "string" ? data.error : undefined
      )
    );
  }
  if (!data) throw new Error("Jami returned an incomplete question recheck.");
  return mapPracticePaperData(input.notebookId, data);
}
