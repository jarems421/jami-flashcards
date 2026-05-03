import { doc, getDoc, runTransaction } from "firebase/firestore";
import {
  ACTIVE_STUDY_SESSION_DOC_ID,
  closePersistedStudySession,
  isIncomingSessionNewer,
  normalizePersistedStudySession,
  type PersistedStudySession,
  type StudySessionEndReason,
  type StudySessionStatus,
} from "@/lib/study/session";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";

const LOAD_MS = 30_000;
const SAVE_MS = 30_000;

export type RemoteStudySessionLoadResult = {
  session: PersistedStudySession | null;
  closedSession?: PersistedStudySession | null;
  foundRemoteSession: boolean;
};

function getActiveStudySessionDoc(userId: string) {
  return doc(db, "users", userId, "studyState", ACTIVE_STUDY_SESSION_DOC_ID);
}

function getSavedAt(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  const savedAt = (value as { savedAt?: unknown }).savedAt;
  return typeof savedAt === "number" && Number.isFinite(savedAt) ? savedAt : 0;
}

function normalizeStoredStudySession(
  value: Record<string, unknown> | null,
  userId: string,
  currentStudyDayKey: string,
  now: number
) {
  if (!value) {
    return null;
  }

  const status = value.status;
  const normalized = normalizePersistedStudySession(
    { ...value, status: "active" },
    userId,
    currentStudyDayKey,
    now
  );

  if (!normalized) {
    return null;
  }

  if (status === "ended" || status === "completed") {
    return {
      ...normalized,
      status,
      endedAt: typeof value.endedAt === "number" ? value.endedAt : normalized.savedAt,
      endReason:
        value.endReason === "user-ended" ||
        value.endReason === "completed" ||
        value.endReason === "expired"
          ? value.endReason
          : status === "completed"
            ? "completed"
            : "user-ended",
      closedRevision:
        typeof value.closedRevision === "number" && Number.isFinite(value.closedRevision)
          ? Math.floor(value.closedRevision)
          : normalized.revision,
    } satisfies PersistedStudySession;
  }

  return normalized;
}

export async function loadRemoteActiveStudySession(
  userId: string,
  currentStudyDayKey: string,
  now = Date.now()
): Promise<RemoteStudySessionLoadResult> {
  const snapshot = await withTimeout(
    getDoc(getActiveStudySessionDoc(userId)),
    LOAD_MS,
    "Load active study session"
  );

  if (!snapshot.exists()) {
    return { session: null, foundRemoteSession: false };
  }

  const storedSession = normalizeStoredStudySession(
    snapshot.data() as Record<string, unknown>,
    userId,
    currentStudyDayKey,
    now
  );

  return {
    session: storedSession?.status === "active" ? storedSession : null,
    closedSession: storedSession?.status !== "active" ? storedSession : null,
    foundRemoteSession: true,
  };
}

export async function saveRemoteActiveStudySession(session: PersistedStudySession) {
  const sessionRef = getActiveStudySessionDoc(session.userId);

  return withTimeout(
    runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      const existingData = snapshot.exists()
        ? (snapshot.data() as Record<string, unknown>)
        : null;
      const existingSavedAt = getSavedAt(existingData);
      const existingSession = existingData
        ? normalizeStoredStudySession(
            existingData,
            session.userId,
            session.studyDayKey,
            Math.max(existingSavedAt, session.savedAt)
          )
        : null;

      if (existingSession && !isIncomingSessionNewer(existingSession, session)) {
        return false;
      }

      transaction.set(sessionRef, session);
      return true;
    }),
    SAVE_MS,
    "Save active study session"
  );
}

export async function closeRemoteStudySession(
  userId: string,
  session: PersistedStudySession,
  status: Exclude<StudySessionStatus, "active">,
  reason: StudySessionEndReason,
  now = Date.now()
) {
  const closedSession =
    session.status === "active"
      ? closePersistedStudySession(session, status, reason, now)
      : {
          ...session,
          status,
          endReason: reason,
          endedAt: session.endedAt ?? now,
          savedAt: now,
          closedRevision: session.closedRevision ?? session.revision,
        };
  const sessionRef = getActiveStudySessionDoc(userId);

  return withTimeout(
    runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      const existingData = snapshot.exists()
        ? (snapshot.data() as Record<string, unknown>)
        : null;
      const existingSavedAt = getSavedAt(existingData);
      const existingSession = existingData
        ? normalizeStoredStudySession(
            existingData,
            userId,
            closedSession.studyDayKey,
            Math.max(existingSavedAt, closedSession.savedAt)
          )
        : null;

      if (existingSession && !isIncomingSessionNewer(existingSession, closedSession)) {
        return false;
      }

      transaction.set(sessionRef, closedSession);
      return true;
    }),
    SAVE_MS,
    "Close active study session"
  );
}
