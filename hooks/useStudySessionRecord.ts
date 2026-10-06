"use client";

import { useCallback, useRef, useState } from "react";
import type { PersistedStudySession } from "@/lib/study/session";

/** Who the session on screen is, as the saved copy names it. */
export type StudySessionIdentity = {
  sessionId: string;
  startedAt: number;
  studyDayKey: string;
  /** Seeds every shuffle in the session, so a resumed one asks the same way. */
  seed: number;
};

/**
 * The saved copy of the session on screen.
 *
 * The identity is state, because what is rendered depends on it. The revision
 * and the latest saved copy are refs: answers bump the revision synchronously
 * as they are committed, and only saving reads either of them.
 */
export function useStudySessionRecord() {
  const [identity, setIdentity] = useState<StudySessionIdentity | null>(null);
  const revisionRef = useRef(0);
  const latestRef = useRef<PersistedStudySession | null>(null);
  const remoteCloseKeyRef = useRef<string | null>(null);

  /** Make a session the one on screen. */
  const adopt = useCallback((session: PersistedStudySession) => {
    setIdentity({
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      studyDayKey: session.studyDayKey,
      seed: session.seed ?? 0,
    });
    revisionRef.current = session.revision;
    latestRef.current = session;
    remoteCloseKeyRef.current = null;
  }, []);

  /** Leave the session; whatever was saved or closed stays as it is. */
  const forget = useCallback(() => {
    setIdentity(null);
    revisionRef.current = 0;
    latestRef.current = null;
    remoteCloseKeyRef.current = null;
  }, []);

  const bumpRevision = useCallback(() => {
    revisionRef.current = Math.max(1, revisionRef.current + 1);
    return revisionRef.current;
  }, []);

  const currentRevision = useCallback(() => revisionRef.current, []);

  /** The session on screen, as it was last built to be saved. */
  const noteCurrent = useCallback((session: PersistedStudySession) => {
    revisionRef.current = session.revision;
    latestRef.current = session;
  }, []);

  /** The session is closed, so nothing on screen is waiting to be saved. */
  const noteClosed = useCallback(() => {
    latestRef.current = null;
  }, []);

  /** Whether a session is open and saving, which a refresh must not unmount. */
  const hasOpenSession = useCallback(() => latestRef.current !== null, []);

  /**
   * Claim the one remote close for a closing, so a re-render cannot send it
   * twice. False when this closing has already been sent.
   */
  const claimRemoteClose = useCallback((closeKey: string) => {
    if (remoteCloseKeyRef.current === closeKey) return false;
    remoteCloseKeyRef.current = closeKey;
    return true;
  }, []);

  return {
    identity,
    adopt,
    forget,
    bumpRevision,
    currentRevision,
    noteCurrent,
    noteClosed,
    hasOpenSession,
    claimRemoteClose,
  };
}

export type StudySessionRecord = ReturnType<typeof useStudySessionRecord>;
