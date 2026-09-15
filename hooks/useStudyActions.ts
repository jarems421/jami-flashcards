"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  getCachedStudyActions,
  loadStudyActionsForToday,
  type StudyActionsResponse,
} from "@/services/learning/study-actions";

export type StudyActionsState = {
  status: "disabled" | "loading" | "ready" | "unavailable";
  actions: StudyAction[];
  folders: { id: string; name: string }[];
};

function initialState(uid: string, enabled: boolean): StudyActionsState {
  if (!enabled) return { status: "disabled", actions: [], folders: [] };
  const cached = getCachedStudyActions(uid);
  return cached
    ? { status: "ready", actions: cached.actions, folders: cached.folders }
    : { status: "loading", actions: [], folders: [] };
}

/**
 * The Learning Engine's study actions for Today.
 *
 * Loaded beside the dashboard rather than inside it: recommendations are a
 * server calculation over several folders and must never hold up the page.
 * Only the newest request may report back, and a failed refresh keeps the last
 * good list instead of blanking it.
 */
export function useStudyActions(uid: string, enabled: boolean) {
  const [state, setState] = useState<StudyActionsState>(() => initialState(uid, enabled));
  const requestRef = useRef(0);

  const settle = useCallback((requestId: number, result: StudyActionsResponse | null) => {
    if (requestRef.current !== requestId) return;
    setState((current) => {
      if (result) return { status: "ready", actions: result.actions, folders: result.folders };
      return current.status === "ready" ? current : { status: "unavailable", actions: [], folders: [] };
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    requestRef.current += 1;
    const requestId = requestRef.current;
    loadStudyActionsForToday()
      .then((result) => settle(requestId, result))
      .catch(() => settle(requestId, null));
  }, [enabled, settle, uid]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    requestRef.current += 1;
    const requestId = requestRef.current;
    try {
      settle(requestId, await loadStudyActionsForToday({ force: true }));
    } catch {
      settle(requestId, null);
    }
  }, [enabled, settle]);

  return { ...state, refresh };
}
