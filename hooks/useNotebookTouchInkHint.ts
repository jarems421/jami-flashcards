"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { NotebookPageSwipeState } from "@/hooks/useNotebookPageTurn";
import { isNotebookViewportZoomedIn } from "@/lib/workspace/notebook-inking";
import type { NotebookEditorTool } from "@/lib/workspace/notebook-page-state";

/** How recently the Pencil was writing for a touch to count as the palm holding it. */
const RECENT_PENCIL_MS = 5_000;
/** Finger lifts that drew nothing before the hint appears. */
const IGNORED_TOUCHES_BEFORE_HINT = 3;
const HINT_VISIBLE_MS = 2_600;

type UseNotebookTouchInkHintOptions = {
  enabled: boolean;
  tool: NotebookEditorTool;
  zoom: number;
  isPinchActive: () => boolean;
  stylusCooldownUntilRef: RefObject<number>;
  swipeRef: RefObject<NotebookPageSwipeState | null>;
};

/**
 * Tells somebody writing with a finger that fingers move the page and the
 * Pencil writes -- after a few tries, and never for a palm resting beside the
 * Pencil.
 */
export function useNotebookTouchInkHint({
  enabled,
  tool,
  zoom,
  isPinchActive,
  stylusCooldownUntilRef,
  swipeRef,
}: UseNotebookTouchInkHintOptions) {
  const [visible, setVisible] = useState(false);
  const ignoredTouchesRef = useRef(0);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    []
  );

  /** A finger lifted from the page without turning it. */
  const noteIgnoredTouch = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        event.pointerType !== "touch" ||
        tool === "text" ||
        !enabled ||
        swipeRef.current?.completed ||
        // A finger on a zoomed sheet is reaching for the viewport, not drawing.
        isNotebookViewportZoomedIn(zoom) ||
        isPinchActive() ||
        /*
         * A hand that was just holding the Pencil is a palm, not somebody trying
         * to write with a finger. Counted, every third palm lift while writing
         * told a Pencil user to use their Pencil -- and re-rendered this whole
         * page twice to show and hide the hint, in the middle of their words.
         */
        Date.now() < stylusCooldownUntilRef.current + RECENT_PENCIL_MS
      ) {
        return;
      }
      ignoredTouchesRef.current += 1;
      if (ignoredTouchesRef.current < IGNORED_TOUCHES_BEFORE_HINT) return;
      ignoredTouchesRef.current = 0;
      setVisible(true);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        setVisible(false);
        hideTimerRef.current = null;
      }, HINT_VISIBLE_MS);
    },
    [enabled, isPinchActive, stylusCooldownUntilRef, swipeRef, tool, zoom]
  );

  return { visible, noteIgnoredTouch };
}
