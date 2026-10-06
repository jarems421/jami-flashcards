"use client";

import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import type { NotebookNavigationLock } from "@/hooks/useNotebookPageTurn";
import type { NotebookSwipeEndOptions } from "@/hooks/useNotebookSwipeGesture";
import type { NotebookViewportController } from "@/hooks/useNotebookViewportController";
import {
  getNotebookSwipeDirection,
  mapClientPointToNotebookPage,
  shouldPointerSwipePages,
} from "@/lib/workspace/notebook-inking";
import type { NotebookEditorTool } from "@/lib/workspace/notebook-page-state";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

/** Where a pointer landed, in page coordinates, or null on a collapsed element. */
export function getNotebookPointFromEvent(event: ReactPointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return mapClientPointToNotebookPage({
    clientX: event.clientX,
    clientY: event.clientY,
    rect,
    width: NOTEBOOK_PAGE_COORDINATE_WIDTH,
    height: NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  });
}

type PointerHandler = (event: ReactPointerEvent<HTMLElement>) => void;

type UseNotebookPagePointerOptions = {
  /** Off on a phone that is only viewing. */
  enabled: boolean;
  lock: NotebookNavigationLock;
  tool: NotebookEditorTool;
  closeToolMenus: () => void;
  clearPlacedSelection: () => void;
  viewport: Pick<
    NotebookViewportController,
    "handleTouchPointerDown" | "handleTouchPointerMove" | "handleTouchPointerEnd"
  >;
  swipe: {
    start: PointerHandler;
    move: PointerHandler;
    end: (event: ReactPointerEvent<HTMLElement>, options?: NotebookSwipeEndOptions) => void;
  };
  /** The text tool's press: a box placed where it landed. */
  createTextBlockAtEvent: PointerHandler;
  /** A finger lifted without turning the page. */
  noteIgnoredTouch: PointerHandler;
};

/**
 * Routes pointer input on the page surface: the viewport's touch gestures
 * first (pinch and pan), then a page swipe, then the text tool.
 */
export function useNotebookPagePointer({
  enabled,
  lock,
  tool,
  closeToolMenus,
  clearPlacedSelection,
  viewport,
  swipe,
  createTextBlockAtEvent,
  noteIgnoredTouch,
}: UseNotebookPagePointerOptions) {
  const { lockedRef, swipeRef } = lock;
  const { handleTouchPointerDown, handleTouchPointerMove, handleTouchPointerEnd } = viewport;
  const { start: startSwipe, move: moveSwipe, end: endSwipe } = swipe;

  /**
   * A tap anywhere in the page frame lets go of whatever was selected.
   *
   * The sheet is only part of what somebody is looking at: on a wide window or
   * a zoomed-out page there is a margin all round it, and tapping there is
   * "tapping somewhere else" by any reading. Nothing was listening out there,
   * so a selected image kept its handles up until the page itself was touched.
   *
   * Deliberately the last word rather than a special case for the margin. This
   * sits above the sheet in the tree, so anything that means to keep its
   * selection stops the event on the way up -- which is what every layer
   * already does when a placed thing is picked up. Being unconditional means a
   * gap in that coverage lets go of the selection rather than stranding it.
   */
  const handleFramePointerDown = useCallback(() => {
    if (!enabled) return;
    if (lockedRef.current) return;
    clearPlacedSelection();
  }, [clearPlacedSelection, enabled, lockedRef]);

  const handlePagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (lockedRef.current) {
        event.preventDefault();
        event.stopPropagation();
        // Everything else stays blocked while a turn settles, but a flick is
        // tracked so it can be queued instead of silently swallowed.
        if (shouldPointerSwipePages(event.pointerType)) {
          startSwipe(event);
        }
        return;
      }
      closeToolMenus();
      clearPlacedSelection();
      if (handleTouchPointerDown(event)) return;
      if (shouldPointerSwipePages(event.pointerType)) {
        startSwipe(event);
        return;
      }

      if (tool !== "text") {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      // The new box is selected and ready to type in. Stopped here, or the
      // frame's tap-away below would let go of it in the same press -- which
      // left every new box unselected, its caret gone, and whatever was typed
      // next running the tool shortcuts instead.
      event.stopPropagation();
      createTextBlockAtEvent(event);
    },
    [
      clearPlacedSelection,
      closeToolMenus,
      createTextBlockAtEvent,
      enabled,
      handleTouchPointerDown,
      lockedRef,
      startSwipe,
      tool,
    ]
  );

  const handlePagePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (handleTouchPointerMove(event)) return;
      if (shouldPointerSwipePages(event.pointerType)) {
        moveSwipe(event);
      }
    },
    [handleTouchPointerMove, moveSwipe]
  );

  const handlePagePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") {
        const current = swipeRef.current;
        const direction = current
          ? getNotebookSwipeDirection({
              startX: current.startX,
              startY: current.startY,
              currentX: event.clientX,
              currentY: event.clientY,
            })
          : null;
        if (!direction) {
          noteIgnoredTouch(event);
        }
      }
      if (handleTouchPointerEnd(event, { allowTextTap: true })) return;
      if (shouldPointerSwipePages(event.pointerType)) {
        endSwipe(event, { allowTextTap: true });
      }
    },
    [endSwipe, handleTouchPointerEnd, noteIgnoredTouch, swipeRef]
  );

  const handlePagePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (handleTouchPointerEnd(event, { cancelled: true })) return;
      if (shouldPointerSwipePages(event.pointerType)) {
        endSwipe(event, { cancelled: true });
      }
    },
    [endSwipe, handleTouchPointerEnd]
  );

  return {
    handleFramePointerDown,
    handlePagePointerDown,
    handlePagePointerMove,
    handlePagePointerUp,
    handlePagePointerCancel,
  };
}
