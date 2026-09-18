import { auth } from "@/services/firebase/client";
import { db } from "@/services/firebase/client";
import { doc, getDoc, setDoc } from "firebase/firestore";
import type { ExamCourseOption } from "@/lib/practice/exam-course-form";
import type { ExamCalculatorChoice, ExamDifficulty, ExamSession } from "@/lib/practice/exam-questions";
import type { ExamCoursePaper } from "@/lib/practice/exam-papers";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import { EXAM_SHEET_MAX_PAGES } from "@/lib/practice/exam-question-sheet";
import { examWorkingHasInk } from "@/lib/practice/exam-working";
import { MAX_NOTEBOOK_INK_SVG_LENGTH } from "@/lib/workspace/notebooks";

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

export async function getExamAvailability(
  folderId: string,
  topicIds: string[] = [],
  calculator?: ExamCalculatorChoice,
  paperIds: string[] = [],
  conceptIds: string[] = []
) {
  const params = new URLSearchParams({ folderId });
  topicIds.forEach((id) => params.append("topicId", id));
  conceptIds.forEach((id) => params.append("conceptId", id));
  paperIds.forEach((id) => params.append("paperId", id));
  if (calculator && calculator !== "any") params.set("calculator", calculator);
  return request(`/api/practice/exam-questions/availability?${params}`) as Promise<{
    folder: { id: string; name: string; subject: string; course: { board: string; specificationTitle: string } };
    counts: Record<ExamDifficulty, number>;
    /** A count that stopped at a session's worth rather than at the corpus. */
    hasMore: Record<ExamDifficulty, boolean>;
    /** Each topic with the finer concepts beneath it, where the course has a checked list. */
    topics: Array<{
      id: string;
      label: string;
      group?: string;
      concepts?: Array<{ id: string; label: string }>;
    }>;
    papers: ExamCoursePaper[];
    /** Whether any of this course's papers carries a calculator rule. */
    calculatorPolicyKnown: boolean;
  }>;
}

export async function getExamCourseOptions(input: { board: string; subject?: string }) {
  const params = new URLSearchParams({ board: input.board });
  if (input.subject) params.set("subject", input.subject);
  const data = await request(`/api/practice/exam-course-options?${params}`);
  return data.courses as ExamCourseOption[];
}

export async function createPastPaperPracticeSession(input: {
  folderId: string;
  mix: Record<ExamDifficulty, number>;
  topicIds?: string[];
  conceptIds?: string[];
  originNotebookId?: string;
  allowGenerated?: boolean;
  useAvailableOnly?: boolean;
  calculator?: ExamCalculatorChoice;
  paperIds?: string[];
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

export async function listPastPaperPracticeSessions(folderId?: string, before?: number) {
  const params = new URLSearchParams();
  if (folderId) params.set("folderId", folderId);
  if (before) params.set("before", String(before));
  const suffix = params.toString() ? `?${params}` : "";
  const data = await request(`/api/practice/exam-sessions${suffix}`);
  return {
    sessions: (data.sessions ?? []) as ExamSession[],
    nextCursor: (data.nextCursor ?? null) as number | null,
  };
}

/**
 * `keepalive` is for the save that happens as the page is going away.
 *
 * An ordinary fetch started during `pagehide` is cancelled with the document,
 * so the last thing a student typed before closing the tab was the thing most
 * likely to be lost. A keepalive request outlives the page. It is only used on
 * the way out -- the limit is 64KB of body, which an answer stays well under,
 * and there is no response to read by then anyway.
 */
export async function saveExamAnswerDraft(
  sessionId: string,
  attemptId: string,
  answerText: string,
  options?: { keepalive?: boolean }
) {
  return request(`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/drafts`, {
    method: "PATCH",
    body: JSON.stringify({ attemptId, answerText }),
    ...(options?.keepalive ? { keepalive: true } : {}),
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

/**
 * The pages of a sheet of working, first page first.
 *
 * The first page is stored as `inkSvg`, where a single sheet always lived, and
 * any further pages under `pages` -- so every sheet saved before pages existed
 * opens unchanged as a one-page sheet.
 */
export async function loadExamScratchpad(userId: string, attemptId: string): Promise<string[]> {
  const snapshot = await getDoc(doc(db, "users", userId, "examScratchpads", attemptId));
  if (!snapshot.exists()) return [""];
  const data = snapshot.data();
  const first = typeof data.inkSvg === "string" ? data.inkSvg : "";
  const extra = Array.isArray(data.pages)
    ? data.pages.filter((page): page is string => typeof page === "string")
    : [];
  return [first, ...extra].slice(0, EXAM_SHEET_MAX_PAGES);
}

/**
 * The rules cap the sheet at 900KB and the app keeps a margin under it, across
 * every page together, since they share one document.
 *
 * `MAX_NOTEBOOK_INK_SVG_LENGTH` is the same ceiling the notebook works to.
 */
export const EXAM_SCRATCHPAD_MAX_SVG_LENGTH = MAX_NOTEBOOK_INK_SVG_LENGTH;

export class ExamScratchpadTooLargeError extends Error {
  constructor(readonly length: number) {
    super("This working sheet is too detailed to save.");
  }
}

/**
 * Saving a sheet of working, whole or not at all.
 *
 * This used to `slice(0, 850_000)`, which is the worst thing to do to a
 * structured document: an SVG cut mid-element is not a smaller drawing, it is
 * a broken file, and it would have replaced a good one. Over the cap the write
 * is refused and the caller is told, so what is already stored survives and
 * the student finds out while they can still do something about it.
 */
export async function saveExamScratchpad(
  userId: string,
  attemptId: string,
  pages: readonly string[]
) {
  const kept = [...(pages.length > 0 ? pages : [""])].slice(0, EXAM_SHEET_MAX_PAGES);
  const length = kept.reduce((total, page) => total + page.length, 0);
  if (length > EXAM_SCRATCHPAD_MAX_SVG_LENGTH) {
    throw new ExamScratchpadTooLargeError(length);
  }
  /*
   * Trailing blank pages are not written.
   *
   * A sheet is now as long as the question's own paper, so an answer that fits
   * on the first printed page still carries every page after it -- and storing
   * a run of empty strings costs a write and a read for nothing. The pages a
   * student actually used keep their positions, which is all the sheet needs
   * to line them back up against the paper when it reopens.
   */
  while (kept.length > 1 && !examWorkingHasInk(kept[kept.length - 1])) kept.pop();
  // A one-page sheet writes exactly what it always did, so it is accepted by
  // rules that predate pages.
  await setDoc(doc(db, "users", userId, "examScratchpads", attemptId), {
    inkSvg: kept[0],
    ...(kept.length > 1 ? { pages: kept.slice(1) } : {}),
    updatedAt: Date.now(),
  });
}
