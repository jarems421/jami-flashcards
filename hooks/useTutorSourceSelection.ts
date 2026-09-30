"use client";

import { useCallback, useMemo, useState } from "react";
import { JAMI_ASSISTANT_MAX_SOURCE_IDS } from "@/lib/ai/jami-assistant";
import type { Source } from "@/lib/material/sources";
import { toggleSourceSelection } from "@/lib/material/source-selectors";

export type TutorSourceSelection = {
  /** Whether the source list is in choose-several mode. */
  selecting: boolean;
  /** The chosen sources that still exist, in the order they were chosen. */
  selectedIds: string[];
  max: number;
  isFull: boolean;
  start: (initialSourceId?: string) => void;
  cancel: () => void;
  toggle: (sourceId: string) => void;
};

/**
 * Gathering several sources to ask Tutor about together.
 *
 * Separate from the source being read: choosing sources for a question should
 * not keep swapping the preview, and reading one should not change what is
 * chosen.
 */
export function useTutorSourceSelection(sources: readonly Source[]): TutorSourceSelection {
  const [selecting, setSelecting] = useState(false);
  const [chosenIds, setChosenIds] = useState<string[]>([]);
  const max = JAMI_ASSISTANT_MAX_SOURCE_IDS;

  // A source deleted or filtered out of existence mid-selection simply drops out.
  const selectedIds = useMemo(() => {
    const existing = new Set(sources.map((source) => source.id));
    return chosenIds.filter((id) => existing.has(id));
  }, [chosenIds, sources]);

  const start = useCallback((initialSourceId?: string) => {
    setSelecting(true);
    setChosenIds(initialSourceId ? [initialSourceId] : []);
  }, []);
  const cancel = useCallback(() => {
    setSelecting(false);
    setChosenIds([]);
  }, []);
  const toggle = useCallback(
    (sourceId: string) =>
      setChosenIds((current) => toggleSourceSelection(current, sourceId, max)),
    [max]
  );

  return {
    selecting,
    selectedIds,
    max,
    isFull: selectedIds.length >= max,
    start,
    cancel,
    toggle,
  };
}
