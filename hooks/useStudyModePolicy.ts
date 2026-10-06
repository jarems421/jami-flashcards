"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_STUDY_MODE_POLICY,
  readStudyModePolicy,
  saveStudyModePolicy,
} from "@/lib/study/study-mode-preference";
import type { StudyModePolicy } from "@/lib/study/study-modes";

/**
 * How Learn asks its cards: the student's remembered choice, or a resumed
 * session's own.
 *
 * `choose` is the student picking a mode and is remembered for next time.
 * `adopt` is a resumed session bringing the mode it was started with, which
 * is not a choice the student made today and so is not saved over theirs.
 */
export function useStudyModePolicy(userId: string) {
  const [policy, setPolicy] = useState<StudyModePolicy>(DEFAULT_STUDY_MODE_POLICY);

  useEffect(() => {
    setPolicy(readStudyModePolicy(userId));
  }, [userId]);

  const choose = useCallback(
    (next: StudyModePolicy) => {
      setPolicy(next);
      saveStudyModePolicy(userId, next);
    },
    [userId]
  );

  return { policy, choose, adopt: setPolicy };
}
