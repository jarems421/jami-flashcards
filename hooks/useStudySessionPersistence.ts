"use client";

import { useCallback, useEffect } from "react";
import type { StudySessionRecord } from "@/hooks/useStudySessionRecord";
import {
  clearPersistedStudySession,
  closePersistedStudySession,
  markClosedStudySessionTombstoneSynced,
  saveClosedStudySessionTombstone,
  savePersistedStudySession,
  type PersistedStudySession,
  type StudySessionEndReason,
  type StudySessionKind,
  type StudySessionStatus,
} from "@/lib/study/session";
import { closeRemoteStudySession, saveRemoteActiveStudySession } from "@/services/study/session";

type ClosingStatus = Exclude<StudySessionStatus, "active">;

/**
 * Keeps the session on screen saved, here and on the server, and closes it.
 *
 * Every change is saved as it happens, and once more as the page is hidden or
 * frozen, because a phone can discard a backgrounded tab without warning. A
 * finished session is closed rather than saved, and a closed one leaves a
 * tombstone on this device so a slow server copy can never bring it back.
 */
export function useStudySessionPersistence({
  userId,
  loaded,
  sessionKind,
  done,
  record,
  getCurrentPersistedSession,
}: {
  userId: string;
  loaded: boolean;
  sessionKind: StudySessionKind | null;
  done: boolean;
  record: Pick<StudySessionRecord, "noteClosed" | "claimRemoteClose">;
  /** The session on screen as it would be saved now, or null when there is none. */
  getCurrentPersistedSession: (now?: number) => PersistedStudySession | null;
}) {
  const { noteClosed, claimRemoteClose } = record;

  const closeSession = useCallback(
    (
      session: PersistedStudySession,
      status: ClosingStatus,
      reason: StudySessionEndReason,
      now: number,
      options: { sendRemote?: boolean } = {}
    ) => {
      clearPersistedStudySession(userId);
      saveClosedStudySessionTombstone(closePersistedStudySession(session, status, reason, now));
      noteClosed();
      if (options.sendRemote === false) return;
      void closeRemoteStudySession(userId, session, status, reason, now)
        .then((saved) => {
          if (saved) markClosedStudySessionTombstoneSynced(userId);
        })
        .catch((error) => {
          console.warn("Failed to close study session.", error);
        });
    },
    [noteClosed, userId]
  );

  useEffect(() => {
    if (!loaded || !sessionKind) return;

    const now = Date.now();
    const currentSession = getCurrentPersistedSession(now);
    if (!currentSession) return;

    if (done) {
      const closeKey = `${currentSession.sessionId}:${currentSession.revision}:completed`;
      closeSession(currentSession, "completed", "completed", now, {
        sendRemote: claimRemoteClose(closeKey),
      });
      return;
    }

    savePersistedStudySession(currentSession);
    void saveRemoteActiveStudySession(currentSession).catch((error) => {
      console.warn("Failed to save active study session.", error);
    });
  }, [claimRemoteClose, closeSession, done, getCurrentPersistedSession, loaded, sessionKind]);

  useEffect(() => {
    const persistBeforeSuspend = () => {
      const currentSession = getCurrentPersistedSession();
      if (currentSession && currentSession.status === "active") {
        savePersistedStudySession(currentSession);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistBeforeSuspend();
      }
    };

    window.addEventListener("pagehide", persistBeforeSuspend);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("freeze", persistBeforeSuspend);

    return () => {
      window.removeEventListener("pagehide", persistBeforeSuspend);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("freeze", persistBeforeSuspend);
    };
  }, [getCurrentPersistedSession]);

  return { closeSession };
}
