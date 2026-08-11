import type {
  PracticePaperGenerationRequest,
} from "@/lib/ai/practice-paper-generation";
import type { PracticePaperGenerationResponse } from "@/lib/practice/practice-papers";
import {
  mapPracticePaperData,
  type PracticePaper,
} from "@/lib/practice/practice-papers";
import { auth } from "@/services/firebase/client";

function friendlyError(status: number, message?: string) {
  if (status === 401) return "Sign in again to create a practice paper.";
  if (status === 413) return message || "That is too much material for one paper.";
  if (status === 429) return message || "Jami has reached the practice-paper limit for now.";
  if (status === 503) return "AI features are not configured in this deployment yet.";
  return message || "Jami could not create that paper just now.";
}

export async function generatePracticePaper(
  input: PracticePaperGenerationRequest
): Promise<PracticePaperGenerationResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const response = await fetch("/api/ai/practice-papers/generate", {
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
  if (data?.status !== "ready" && data?.status !== "needs_clarification") {
    throw new Error("Jami returned an incomplete practice paper. Try again.");
  }
  return data as PracticePaperGenerationResponse;
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
