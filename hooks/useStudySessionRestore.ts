"use client";

import { useEffect, useRef, useState } from "react";
import type { StudyRequest } from "@/hooks/useStudyRequest";
import type { Topic } from "@/lib/material/topics";
import type { Card } from "@/lib/study/cards";
import type { DailyReviewState } from "@/lib/study/daily-review-types";
import { getStudyDayKey } from "@/lib/study/day";
import {
  clearPersistedStudySession,
  hasClosedStudySessionTombstone,
  loadPersistedStudySession,
  saveClosedStudySessionTombstone,
  type PersistedStudySession,
  type StudySessionEndReason,
  type StudySessionKind,
} from "@/lib/study/session";
import { planStudySessionRestore, type RemoteStudySessionState } from "@/lib/study/session-restore";
import { loadRemoteActiveStudySession } from "@/services/study/session";

export type ResumedStudySession = {
  session: PersistedStudySession;
  cards: Card[];
  index: number;
};

type RestoreRequest = Pick<StudyRequest, "mode" | "deckIds" | "topicIds" | "legacyTags">;

/**
 * Opens Learn on the session already in progress, or on the one the link asked
 * for.
 *
 * Each new request -- a different link, or the same page with a different
 * address -- first calls `onRequestChange` to clear whatever was on screen,
 * then restores once the queue has loaded. The queue is read as it stands when
 * the server answers, so a refresh landing in the meantime is used rather than
 * dropping the restore. Only when nothing was resumed does a link to Daily
 * Review or Focused Review start one, and unfinished cards from an earlier day
 * are never skipped on the student's behalf.
 */
export function useStudySessionRestore({
  userId,
  loaded,
  request,
  cards,
  topics,
  dailyReviewState,
  onRequestChange,
  onResume,
  onForget,
  closeSession,
  queue,
  startSession,
}: {
  userId: string;
  loaded: boolean;
  request: RestoreRequest;
  cards: Card[];
  topics: Topic[];
  dailyReviewState: DailyReviewState | null;
  /** The address asked for something new: clear the session on screen. */
  onRequestChange: () => void;
  onResume: (resumed: ResumedStudySession) => void;
  /** The saved session was closed elsewhere, so nothing on screen is saving. */
  onForget: () => void;
  closeSession: (
    session: PersistedStudySession,
    status: "completed",
    reason: StudySessionEndReason,
    now: number
  ) => void;
  /** What each kind of session would study if started now. */
  queue: { carryover: number; required: number; optional: number; focused: number };
  startSession: (kind: StudySessionKind) => void;
}) {
  const { mode, deckIds, topicIds, legacyTags } = request;
  /** The request the last restore finished for; ready only while it is still this one. */
  const [restoredFor, setRestoredFor] = useState<(RestoreRequest & { userId: string }) | null>(null);
  const restoreReady =
    restoredFor !== null &&
    restoredFor.userId === userId &&
    restoredFor.mode === mode &&
    restoredFor.deckIds === deckIds &&
    restoredFor.topicIds === topicIds &&
    restoredFor.legacyTags === legacyTags;
  const autoStartHandledRef = useRef(false);
  const latestRef = useRef({ cards, topics, dailyReviewState, onRequestChange, onResume, onForget, closeSession });
  useEffect(() => {
    latestRef.current = { cards, topics, dailyReviewState, onRequestChange, onResume, onForget, closeSession };
  });

  useEffect(() => {
    autoStartHandledRef.current = false;
    latestRef.current.onRequestChange();
  }, [deckIds, legacyTags, mode, topicIds]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;

    const restoreSession = async () => {
      const currentStudyDayKey = getStudyDayKey(Date.now());
      const localSession = loadPersistedStudySession(userId, currentStudyDayKey);
      let remote: RemoteStudySessionState = { session: null, closedSession: null, foundRemoteSession: false };
      try {
        remote = await loadRemoteActiveStudySession(userId, currentStudyDayKey);
      } catch (error) {
        console.warn("Failed to load remote active study session.", error);
      }
      if (cancelled) return;

      const latest = latestRef.current;
      const plan = planStudySessionRestore({
        localSession,
        remote,
        isClosedHere: (session) => hasClosedStudySessionTombstone(userId, session.sessionId, session.revision),
        request: { mode, deckIds, topicIds },
        topics: latest.topics,
        cards: latest.cards,
        dailyReviewState: latest.dailyReviewState,
      });

      switch (plan.kind) {
        case "none":
          if (plan.closedElsewhere) saveClosedStudySessionTombstone(plan.closedElsewhere, false);
          break;
        case "discard":
          if (plan.closedElsewhere) saveClosedStudySessionTombstone(plan.closedElsewhere, false);
          clearPersistedStudySession(userId);
          latest.onForget();
          break;
        case "close-finished":
          latest.closeSession(plan.session, "completed", "completed", Date.now());
          break;
        case "resume":
          latest.onResume(plan);
          autoStartHandledRef.current = true;
          break;
      }
      setRestoredFor({ userId, mode, deckIds, topicIds, legacyTags });
    };

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [deckIds, legacyTags, loaded, mode, topicIds, userId]);

  const { carryover, required, optional, focused } = queue;
  useEffect(() => {
    if (!loaded || !restoreReady || autoStartHandledRef.current) return;
    autoStartHandledRef.current = true;
    if (mode === "daily") {
      if (carryover > 0) return;
      if (required > 0) {
        startSession("daily-required");
      } else if (optional > 0) {
        startSession("daily-optional");
      }
      return;
    }
    if (mode === "custom" && focused > 0) {
      startSession("custom");
    }
  }, [carryover, focused, loaded, mode, optional, required, restoreReady, startSession]);

  /** Whether the restore for the current request has finished, resumed or not. */
  return { settled: restoreReady };
}
