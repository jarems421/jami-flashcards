import { doc, getDoc, runTransaction } from "firebase/firestore";
import {
  ACTIVE_STUDY_SESSION_DOC_ID,
  closePersistedStudySession,
  isStudySessionProgressRegression,
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

function getStartedAt(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  const startedAt = (value as { startedAt?: unknown }).startedAt;
  return typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : 0;
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

  return {
    session: normalizePersistedStudySession(
      snapshot.data() as Record<string, unknown>,
      userId,
      currentStudyDayKey,
      now
    ),
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
      const existingStartedAt = getStartedAt(existingData);
      const existingSession = existingData
        ? normalizePersistedStudySession(
            existingData,
            session.userId,
            session.studyDayKey,
            Math.max(existingSavedAt, session.savedAt)
          )
        : null;

      if (existingData && existingStartedAt > session.startedAt) {
        return false;
      }

      if (
        existingData &&
        existingStartedAt === session.startedAt &&
        existingSavedAt > session.savedAt
      ) {
        return false;
      }

      if (
        existingData &&
        existingData.status !== "active" &&
        existingSavedAt >= session.startedAt
      ) {
        return false;
      }

      if (existingSession && isStudySessionProgressRegression(existingSession, session)) {
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
  const closedSession = closePersistedStudySession(session, status, reason, now);
  const sessionRef = getActiveStudySessionDoc(userId);

  return withTimeout(
    runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      const existingData = snapshot.exists()
        ? (snapshot.data() as Record<string, unknown>)
        : null;

      if (existingData && getSavedAt(existingData) > closedSession.savedAt) {
        return false;
      }

      if (existingData && getStartedAt(existingData) > closedSession.startedAt) {
        return false;
      }

      transaction.set(sessionRef, closedSession);
      return true;
    }),
    SAVE_MS,
    "Close active study session"
  );
}
