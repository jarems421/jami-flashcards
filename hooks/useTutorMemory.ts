"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFeedback } from "@/hooks/useFeedback";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  changeTutorMemory,
  loadTutorMemoryView,
  type TutorMemoryChange,
  type TutorMemoryView,
} from "@/services/ai/tutor-memory";

/**
 * What Jami remembers about the student, and the student's changes to it.
 *
 * Shared by the settings drawer and the full page, like the rest of
 * personalisation. Changes go through one queue so two quick taps -- forget
 * this, forget that -- reach the server in order, and each shows the memory
 * the server returned rather than a guess at it.
 */
export function useTutorMemory() {
  const [view, setView] = useState<TutorMemoryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { feedback, showThrownError, clear } = useFeedback();
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setView(await loadTutorMemoryView());
      setLoadFailed(false);
    } catch (error) {
      setLoadFailed(true);
      showThrownError(error, "Jami could not load what it remembers.");
    } finally {
      setLoading(false);
    }
  }, [showThrownError]);

  useEffect(() => {
    // Nothing to load when memory is switched off for the whole app.
    if (featureFlags.enableTutorMemory) void reload();
  }, [reload]);

  const change = useCallback(
    (next: TutorMemoryChange, optimistic?: (current: TutorMemoryView) => TutorMemoryView) => {
      const previous = view;
      if (optimistic && previous) setView(optimistic(previous));
      pendingRef.current += 1;
      setBusy(true);
      const run = queueRef.current.then(async () => {
        try {
          setView(await changeTutorMemory(next));
          clear();
        } catch (error) {
          if (previous) setView(previous);
          showThrownError(error, "Jami could not save that change.");
        } finally {
          pendingRef.current -= 1;
          if (pendingRef.current === 0) setBusy(false);
        }
      });
      queueRef.current = run;
      return run;
    },
    [clear, showThrownError, view]
  );

  const setEnabled = useCallback(
    (enabled: boolean) =>
      change({ target: "enabled", enabled }, (current) => ({ ...current, enabled })),
    [change]
  );
  const edit = useCallback(
    (id: string, text: string) =>
      change({ target: "edit", id, text }, (current) => ({
        ...current,
        items: current.items.map((item) => (item.id === id ? { ...item, text } : item)),
      })),
    [change]
  );
  const forget = useCallback(
    (id: string) =>
      change({ target: "forget", id }, (current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== id),
      })),
    [change]
  );
  const forgetAll = useCallback(
    () => change({ target: "forget-all" }, (current) => ({ ...current, items: [] })),
    [change]
  );

  return {
    view,
    loading,
    loadFailed,
    busy,
    feedback,
    clearFeedback: clear,
    reload,
    setEnabled,
    edit,
    forget,
    forgetAll,
  };
}
