import type { ExamDifficulty } from "@/lib/practice/exam-questions";
import type { SourceDraftDepth } from "@/lib/ai/source-draft-quality";

/**
 * A practice set: a short marked session Jami built for a reason, waiting for
 * the student to start it.
 *
 * It is an exam session like any other -- same workspace, same marking, same
 * history -- with a note of who suggested it and why. Tutor makes one when a
 * student asks for practice questions mid-conversation; a source's Create panel
 * makes one instead of dropping questions onto a notebook page; and the
 * Learning Engine's recommendations can be turned into one with a press.
 */
export type PracticeSetOrigin = "tutor" | "source" | "learning";

export type PracticeSetStatus = "ready" | "dismissed";

/** Keeping a set from the chat, or turning it down. */
export type PracticeSetAction = "accept" | "dismiss";

export type PracticeSetInfo = {
  origin: PracticeSetOrigin;
  status: PracticeSetStatus;
  /** What it is on, in a few words, for the card that offers it. */
  title: string;
  /** The fuller brief it was written to, as the student or Tutor put it. */
  focus: string;
  sourceIds?: string[];
  threadId?: string;
  messageId?: string;
  /** The student kept it from the chat, rather than it only having been made. */
  acceptedAt?: number;
  dismissedAt?: number;
};

export const PRACTICE_SET_DEFAULT_COUNT = 5;
export const PRACTICE_SET_MAX_COUNT = 10;
export const PRACTICE_SET_MAX_TITLE_LENGTH = 90;
export const PRACTICE_SET_MAX_FOCUS_LENGTH = 1_500;

export function isPracticeSetOrigin(value: unknown): value is PracticeSetOrigin {
  return value === "tutor" || value === "source" || value === "learning";
}

/**
 * A short set that still climbs: mostly early questions to get going, and at
 * least one harder one once there are three or more.
 */
export function practiceSetMix(count: number): Record<ExamDifficulty, number> {
  const total = Math.max(1, Math.min(PRACTICE_SET_MAX_COUNT, Math.round(count)));
  if (total === 1) return { easy: 0, medium: 1, hard: 0 };
  if (total === 2) return { easy: 1, medium: 1, hard: 0 };
  const hard = Math.max(1, Math.round(total * 0.2));
  const easy = Math.max(1, Math.round(total * 0.4));
  return { easy, medium: total - easy - hard, hard };
}

/** A source's "how thorough" choice, as a number of questions. */
export function practiceSetCountForDepth(depth: SourceDraftDepth) {
  return depth === "low" ? 3 : depth === "high" ? 8 : PRACTICE_SET_DEFAULT_COUNT;
}

/** A label from a focus: first clause, sentence case, bounded. */
export function practiceSetTitle(focus: string) {
  const clean = focus.replace(/\s+/g, " ").trim();
  if (!clean) return "Practice set";
  const firstClause = clean.split(/(?<=[.?!])\s|\n/)[0] ?? clean;
  const bounded =
    firstClause.length > PRACTICE_SET_MAX_TITLE_LENGTH
      ? `${firstClause.slice(0, PRACTICE_SET_MAX_TITLE_LENGTH - 1).trimEnd()}…`
      : firstClause;
  return bounded.charAt(0).toUpperCase() + bounded.slice(1);
}

function normalizeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function normalizeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

export function normalizePracticeSetInfo(value: unknown): PracticeSetInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!isPracticeSetOrigin(record.origin)) return undefined;
  const title = normalizeText(record.title, PRACTICE_SET_MAX_TITLE_LENGTH) || "Practice set";
  const sourceIds = Array.isArray(record.sourceIds)
    ? record.sourceIds.filter((item): item is string => typeof item === "string" && Boolean(item)).slice(0, 15)
    : [];
  const threadId = normalizeText(record.threadId, 160);
  const messageId = normalizeText(record.messageId, 160);
  const acceptedAt = normalizeTimestamp(record.acceptedAt);
  const dismissedAt = normalizeTimestamp(record.dismissedAt);
  return {
    origin: record.origin,
    status: record.status === "dismissed" ? "dismissed" : "ready",
    title,
    focus: normalizeText(record.focus, PRACTICE_SET_MAX_FOCUS_LENGTH),
    ...(sourceIds.length > 0 ? { sourceIds } : {}),
    ...(threadId ? { threadId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(acceptedAt ? { acceptedAt } : {}),
    ...(dismissedAt ? { dismissedAt } : {}),
  };
}

type PracticeSetSessionShape = {
  status: "active" | "completed" | "abandoned";
  answeredCount: number;
  practiceSet?: PracticeSetInfo;
};

/** Waiting to be started: suggested, not turned down, nothing answered yet. */
export function isReadyPracticeSet(session: PracticeSetSessionShape) {
  return (
    session.practiceSet?.status === "ready" &&
    session.status === "active" &&
    session.answeredCount === 0
  );
}

/**
 * Whether a session belongs in history.
 *
 * A practice set nobody has started is an offer, not practice done, so it sits
 * in Ready to practise until an answer is marked -- and one the student turned
 * down never appears at all.
 */
export function belongsInPracticeHistory(session: PracticeSetSessionShape) {
  if (!session.practiceSet) return true;
  return session.answeredCount > 0 || session.status === "completed";
}

export function describePracticeSetOrigin(origin: PracticeSetOrigin) {
  if (origin === "tutor") return "From a Tutor chat";
  if (origin === "source") return "From a source";
  return "Recommended by Jami";
}
