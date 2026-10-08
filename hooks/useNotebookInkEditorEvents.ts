"use client";

import { useCallback, type RefObject } from "react";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";

/**
 * What the page does when its ink editor starts, fails to start, or a stroke
 * begins or ends.
 *
 * A stroke beginning clears the way for it -- menus, the pages drawer, any
 * selection, pending UI and save work -- and only what is actually open, since
 * a pen calls this as every stroke lands. A stroke ending schedules what it
 * held back.
 */
export function useNotebookInkEditorEvents(input: {
  pageState: NotebookPageStore;
  inkReadyRef: RefObject<boolean>;
  setInkReady: (ready: boolean) => void;
  requestHandoffCheck: () => void;
  showError: (message: string) => void;
  handleInkInteractionChange: (active: boolean) => void;
  closeDrawingToolMenus: () => void;
  pagesDrawerOpen: boolean;
  setPagesDrawerOpen: (open: boolean) => void;
  clearPlacedSelection: () => void;
  cancelInkUiSync: () => void;
  scheduleInkUiSync: () => void;
  cancelScheduledPersistence: () => void;
  schedulePendingWork: () => void;
}) {
  const {
    pageState,
    inkReadyRef,
    setInkReady,
    requestHandoffCheck,
    showError,
    handleInkInteractionChange,
    closeDrawingToolMenus,
    pagesDrawerOpen,
    setPagesDrawerOpen,
    clearPlacedSelection,
    cancelInkUiSync,
    scheduleInkUiSync,
    cancelScheduledPersistence,
    schedulePendingWork,
  } = input;

  const onReady = useCallback(() => {
    inkReadyRef.current = true;
    setInkReady(true);
    requestHandoffCheck();
  }, [inkReadyRef, requestHandoffCheck, setInkReady]);

  const onReadyError = useCallback(() => {
    inkReadyRef.current = true;
    showError("This page opened, but the ink editor could not start. Your saved writing is still visible.");
    requestHandoffCheck();
  }, [inkReadyRef, requestHandoffCheck, showError]);

  /** A stroke began or ended on the page. */
  const onInteractionChange = useCallback(
    (active: boolean) => {
      handleInkInteractionChange(active);
      if (active) {
        closeDrawingToolMenus();
        if (pagesDrawerOpen) setPagesDrawerOpen(false);
        clearPlacedSelection();
        cancelInkUiSync();
        cancelScheduledPersistence();
      } else {
        scheduleInkUiSync();
        if (pageState.read().saveStatus === "unsaved") {
          schedulePendingWork();
        }
      }
    },
    [
      cancelInkUiSync,
      cancelScheduledPersistence,
      clearPlacedSelection,
      closeDrawingToolMenus,
      handleInkInteractionChange,
      pageState,
      pagesDrawerOpen,
      scheduleInkUiSync,
      schedulePendingWork,
      setPagesDrawerOpen,
    ]
  );

  return { onReady, onReadyError, onInteractionChange };
}
