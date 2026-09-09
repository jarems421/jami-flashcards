import { auth } from "@/services/firebase/client";
import { db } from "@/services/firebase/client";
import { doc, getDoc, setDoc } from "firebase/firestore";
import type { ExamDifficulty, ExamSession } from "@/lib/practice/exam-questions";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";

/** What the server sends back when a course cannot fill the requested mix. */
export type ExamCoverageShortage = {
  missingByDifficulty: Partial<Record<ExamDifficulty, number>>;
  availableMix: Record<ExamDifficulty, number>;
};

export function readCoverageShortage(error: unknown): ExamCoverageShortage | null {
  const detail = (error as { code?: unknown; detail?: Record<string, unknown> } | null)?.detail;
  if ((error as { code?: unknown } | null)?.code !== "coverage_gap" || !detail) return null;
  const missing = detail.missingByDifficulty;
  const available = detail.availableMix;
  if (!missing || typeof missing !== "object" || !available || typeof available !== "object") return null;
  return {
    missingByDifficulty: missing as Partial<Record<ExamDifficulty, number>>,
    availableMix: available as Record<ExamDifficulty, number>,
  };
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
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = new Error(typeof data?.error === "string" ? data.error : "Past Paper Practice is unavailable.");
    Object.assign(error, { code: data?.code, detail: data });
    throw error;
  }
  return data ?? {};
}

export async function getExamAvailability(folderId: string, topicIds: string[] = []) {
  const params = new URLSearchParams({ folderId });
  topicIds.forEach((id) => params.append("topicId", id));
  return request(`/api/practice/exam-questions/availability?${params}`) as Promise<{
    folder: { id: string; name: string; subject: string; course: { board: string; specificationTitle: string } };
    counts: Record<ExamDifficulty, number>;
    topics: Array<{ id: string; label: string }>;
  }>;
}

export async function getExamCourseOptions(input: { board: string; qualification: string; subject?: string }) {
  const params = new URLSearchParams({ board: input.board, qualification: input.qualification });
  if (input.subject) params.set("subject", input.subject);
  const data = await request(`/api/practice/exam-course-options?${params}`);
  return data.courses as Array<{ specificationId: string; specificationTitle: string; tiers: string[]; componentIds: string[] }>;
}

export async function createPastPaperPracticeSession(input: {
  folderId: string;
  mix: Record<ExamDifficulty, number>;
  topicIds?: string[];
  originNotebookId?: string;
  allowGenerated?: boolean;
  useAvailableOnly?: boolean;
}) {
  const data = await request("/api/practice/exam-sessions", { method: "POST", body: JSON.stringify(input) });
  return data.session as ExamSession;
}

export async function loadPastPaperPracticeSession(sessionId: string) {
  return request(`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}`) as Promise<{
    session: ExamSession;
    attempts: PublicExamAttempt[];
  }>;
}

export async function listPastPaperPracticeSessions(folderId?: string) {
  const suffix = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
  const data = await request(`/api/practice/exam-sessions${suffix}`);
  return data.sessions as ExamSession[];
}

export async function saveExamAnswerDraft(sessionId: string, attemptId: string, answerText: string) {
  return request(`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/drafts`, {
    method: "PATCH",
    body: JSON.stringify({ attemptId, answerText }),
  });
}

export async function submitExamAnswer(input: {
  sessionId: string;
  questionId: string;
  attemptNumber: 1 | 2;
  answerText: string;
  workingSnapshot?: { mimeType: "image/png"; dataBase64: string; width: number; height: number };
}) {
  return request(`/api/practice/exam-sessions/${encodeURIComponent(input.sessionId)}/answers`, {
    method: "POST",
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  }) as Promise<{ attempt: PublicExamAttempt; officialMarkScheme?: string }>;
}

export async function reviewExamAnswer(sessionId: string, questionId: string) {
  return request(`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/review`, {
    method: "POST",
    headers: { "x-idempotency-key": `${sessionId}:${questionId}:review` },
    body: JSON.stringify({ questionId }),
  }) as Promise<{ attempt: PublicExamAttempt }>;
}

export async function finishPastPaperPracticeSession(sessionId: string) {
  const data = await request(`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/finish`, { method: "POST" });
  return data.session as ExamSession;
}

export async function deletePastPaperPracticeAnswers(sessionId: string) {
  return request(`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/answers/delete`, { method: "DELETE" });
}

export async function saveExamAttemptToNotebook(input: { sessionId: string; attemptId: string; notebookId: string }) {
  return request(`/api/practice/exam-sessions/${encodeURIComponent(input.sessionId)}/notebook`, {
    method: "POST",
    headers: { "x-idempotency-key": `${input.attemptId}:${input.notebookId}` },
    body: JSON.stringify(input),
  }) as Promise<{ pageId: string; notebookId: string; alreadySaved: boolean }>;
}

export async function loadExamScratchpad(userId: string, attemptId: string) {
  const snapshot = await getDoc(doc(db, "users", userId, "examScratchpads", attemptId));
  return snapshot.exists() && typeof snapshot.data().inkSvg === "string" ? snapshot.data().inkSvg as string : "";
}

export async function saveExamScratchpad(userId: string, attemptId: string, inkSvg: string) {
  await setDoc(doc(db, "users", userId, "examScratchpads", attemptId), { inkSvg: inkSvg.slice(0, 850_000), updatedAt: Date.now() });
}
