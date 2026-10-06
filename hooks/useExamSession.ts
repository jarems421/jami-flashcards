"use client";

import { useCallback, useEffect, useState } from "react";
import { loadPastPaperPracticeSession } from "@/services/study/exam-practice";

export type ExamSessionData = Awaited<ReturnType<typeof loadPastPaperPracticeSession>>;

/**
 * A past-paper session and its attempts, as the server last reported them.
 *
 * Read on opening, and again whenever the page asks -- which, while an answer
 * is being marked or its mark checked, `useExamSessionWatch` does by itself.
 */
function loadFailureMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "This session could not be loaded.";
}

export function useExamSession(sessionId: string) {
  const [data, setData] = useState<ExamSessionData | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await loadPastPaperPracticeSession(sessionId));
    } catch (reason) {
      setError(loadFailureMessage(reason));
    }
  }, [sessionId]);

  // The first read, dropped if the page has moved to another session by the time it lands.
  useEffect(() => {
    let active = true;
    loadPastPaperPracticeSession(sessionId)
      .then((loaded) => {
        if (active) setData(loaded);
      })
      .catch((reason: unknown) => {
        if (active) setError(loadFailureMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  return { data, setData, error, setError, refresh };
}

/**
 * Keeps re-reading the session while something is being worked on for it.
 *
 * `pending` names what is in progress, and the watch starts afresh whenever it
 * changes and stops when it is null. Steady rather than backing off: the
 * backoff reached fifteen seconds by the sixth check, so a mark finished at
 * second 19 was not shown until second 32 -- the wait it added fell on exactly
 * the markings already taking longest. Only a mark running well past its usual
 * length slows down, so something stranded is not polled at full speed until
 * its lease runs out.
 *
 * Returns the time of the last read, so a lease that runs out is noticed on
 * screen.
 */
export function useExamSessionWatch({
  pending,
  refresh,
}: {
  pending: string | null;
  refresh: () => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (pending === null) return;
    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const delay = () => (Date.now() - startedAt < 180_000 ? 2_500 : 10_000);
    const tick = async () => {
      await refresh();
      if (cancelled) return;
      setNow(Date.now());
      timer = setTimeout(() => void tick(), delay());
    };
    timer = setTimeout(() => void tick(), delay());
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pending, refresh]);

  return now;
}
