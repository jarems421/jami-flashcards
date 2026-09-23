import { LEARNING_ERROR_CATEGORIES, type LearningErrorCategory, type LearningTopicSource } from "@/lib/learning/types";
import { readRevisionLesson, readRevisionRetry } from "@/lib/revision/lesson";
import {
  REVISION_MISTAKES,
  REVISION_SESSION_SCHEMA_VERSION,
  type RevisionLesson,
  type RevisionNextStep,
  type RevisionNextStepKind,
  type RevisionSessionRecord,
  type RevisionSessionStatus,
  type RevisionStepKind,
  type RevisionStepRecord,
  type RevisionVerdict,
} from "@/lib/revision/types";

/**
 * A Revision Session as stored, and read back without trusting it.
 *
 * Only the server writes these, so a malformed record means a bug rather than
 * an attack -- but the lesson is model output and the whole record ends up on
 * a student's screen, so it is read as carefully as anything else is.
 */

const STEP_KINDS: readonly RevisionStepKind[] = [
  "orient",
  "explain",
  "guided",
  "retry",
  "independent",
  "apply",
  "retrieve",
];
const STATUSES: readonly RevisionSessionStatus[] = [
  "preparing",
  "active",
  "completed",
  "abandoned",
  "failed",
];
const SOURCES: readonly LearningTopicSource[] = ["student-topic", "deck", "specification"];
const MAX_STEPS = 12;
const MAX_WHY_LINES = 4;
const MAX_TEXT = 600;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function readString(value: unknown, max = MAX_TEXT) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function readStep(value: unknown): RevisionStepRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = STEP_KINDS.find((candidate) => candidate === record.kind);
  if (!kind) return null;
  const verdict = (["correct", "partial", "incorrect"] as const).find(
    (candidate) => candidate === record.verdict
  ) as RevisionVerdict | undefined;
  const errorCategory = LEARNING_ERROR_CATEGORIES.find(
    (candidate) => candidate === record.errorCategory
  ) as LearningErrorCategory | undefined;
  const mistake = REVISION_MISTAKES.find((candidate) => candidate === record.mistake);
  return {
    kind,
    attempts: isNumber(record.attempts) ? Math.max(0, Math.floor(record.attempts)) : 0,
    hintUsed: record.hintUsed === true,
    skipped: record.skipped === true,
    selfGraded: record.selfGraded === true,
    ...(verdict ? { verdict } : {}),
    ...(isNumber(record.score) ? { score: Math.min(1, Math.max(0, record.score)) } : {}),
    ...(errorCategory ? { errorCategory } : {}),
    ...(mistake ? { mistake } : {}),
    ...(isNumber(record.resolvedAt) ? { resolvedAt: record.resolvedAt } : {}),
  };
}

const NEXT_STEP_KINDS: readonly RevisionNextStepKind[] = [
  "flashcards",
  "review-cards",
  "practice",
  "exam-questions",
  "session",
];
const MAX_NEXT_STEPS = 3;

function readNextSteps(value: unknown): RevisionNextStep[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_NEXT_STEPS).flatMap((entry): RevisionNextStep[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const kind = NEXT_STEP_KINDS.find((candidate) => candidate === record.kind);
    const reason = readString(record.reason, 300);
    const topicKey = readString(record.topicKey, 400);
    const conceptLabel = readString(record.conceptLabel, 200);
    const folderId = readString(record.folderId, 200);
    if (!kind || !reason || !topicKey || !conceptLabel || !folderId) return [];
    const conceptId = readString(record.conceptId, 200);
    const href = readString(record.href, 600);
    return [
      {
        kind,
        reason,
        topicKey,
        conceptLabel,
        folderId,
        ...(conceptId ? { conceptId } : {}),
        // Only this app's own pages: a stored link is followed without asking.
        ...(href && href.startsWith("/dashboard/") ? { href } : {}),
      },
    ];
  });
}

function readLesson(value: unknown): RevisionLesson | undefined {
  const lesson = readRevisionLesson(value);
  if (!lesson) return undefined;
  const retry =
    value && typeof value === "object"
      ? readRevisionRetry((value as Record<string, unknown>).retry)
      : null;
  return retry ? { ...lesson, retry } : lesson;
}

export function decodeRevisionSession(id: string, value: unknown): RevisionSessionRecord | null {
  if (!id || !value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== REVISION_SESSION_SCHEMA_VERSION || data.policy !== "teach") return null;
  const status = STATUSES.find((candidate) => candidate === data.status);
  const target = data.target && typeof data.target === "object"
    ? (data.target as Record<string, unknown>)
    : null;
  const topicKey = readString(target?.topicKey, 400);
  const conceptLabel = readString(target?.conceptLabel, 200);
  const source = SOURCES.find((candidate) => candidate === target?.source);
  const actionId = readString(data.actionId, 400);
  if (!status || !topicKey || !conceptLabel || !source) return null;
  if (!Array.isArray(data.steps) || !isNumber(data.createdAt) || !isNumber(data.updatedAt)) {
    return null;
  }
  const steps = data.steps
    .slice(0, MAX_STEPS)
    .map(readStep)
    .filter((step): step is RevisionStepRecord => step !== null);
  if (steps.length === 0) return null;
  const folderId = readString(target?.folderId, 200);
  const deckId = readString(target?.deckId, 200);
  const lesson = readLesson(data.lesson);
  const why = Array.isArray(data.why)
    ? data.why
        .map((line) => readString(line))
        .filter((line): line is string => Boolean(line))
        .slice(0, MAX_WHY_LINES)
    : [];
  const position = isNumber(data.position)
    ? Math.min(steps.length, Math.max(0, Math.floor(data.position)))
    : 0;

  return {
    id,
    schemaVersion: REVISION_SESSION_SCHEMA_VERSION,
    policy: "teach",
    status,
    target: {
      topicKey,
      source,
      conceptLabel,
      ...(folderId ? { folderId } : {}),
      ...(deckId ? { deckId } : {}),
    },
    ...(actionId ? { actionId } : {}),
    why,
    ...(lesson ? { lesson } : {}),
    steps,
    position,
    ...(isNumber(data.workingSince) ? { workingSince: data.workingSince } : {}),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    ...(isNumber(data.completedAt) ? { completedAt: data.completedAt } : {}),
    ...(isNumber(data.endedAt) ? { endedAt: data.endedAt } : {}),
    ...(readNextSteps(data.nextSteps).length > 0 ? { nextSteps: readNextSteps(data.nextSteps) } : {}),
  };
}

/** Undefined removed at every depth: Firestore refuses it, and absence is the meaning. */
function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefined(entry)])
    );
  }
  return value;
}

/** The document to store. The id is the document's own, so it is left out. */
export function serializeRevisionSession(record: RevisionSessionRecord): Record<string, unknown> {
  const { id, ...stored } = record;
  void id;
  return withoutUndefined(stored) as Record<string, unknown>;
}
