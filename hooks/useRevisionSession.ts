"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RevisionSessionView } from "@/lib/revision/view";
import {
  getRevisionSession,
  prepareRevisionSession,
  RevisionSessionError,
  sendRevisionStep,
  type RevisionStepInput,
} from "@/services/learning/revision-sessions";

/** How often to look again while another request is writing the lesson. */
const PREPARING_POLL_MS = 3_000;
/** Past this, whoever was writing it has given up; say so rather than wait forever. */
const PREPARING_GIVE_UP_MS = 120_000;

export type RevisionBusy = RevisionStepInput["type"] | null;

export type RevisionSessionState = {
  session: RevisionSessionView | null;
  /** Opening or preparing went wrong; the screen offers a way out. */
  error: string | null;
  busy: RevisionBusy;
  /** About the answer just marked. Shown once; a reload shows the verdict alone. */
  feedback: string | null;
  /** The marker could not say, so the student judges this one. */
  selfGrade: { answer: string; solution: string } | null;
  /** A step that could not be sent. The answer stays in the field. */
  stepError: string | null;
  act(input: RevisionStepInput): Promise<void>;
};

function messageOf(error: unknown, fallback: string) {
  return error instanceof RevisionSessionError ? error.message : fallback;
}

/**
 * A Revision Session as the screen holds it.
 *
 * The server decides everything; this only asks and shows. Each step returns
 * the whole session as the server now sees it, so nothing here predicts what
 * comes next -- which is what lets a reload, a second tab or a lost connection
 * all land back on exactly the right step.
 */
export function useRevisionSession(sessionId: string): RevisionSessionState {
  const [session, setSession] = useState<RevisionSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<RevisionBusy>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selfGrade, setSelfGrade] = useState<RevisionSessionState["selfGrade"]>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const preparingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
   * Opening a session, and preparing it if it is not ready.
   *
   * Asked once per mount. A second request -- a remount, another tab -- is
   * answered "already being prepared" by the server, and this then waits for
   * the lesson to appear rather than asking for another.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const settle = (next: RevisionSessionView) => {
      if (!cancelled) setSession(next);
    };

    const waitForLesson = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        try {
          const next = await getRevisionSession(sessionId);
          settle(next);
          if (next.status !== "preparing") return;
          if (Date.now() - startedAt > PREPARING_GIVE_UP_MS) {
            setError("Jami couldn't prepare this session just now.");
            return;
          }
          waitForLesson();
        } catch (caught) {
          if (!cancelled) setError(messageOf(caught, "This session could not be opened."));
        }
      }, PREPARING_POLL_MS);
    };

    (async () => {
      try {
        const opened = await getRevisionSession(sessionId);
        settle(opened);
        if (opened.status !== "preparing") return;
        if (preparingRef.current) {
          // This mount already asked; wait for that answer to land.
          waitForLesson();
          return;
        }
        preparingRef.current = true;
        const prepared = await prepareRevisionSession(sessionId);
        settle(prepared.session);
        if (prepared.pending || prepared.session.status === "preparing") waitForLesson();
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught, "This session could not be opened."));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  const act = useCallback(
    async (input: RevisionStepInput) => {
      setBusy(input.type);
      setStepError(null);
      try {
        const reply = await sendRevisionStep(sessionId, input);
        if (!mountedRef.current) return;
        setSession(reply.session);
        setFeedback(reply.feedback ?? null);
        setSelfGrade(reply.selfGrade ?? null);
      } catch (caught) {
        if (mountedRef.current) setStepError(messageOf(caught, "Couldn't reach Jami. Try again."));
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [sessionId]
  );

  return { session, error, busy, feedback, selfGrade, stepError, act };
}
