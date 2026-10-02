import { isValidEvidenceTime } from "@/lib/learning/evidence-time";
import type { StoredMarkedAnswer } from "@/lib/learning/profile/marked-answer";

/**
 * A quick check: one short question Tutor asks in chat, marked on the
 * student's next message.
 *
 * Tutor used to ask "can you tell me why...?" and then judge the reply in
 * prose, so the one moment a chat tests what a student can do alone left no
 * evidence. This is that moment kept, and it is kept the hard way round: the
 * marking points are fixed when the question is asked, before the student has
 * answered, and stored where only the server can write
 * (`assistantRouteState`). The model's later verdict is one yes or no per
 * stored point. The marks come from the stored points, never from the
 * verdict, so a generous marker cannot also be a generous adder.
 *
 * **What is placed where.** The concept is whatever the material in front of
 * the student is filed under, chosen by the server; the model never names a
 * topic. The scope is the Learning Engine's scope for that material, so a
 * check counts in exactly the profile Tutor was reading when it asked.
 *
 * **What is deliberately not stored.** The question and the student's reply.
 * Point wording is kept, as for notebook marking, because it is the marker's
 * own language and the error-category rules read it.
 *
 * **Fail closed.** A proposal or a verdict that is not complete and coherent
 * is dropped. A check the student did not attempt -- they asked for a hint,
 * changed the subject -- is not a zero; it is nothing.
 */

export const TUTOR_CHECK_SCHEMA_VERSION = 1;
export const TUTOR_CHECKS_COLLECTION = "tutorChecks";

/** Stored with every check, so a change in how Tutor marks can be found later. */
export const TUTOR_CHECK_MARKER_VERSION = "tutor-quick-check-v1-2026-10-01";

/** A quick check is short: more than this is a practice question. */
export const MAX_CHECK_POINTS = 4;
const MAX_POINT_MARKS = 2;
const MAX_POINT_LENGTH = 200;
const MAX_ID_LENGTH = 160;
/** At most the concepts one piece of material is filed under. */
const MAX_CHECK_TOPICS = 6;
/**
 * How long a check waits for its answer. Long enough to think, or to come back
 * after a break; a reply the next morning is a new conversation, not an answer.
 */
export const PENDING_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

const TOPIC_KEY_PATTERN = /^(topic|deck|spec):[^/]+$/;

export type TutorCheckScope = { folderId: string } | { deckId: string };

export type TutorCheckPoint = { criterion: string; marks: number };

/** A question asked and not yet answered, held in the thread's route state. */
export type PendingTutorCheck = {
  id: string;
  topicKeys: string[];
  scope: TutorCheckScope;
  points: TutorCheckPoint[];
  askedAt: number;
};

export type TutorCheckCriterion = { criterion: string; awarded: boolean; awardedMarks: number };

export type TutorCheck = {
  id: string;
  topicKeys: string[];
  scope: TutorCheckScope;
  askedAt: number;
  markedAt: number;
  criterionResults: TutorCheckCriterion[];
  awardedMarks: number;
  maxMarks: number;
  provenance: "tutor";
  markerVersion: string;
};

export type TutorCheckWrite = Omit<TutorCheck, "id"> & {
  schemaVersion: typeof TUTOR_CHECK_SCHEMA_VERSION;
  createdAt: number;
};

function readId(value: unknown) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id.length > 0 && id.length <= MAX_ID_LENGTH && !id.includes("/") ? id : "";
}

function readScope(value: unknown): TutorCheckScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const folderId = readId(record.folderId);
  const deckId = readId(record.deckId);
  // Exactly one: a check counted in two scopes would count twice.
  if (folderId && !deckId) return { folderId };
  if (deckId && !folderId) return { deckId };
  return null;
}

function readTopicKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((key): key is string => typeof key === "string")
        .map((key) => key.trim())
        .filter((key) => key.length <= MAX_ID_LENGTH && TOPIC_KEY_PATTERN.test(key))
    )
  ).slice(0, MAX_CHECK_TOPICS);
}

function readPoints(value: unknown): TutorCheckPoint[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHECK_POINTS) return null;
  const points: TutorCheckPoint[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const record = candidate as Record<string, unknown>;
    const criterion =
      typeof record.criterion === "string" ? record.criterion.trim().slice(0, MAX_POINT_LENGTH) : "";
    const marks = record.marks;
    if (
      !criterion ||
      typeof marks !== "number" ||
      !Number.isInteger(marks) ||
      marks < 1 ||
      marks > MAX_POINT_MARKS
    ) {
      return null;
    }
    points.push({ criterion, marks });
  }
  return points;
}

/**
 * The check Tutor proposed with its question, placed by the server, or null.
 *
 * `proposal` is the model's; everything else is the server's. A proposal with
 * nowhere to count -- no scope, no concept -- is dropped before it is asked
 * about, rather than marked and thrown away afterwards.
 */
export function readTutorCheckProposal(input: {
  proposal: unknown;
  id: string;
  topicKeys: readonly string[];
  scope: TutorCheckScope;
  askedAt: number;
}): PendingTutorCheck | null {
  const id = readId(input.id);
  const topicKeys = readTopicKeys(input.topicKeys);
  const scope = readScope(input.scope);
  if (!id || topicKeys.length === 0 || !scope || !isValidEvidenceTime(input.askedAt)) return null;
  if (!input.proposal || typeof input.proposal !== "object" || Array.isArray(input.proposal)) {
    return null;
  }
  const points = readPoints((input.proposal as Record<string, unknown>).points);
  if (!points) return null;
  return { id, topicKeys, scope, points, askedAt: input.askedAt };
}

/**
 * A check still waiting for its answer, read back from route state, or null.
 *
 * Read with the same rules it was written with, because route state outlives
 * code: a check stored by an older version must not be marked by a newer one
 * that would have refused it.
 */
export function readPendingTutorCheck(value: unknown, now: number): PendingTutorCheck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const askedAt = typeof record.askedAt === "number" ? record.askedAt : 0;
  if (now - askedAt > PENDING_CHECK_TTL_MS || askedAt > now) return null;
  return readTutorCheckProposal({
    proposal: record,
    id: typeof record.id === "string" ? record.id : "",
    topicKeys: Array.isArray(record.topicKeys) ? (record.topicKeys as string[]) : [],
    scope: record.scope as TutorCheckScope,
    askedAt,
  });
}

export type TutorCheckRejection = "not_attempted" | "malformed";

export type TutorCheckResult =
  | { ok: true; check: Omit<TutorCheck, "id"> }
  | { ok: false; reason: TutorCheckRejection };

/**
 * The student's answer to a pending check, marked, or the reason it is not.
 *
 * The verdict is `attempted` and one boolean per stored point, in order. An
 * answer of "I don't know" is an attempt, and earns nothing: it is an honest
 * statement of what is known, the same as a skipped Revision Session step.
 */
export function readTutorCheckMarking(input: {
  verdict: unknown;
  pending: PendingTutorCheck;
  markedAt: number;
}): TutorCheckResult {
  const { pending } = input;
  if (!isValidEvidenceTime(input.markedAt) || input.markedAt < pending.askedAt) {
    return { ok: false, reason: "malformed" };
  }
  if (!input.verdict || typeof input.verdict !== "object" || Array.isArray(input.verdict)) {
    return { ok: false, reason: "malformed" };
  }
  const record = input.verdict as Record<string, unknown>;
  if (record.attempted === false) return { ok: false, reason: "not_attempted" };
  if (record.attempted !== true) return { ok: false, reason: "malformed" };
  const awarded = record.awarded;
  if (
    !Array.isArray(awarded) ||
    awarded.length !== pending.points.length ||
    !awarded.every((entry) => typeof entry === "boolean")
  ) {
    return { ok: false, reason: "malformed" };
  }

  const criterionResults = pending.points.map((point, index) => ({
    criterion: point.criterion,
    awarded: awarded[index] === true,
    awardedMarks: point.marks,
  }));
  return {
    ok: true,
    check: {
      topicKeys: pending.topicKeys,
      scope: pending.scope,
      askedAt: pending.askedAt,
      markedAt: input.markedAt,
      criterionResults,
      awardedMarks: criterionResults.reduce(
        (total, entry) => total + (entry.awarded ? entry.awardedMarks : 0),
        0
      ),
      maxMarks: pending.points.reduce((total, point) => total + point.marks, 0),
      provenance: "tutor",
      markerVersion: TUTOR_CHECK_MARKER_VERSION,
    },
  };
}

export function buildTutorCheckWrite(check: Omit<TutorCheck, "id">, createdAt: number): TutorCheckWrite {
  return { ...check, schemaVersion: TUTOR_CHECK_SCHEMA_VERSION, createdAt };
}

/** A stored record, or null for anything not a well-formed version-1 check. */
export function decodeTutorCheck(id: string, data: Record<string, unknown>): TutorCheck | null {
  if (!readId(id) || data.schemaVersion !== TUTOR_CHECK_SCHEMA_VERSION || data.provenance !== "tutor") {
    return null;
  }
  const topicKeys = readTopicKeys(data.topicKeys);
  const scope = readScope(data.scope);
  const askedAt = typeof data.askedAt === "number" ? data.askedAt : 0;
  const markedAt = typeof data.markedAt === "number" ? data.markedAt : 0;
  if (topicKeys.length === 0 || !scope || !isValidEvidenceTime(askedAt) || !isValidEvidenceTime(markedAt)) {
    return null;
  }
  if (!Array.isArray(data.criterionResults) || data.criterionResults.length === 0) return null;
  const criterionResults: TutorCheckCriterion[] = [];
  for (const candidate of data.criterionResults.slice(0, MAX_CHECK_POINTS)) {
    if (!candidate || typeof candidate !== "object") return null;
    const entry = candidate as Record<string, unknown>;
    if (
      typeof entry.criterion !== "string" ||
      !entry.criterion.trim() ||
      typeof entry.awarded !== "boolean" ||
      typeof entry.awardedMarks !== "number" ||
      !Number.isInteger(entry.awardedMarks) ||
      entry.awardedMarks < 1 ||
      entry.awardedMarks > MAX_POINT_MARKS
    ) {
      return null;
    }
    criterionResults.push({
      criterion: entry.criterion.trim().slice(0, MAX_POINT_LENGTH),
      awarded: entry.awarded,
      awardedMarks: entry.awardedMarks,
    });
  }
  // Recomputed rather than trusted, so a record edited by hand cannot disagree with itself.
  const maxMarks = criterionResults.reduce((total, entry) => total + entry.awardedMarks, 0);
  const awardedMarks = criterionResults.reduce(
    (total, entry) => total + (entry.awarded ? entry.awardedMarks : 0),
    0
  );
  return {
    id,
    topicKeys,
    scope,
    askedAt,
    markedAt,
    criterionResults,
    awardedMarks,
    maxMarks,
    provenance: "tutor",
    markerVersion:
      typeof data.markerVersion === "string" && data.markerVersion
        ? data.markerVersion
        : TUTOR_CHECK_MARKER_VERSION,
  };
}

/** The shape the marked-answer reader takes, as notebook marking hands it over. */
export function tutorCheckMarkedAnswer(check: TutorCheck): StoredMarkedAnswer {
  return {
    attempted: true,
    counted: true,
    awardedMarks: check.awardedMarks,
    maxMarks: check.maxMarks,
    criterionResults: check.criterionResults,
  };
}
