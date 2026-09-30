import { isValidEvidenceTime } from "@/lib/learning/evidence-time";
import { LEARNING_RECOMMENDATION_ORDER } from "@/lib/learning/recommendations/recommend-focus";
import type { LearningRecommendationReason } from "@/lib/learning/types";

/**
 * What became of one piece of the engine's advice.
 *
 * The profile records what a student knows. This records what Jami told them
 * to do about it and what happened next -- the half of the loop that was
 * missing, and without which the engine could suggest the same topic every day
 * forever and no one could tell whether any of it helped.
 *
 * Three things depend on it:
 *
 * - A recommendation acted on goes quiet until there is new evidence, instead
 *   of reappearing on Today the moment the page reloads.
 * - A recommendation dismissed repeatedly is itself a signal. The student is
 *   telling the engine something its evidence does not contain.
 * - `intervention` in the evaluation reads these against what the profile said
 *   before and after, which is the only way to ask whether acting on Jami's
 *   advice actually moves mastery.
 *
 * Deliberately tiny, like the flashcard event: ids, a reason, an outcome, a
 * time. No labels, no copy, nothing a student wrote. The label shown on Today
 * is rebuilt from the recommendation when it is next displayed.
 */

export const STUDY_ACTION_EVENT_SCHEMA_VERSION = 1;
export const STUDY_ACTION_EVENTS_COLLECTION = "studyActionEvents";

const MAX_ID_LENGTH = 200;

/**
 * `shown` is recorded once per action per study day, not per page view: Today
 * is reloaded many times a day and an impression count is not what any of the
 * three readers above want.
 *
 * `started` means the destination was opened. `completed` means work actually
 * landed -- a session finished, a question marked -- and is written by the
 * surface that did it, never by the link.
 *
 * `abandoned` means the student opened the work and left it unfinished, and it
 * is recorded by the surface at the moment they go. It is deliberately NOT
 * derived from the absence of a `completed`: a session still open, a page
 * closed mid-answer and a browser crash all look identical from the outside,
 * and none of them is a student deciding to stop. An intervention with a
 * `started` and no terminal event is simply still open.
 *
 * Nor is it the same as producing no evidence. A student can finish a session
 * having answered nothing, which is `completed` with no attributed answers --
 * a different fact about a different thing.
 */
export type StudyActionOutcome =
  | "shown"
  | "started"
  | "completed"
  | "dismissed"
  | "abandoned";

const OUTCOMES: readonly StudyActionOutcome[] = [
  "shown",
  "started",
  "completed",
  "dismissed",
  "abandoned",
];

export type StudyActionEvent = {
  id: string;
  /** The action's stable id: scope, reason and target. */
  actionId: string;
  reason: LearningRecommendationReason;
  /** `topic:<key>` or `error:<category>`, as `recommendationTargetKey` builds it. */
  targetKey: string;
  folderId?: string;
  deckId?: string;
  outcome: StudyActionOutcome;
  at: number;
  /** The student's own study day, so one day's advice can be counted once. */
  studyDayKey: string;
};

export type StudyActionEventWrite = Omit<StudyActionEvent, "id"> & {
  schemaVersion: typeof STUDY_ACTION_EVENT_SCHEMA_VERSION;
  createdAt: number;
};

const STUDY_DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readId(value: unknown, maxLength = MAX_ID_LENGTH) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id.length > 0 && id.length <= maxLength ? id : "";
}

export function isStudyActionOutcome(value: unknown): value is StudyActionOutcome {
  return OUTCOMES.some((outcome) => outcome === value);
}

function isReason(value: unknown): value is LearningRecommendationReason {
  return LEARNING_RECOMMENDATION_ORDER.some((reason) => reason === value);
}

/**
 * One event per action, outcome and study day.
 *
 * Making the id deterministic is what keeps `shown` from becoming an
 * impression counter and makes every write idempotent under a retry: the same
 * advice, taken the same way, on the same day, is one record however many
 * times it is sent.
 */
export function studyActionEventId(input: {
  actionId: string;
  outcome: StudyActionOutcome;
  studyDayKey: string;
}) {
  const actionId = readId(input.actionId);
  if (!actionId || !isStudyActionOutcome(input.outcome)) return null;
  if (!STUDY_DAY_KEY_PATTERN.test(input.studyDayKey)) return null;
  /*
   * A topic key can be long and carries "/", which a Firestore id may not.
   * Truncating a long id would let two different actions on one day collapse
   * into one record, so the action is folded to a fixed-width digest instead
   * and the readable parts are kept whole.
   */
  return `${input.studyDayKey}_${input.outcome}_${digest(actionId)}`;
}

/**
 * A short, stable, non-cryptographic digest of an action id.
 *
 * FNV-1a over the string, twice with different offsets, printed as hex. Two
 * 32-bit halves rather than one because a student accumulates thousands of
 * these and a single 32-bit space starts colliding in the low thousands.
 * Nothing security-sensitive rests on this: the worst a collision could do is
 * merge two of one student's own records.
 */
function digest(value: string) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x811c9dc5) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

export function buildStudyActionEventWrite(
  input: {
    actionId: string;
    reason: unknown;
    targetKey: string;
    folderId?: string;
    deckId?: string;
    outcome: StudyActionOutcome;
    at: number;
    studyDayKey: string;
  },
  createdAt: number
): StudyActionEventWrite | null {
  const actionId = readId(input.actionId);
  const targetKey = readId(input.targetKey);
  const folderId = readId(input.folderId);
  const deckId = readId(input.deckId);
  if (
    !actionId ||
    !targetKey ||
    !isReason(input.reason) ||
    !isStudyActionOutcome(input.outcome) ||
    !isValidEvidenceTime(input.at) ||
    !STUDY_DAY_KEY_PATTERN.test(input.studyDayKey)
  ) {
    return null;
  }
  return {
    schemaVersion: STUDY_ACTION_EVENT_SCHEMA_VERSION,
    actionId,
    reason: input.reason,
    targetKey,
    ...(folderId ? { folderId } : {}),
    ...(deckId ? { deckId } : {}),
    outcome: input.outcome,
    at: input.at,
    studyDayKey: input.studyDayKey,
    createdAt,
  };
}

/** A stored event, or null for anything not a well-formed version-1 event. */
export function decodeStudyActionEvent(
  id: string,
  data: Record<string, unknown>
): StudyActionEvent | null {
  const actionId = readId(data.actionId);
  const targetKey = readId(data.targetKey);
  const studyDayKey = typeof data.studyDayKey === "string" ? data.studyDayKey : "";
  if (
    !readId(id) ||
    data.schemaVersion !== STUDY_ACTION_EVENT_SCHEMA_VERSION ||
    !actionId ||
    !targetKey ||
    !isReason(data.reason) ||
    !isStudyActionOutcome(data.outcome) ||
    !isValidEvidenceTime(data.at) ||
    !STUDY_DAY_KEY_PATTERN.test(studyDayKey)
  ) {
    return null;
  }
  const folderId = readId(data.folderId);
  const deckId = readId(data.deckId);
  return {
    id,
    actionId,
    reason: data.reason,
    targetKey,
    ...(folderId ? { folderId } : {}),
    ...(deckId ? { deckId } : {}),
    outcome: data.outcome,
    at: data.at,
    studyDayKey,
  };
}

/**
 * Read back the parts of an action id.
 *
 * `buildStudyActions` composes it as `scope|reason|targetKey`, so a surface
 * handed only the id can still record an outcome against it without being
 * handed the whole recommendation as well. That matters for `completed`: the
 * study session is the only thing that knows a session was finished, and it
 * has no reason to carry the engine's ranking around for the length of it.
 *
 * Null for anything that is not one of ours. The reason is checked against the
 * engine's own list rather than trusted, because this reads a value that
 * travelled through a URL.
 */
export function parseStudyActionId(actionId: string): {
  actionId: string;
  reason: LearningRecommendationReason;
  targetKey: string;
  folderId?: string;
  deckId?: string;
} | null {
  const id = readId(actionId);
  if (!id) return null;
  const parts = id.split("|");
  if (parts.length !== 3) return null;
  const [scopeKey, reason, targetKey] = parts;
  if (!isReason(reason) || !readId(targetKey)) return null;
  const folderId = scopeKey.startsWith("folder:") ? scopeKey.slice("folder:".length) : "";
  const deckId = scopeKey.startsWith("deck:") ? scopeKey.slice("deck:".length) : "";
  return {
    actionId: id,
    reason,
    targetKey,
    ...(folderId ? { folderId } : {}),
    ...(deckId ? { deckId } : {}),
  };
}
