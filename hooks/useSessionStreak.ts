"use client";

import { useEffect, useState } from "react";
import { computeStudyStreak } from "@/lib/study/activity";
import { loadStudyActivity } from "@/services/study/activity";

/**
 * The streak a finished session has just extended, for its summary.
 *
 * Read only once the session is done and actually reviewed something: a
 * streak works as a reward for what was done, never as a warning about what
 * could be lost. Null until it has been read, and whenever it would not be
 * shown, so a second session never shows the first one's figure.
 */
export function useSessionStreak({
  userId,
  done,
  reviewedThisSession,
}: {
  userId: string;
  done: boolean;
  reviewedThisSession: number;
}) {
  const [daysRunning, setDaysRunning] = useState<number | null>(null);
  const counting = done && reviewedThisSession > 0;
  const [wasCounting, setWasCounting] = useState(counting);
  if (counting !== wasCounting) {
    setWasCounting(counting);
    if (!counting) setDaysRunning(null);
  }

  useEffect(() => {
    if (!counting) return;

    let cancelled = false;
    void loadStudyActivity(userId)
      .then((activity) => {
        if (!cancelled) setDaysRunning(computeStudyStreak(activity));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [counting, reviewedThisSession, userId]);

  return daysRunning;
}
