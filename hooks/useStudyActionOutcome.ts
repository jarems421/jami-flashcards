"use client";

import { useCallback, useEffect, useRef } from "react";
import { noteMissionCompleted } from "@/lib/learning/mission-handoff";
import { getStudyDayKey } from "@/lib/study/day";
import { noteStudyActionOutcomeById } from "@/services/learning/study-action-events";

/**
 * Tells the Learning Engine what became of the work it asked for.
 *
 * Only for a session a recommendation opened, and each outcome at most once:
 * finishing first wins, and walking away after finishing is not abandoning.
 * The write is deduplicated by day anyway; the refs keep it from being sent on
 * every later render.
 *
 * Returns `noteLeft`, for leaving through the page's own controls. Leaving by
 * closing, backgrounding or navigating away is noticed here.
 */
export function useStudyActionOutcome({
  userId,
  actionId,
  sessionOpen,
  done,
  reviewedCards,
  studyDayKey,
}: {
  userId: string;
  actionId: string | null;
  /** A session is on screen and not yet finished. */
  sessionOpen: boolean;
  done: boolean;
  reviewedCards: number;
  /** The study day the session belongs to, once it has one. */
  studyDayKey: string | null;
}) {
  const completionNotedRef = useRef(false);
  const abandonNotedRef = useRef(false);
  const latestRef = useRef({ sessionOpen, studyDayKey });
  useEffect(() => {
    latestRef.current = { sessionOpen, studyDayKey };
  });

  /*
   * Only once cards were genuinely answered. Arriving at an empty queue is not
   * doing the work, and recording it as such would rest the advice without
   * anything having happened.
   */
  useEffect(() => {
    if (!done || !actionId || !userId) return;
    if (reviewedCards === 0) return;
    if (completionNotedRef.current) return;
    completionNotedRef.current = true;
    noteStudyActionOutcomeById(userId, actionId, "completed", studyDayKey ?? getStudyDayKey());
    /*
     * And tell Today, so the page the student came from can say so when they
     * go back. Separate from the record above on purpose: that one is evidence
     * the engine reads, this one is a sentence, and losing it costs nothing.
     */
    noteMissionCompleted(actionId, reviewedCards);
  }, [actionId, done, reviewedCards, studyDayKey, userId]);

  /*
   * Recorded at the moment they go, never inferred later from the absence of a
   * completion: a session still open, a closed tab and a lost connection are
   * indistinguishable afterwards, and none of them is a decision to stop.
   *
   * Read from the latest render rather than from when the listener was added,
   * so that a session finishing in the same render as anything else is never
   * mistaken for one being left.
   */
  const noteLeft = useCallback(() => {
    if (!actionId || !userId) return;
    if (abandonNotedRef.current || completionNotedRef.current) return;
    if (!latestRef.current.sessionOpen) return;
    abandonNotedRef.current = true;
    noteStudyActionOutcomeById(
      userId,
      actionId,
      "abandoned",
      latestRef.current.studyDayKey ?? getStudyDayKey()
    );
  }, [actionId, userId]);

  /*
   * `pagehide` rather than `beforeunload`, because it also fires when a phone
   * backgrounds the tab, and a student who switches app mid-session has done
   * the same thing as one who closes it.
   */
  useEffect(() => {
    window.addEventListener("pagehide", noteLeft);
    return () => {
      window.removeEventListener("pagehide", noteLeft);
      // Leaving the page within the app is leaving the session just the same.
      noteLeft();
    };
  }, [noteLeft]);

  return { noteLeft };
}
