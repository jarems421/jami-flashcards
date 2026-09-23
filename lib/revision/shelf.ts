import type { RevisionNextStep, RevisionNextStepKind } from "@/lib/revision/types";

/**
 * The Tutor shelf: what a student saved from a Revision Session to do later,
 * and what Jami made for them from one.
 *
 * A to-do list and nothing more. Each item names a kind of work, a concept and
 * a folder, and where to go -- never a question, an answer or anything the
 * student wrote. The practice sets and cards themselves live where all practice
 * papers and cards live; this only remembers that they were made, and why.
 */

export const REVISION_SHELF_COLLECTION = "revisionShelf";
export const REVISION_SHELF_SCHEMA_VERSION = 1;
/** Enough to be useful; a longer to-do list stops being one. */
export const REVISION_SHELF_LIMIT = 30;

export type RevisionShelfStatus = "later" | "made";

export type RevisionShelfItem = {
  id: string;
  kind: RevisionNextStepKind;
  status: RevisionShelfStatus;
  topicKey: string;
  conceptLabel: string;
  folderId: string;
  conceptId?: string;
  /** Where Start or Open goes. Always one of this app's own pages. */
  href?: string;
  createdAt: number;
};

const KINDS: readonly RevisionNextStepKind[] = [
  "flashcards",
  "review-cards",
  "practice",
  "exam-questions",
  "session",
];
const LIMITS = { topicKey: 400, conceptLabel: 200, folderId: 200, conceptId: 200, href: 600 };

function readString(value: unknown, max: number) {
  return typeof value === "string" && value.trim() && value.trim().length <= max
    ? value.trim()
    : undefined;
}

function isAppHref(value: string | undefined): value is string {
  return Boolean(value && value.startsWith("/dashboard/"));
}

/** The document for a saved step or a made thing, or null if it cannot be stored. */
export function buildRevisionShelfWrite(
  input: Pick<RevisionNextStep, "kind" | "topicKey" | "conceptLabel" | "folderId" | "conceptId" | "href"> & {
    status: RevisionShelfStatus;
  },
  createdAt: number
): Record<string, unknown> | null {
  const topicKey = readString(input.topicKey, LIMITS.topicKey);
  const conceptLabel = readString(input.conceptLabel, LIMITS.conceptLabel);
  const folderId = readString(input.folderId, LIMITS.folderId);
  const conceptId = readString(input.conceptId, LIMITS.conceptId);
  const href = readString(input.href, LIMITS.href);
  if (!KINDS.includes(input.kind) || !topicKey || !conceptLabel || !folderId) return null;
  if (input.status !== "later" && input.status !== "made") return null;
  // A made thing is only worth listing if it can be opened.
  if (input.status === "made" && !isAppHref(href)) return null;
  return {
    schemaVersion: REVISION_SHELF_SCHEMA_VERSION,
    kind: input.kind,
    status: input.status,
    topicKey,
    conceptLabel,
    folderId,
    ...(conceptId ? { conceptId } : {}),
    ...(isAppHref(href) ? { href } : {}),
    createdAt,
  };
}

export function decodeRevisionShelfItem(id: string, value: unknown): RevisionShelfItem | null {
  if (!id || !value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== REVISION_SHELF_SCHEMA_VERSION) return null;
  const kind = KINDS.find((candidate) => candidate === data.kind);
  const status = data.status === "later" || data.status === "made" ? data.status : undefined;
  const topicKey = readString(data.topicKey, LIMITS.topicKey);
  const conceptLabel = readString(data.conceptLabel, LIMITS.conceptLabel);
  const folderId = readString(data.folderId, LIMITS.folderId);
  const conceptId = readString(data.conceptId, LIMITS.conceptId);
  const href = readString(data.href, LIMITS.href);
  if (!kind || !status || !topicKey || !conceptLabel || !folderId) return null;
  if (typeof data.createdAt !== "number" || !Number.isFinite(data.createdAt)) return null;
  return {
    id,
    kind,
    status,
    topicKey,
    conceptLabel,
    folderId,
    ...(conceptId ? { conceptId } : {}),
    ...(isAppHref(href) ? { href } : {}),
    createdAt: data.createdAt,
  };
}

/** How each kind of shelf item is named, as a short title. */
export const REVISION_SHELF_TITLE: Record<RevisionNextStepKind, (label: string) => string> = {
  flashcards: (label) => `Flashcards on ${label}`,
  "review-cards": (label) => `Review your cards on ${label}`,
  practice: (label) => `Practice questions on ${label}`,
  "exam-questions": (label) => `Exam questions on ${label}`,
  session: (label) => `Revision session: ${label}`,
};
