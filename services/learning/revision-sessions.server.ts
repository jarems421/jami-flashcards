import "server-only";

import type { RevisionSessionEvidence } from "@/lib/learning/profile/revision-signals";
import { decodeRevisionSession, serializeRevisionSession } from "@/lib/revision/record";
import { createRevisionSteps } from "@/lib/revision/session-machine";
import {
  REVISION_SESSION_SCHEMA_VERSION,
  REVISION_SESSIONS_COLLECTION,
  type RevisionSessionRecord,
  type RevisionTarget,
} from "@/lib/revision/types";
import { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";

/**
 * Revision Sessions in Firestore, through the Admin SDK only.
 *
 * The rules refuse every client write to these: a session holds the answers to
 * its own questions until it ends, and its outcomes become evidence about what
 * the student knows -- the two things a student must not be able to write for
 * themselves.
 */

const log = createLogger({ route: "learning.revision_sessions" });

/** A session left longer than this is not the same sitting. The mission handoff uses the same window. */
export const REVISION_RESUME_WINDOW_MS = 4 * 60 * 60 * 1000;
/** How long one model call may hold a session before another request may try. Longer than the prepare route may run. */
const WORK_LEASE_MS = 100_000;
/** Enough finished sessions for a term's worth of evidence, bounded like every other profile read. */
const EVIDENCE_LIMIT = 60;
const OPEN_STATUSES = ["preparing", "active"] as const;

function sessions(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection(REVISION_SESSIONS_COLLECTION);
}

/** An unfinished session closed off: its lesson, and the answers in it, go. */
function closed(
  record: RevisionSessionRecord,
  status: "abandoned" | "failed",
  now: number
): RevisionSessionRecord {
  const { lesson, workingSince, ...rest } = record;
  void lesson;
  void workingSince;
  return { ...rest, status, endedAt: now, updatedAt: now };
}

function isStale(record: RevisionSessionRecord, now: number) {
  return (
    (record.status === "preparing" || record.status === "active") &&
    now - record.updatedAt > REVISION_RESUME_WINDOW_MS
  );
}

/**
 * The session for this recommendation, resumed if one is still open, or a new
 * one.
 *
 * One open session per student. Pressing Start again on the same advice picks
 * the sitting back up rather than paying for a second lesson; starting a
 * different one closes the old one off, lesson and all.
 */
export async function startRevisionSession(input: {
  uid: string;
  target: RevisionTarget;
  actionId?: string;
  why: string[];
  now?: number;
}): Promise<RevisionSessionRecord> {
  const now = input.now ?? Date.now();
  const collection = sessions(input.uid);
  const open = await collection.where("status", "in", [...OPEN_STATUSES]).limit(10).get();

  let resumable: RevisionSessionRecord | null = null;
  const batch = getAdminDb().batch();
  let closing = 0;
  for (const document of open.docs) {
    const record = decodeRevisionSession(document.id, document.data());
    if (!record) continue;
    const sameWork = input.actionId
      ? record.actionId === input.actionId
      : record.target.topicKey === input.target.topicKey &&
        record.target.folderId === input.target.folderId;
    if (!resumable && sameWork && !isStale(record, now)) {
      resumable = record;
      continue;
    }
    batch.set(document.ref, serializeRevisionSession(closed(record, "abandoned", now)));
    closing += 1;
  }
  if (closing > 0) await batch.commit();
  if (resumable) return resumable;

  const reference = collection.doc();
  const record: RevisionSessionRecord = {
    id: reference.id,
    schemaVersion: REVISION_SESSION_SCHEMA_VERSION,
    policy: "teach",
    status: "preparing",
    target: input.target,
    ...(input.actionId ? { actionId: input.actionId } : {}),
    why: input.why,
    steps: createRevisionSteps("teach"),
    position: 0,
    createdAt: now,
    updatedAt: now,
  };
  await reference.set(serializeRevisionSession(record));
  return record;
}

/** A session, closed off first if it has been left too long to resume. */
export async function loadRevisionSession(
  uid: string,
  sessionId: string,
  now = Date.now()
): Promise<RevisionSessionRecord | null> {
  const reference = sessions(uid).doc(sessionId);
  const snapshot = await reference.get();
  if (!snapshot.exists) return null;
  const record = decodeRevisionSession(snapshot.id, snapshot.data());
  if (!record) {
    log.warn("session.unreadable", { sessionId });
    return null;
  }
  if (!isStale(record, now)) return record;
  const abandoned = closed(record, "abandoned", now);
  await reference.set(serializeRevisionSession(abandoned));
  return abandoned;
}

export type RevisionClaim =
  | { kind: "claimed"; record: RevisionSessionRecord }
  | { kind: "busy" }
  | { kind: "missing" };

/**
 * Take the session for one model call.
 *
 * Two requests for the same session -- a double tap, a remount, a retry after a
 * timeout that actually succeeded -- would otherwise both call the model and
 * both be charged. The lease makes the second one wait instead.
 */
export async function claimRevisionWork(
  uid: string,
  sessionId: string,
  now = Date.now()
): Promise<RevisionClaim> {
  const reference = sessions(uid).doc(sessionId);
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const record = snapshot.exists ? decodeRevisionSession(snapshot.id, snapshot.data()) : null;
    if (!record) return { kind: "missing" as const };
    if (record.workingSince !== undefined && now - record.workingSince < WORK_LEASE_MS) {
      return { kind: "busy" as const };
    }
    transaction.update(reference, { workingSince: now });
    return { kind: "claimed" as const, record: { ...record, workingSince: now } };
  });
}

/**
 * Write the next state, if nothing else has moved the session since it was read.
 *
 * Returns "conflict" rather than overwriting: a second tab or a double submit
 * must not replace a step's mark with a different one. Clears the work lease,
 * since every save is the end of whatever held it.
 */
export async function saveRevisionSession(
  uid: string,
  record: RevisionSessionRecord,
  expectedUpdatedAt: number,
  now = Date.now()
): Promise<RevisionSessionRecord | "conflict"> {
  const reference = sessions(uid).doc(record.id);
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists ? decodeRevisionSession(snapshot.id, snapshot.data()) : null;
    if (!current || current.updatedAt !== expectedUpdatedAt) return "conflict" as const;
    const { workingSince, ...rest } = record;
    void workingSince;
    const next: RevisionSessionRecord = { ...rest, updatedAt: Math.max(now, expectedUpdatedAt + 1) };
    transaction.set(reference, serializeRevisionSession(next));
    return next;
  });
}

/** Give up a lease without changing anything else, after a model call failed. */
export async function releaseRevisionWork(uid: string, sessionId: string) {
  await sessions(uid)
    .doc(sessionId)
    .update({ workingSince: null })
    .catch((error: unknown) => log.warn("lease.release_failed", { error }));
}

/**
 * Close a session off as failed: its preparation could not be done.
 *
 * Nothing in a failed session counts, and its lesson -- if half of one was ever
 * stored -- goes with it.
 */
export async function failRevisionSession(
  uid: string,
  record: RevisionSessionRecord,
  now = Date.now()
) {
  await sessions(uid).doc(record.id).set(serializeRevisionSession(closed(record, "failed", now)));
}

/**
 * Finished sessions in one profile's scope, as the Learning Engine reads them.
 *
 * Ordered by `completedAt`, which only a finished session carries, so the
 * query never sees an open or abandoned one. A failure costs this evidence and
 * nothing else, as with every other source the profile reads.
 */
export async function loadRevisionEvidence(input: {
  uid: string;
  folderId?: string;
  deckId?: string;
}): Promise<RevisionSessionEvidence[]> {
  if (!input.folderId && !input.deckId) return [];
  try {
    const snapshot = await sessions(input.uid)
      .orderBy("completedAt", "desc")
      .limit(EVIDENCE_LIMIT)
      .get();
    return snapshot.docs.flatMap((document) => {
      const record = decodeRevisionSession(document.id, document.data());
      if (!record || record.status !== "completed" || record.completedAt === undefined) return [];
      const inScope = input.folderId
        ? record.target.folderId === input.folderId
        : record.target.deckId === input.deckId;
      if (!inScope) return [];
      return [
        {
          id: record.id,
          actionId: record.actionId,
          topicKey: record.target.topicKey,
          completedAt: record.completedAt,
          steps: record.steps,
        },
      ];
    });
  } catch (error) {
    log.warn("evidence.unavailable", { error });
    return [];
  }
}
