"use client";

import { useCallback, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";
import type { NotebookPersistenceController } from "@/hooks/useNotebookPersistenceController";
import { setUnsavedWork } from "@/lib/app/app-build";
import { prepareNotebookExit } from "@/lib/workspace/notebook-navigation";
import type { NotebookSaveStatus } from "@/lib/workspace/notebook-page-state";

type UseNotebookExitGuardOptions = {
  pageState: NotebookPageStore;
  saveStatus: NotebookSaveStatus;
  persistence: Pick<
    NotebookPersistenceController,
    "saveCurrentPage" | "persistCurrentPageDraftSync" | "queueCurrentPageSaveForExit"
  >;
  isInkInteracting: () => boolean;
  /** Drops any batched editor UI commit when the editor unmounts. */
  cancelInkUiCommit: () => void;
  showError: (message: string) => void;
};

/**
 * Nothing written in the notebook is lost on the way out.
 *
 * Hiding the tab, closing it, or following the back link all leave a local
 * recovery draft and start a final save first; the browser is asked to
 * confirm a close while work is unsaved, and an app update waits until the
 * page has saved.
 */
export function useNotebookExitGuard({
  pageState,
  saveStatus,
  persistence,
  isInkInteracting,
  cancelInkUiCommit,
  showError,
}: UseNotebookExitGuardOptions) {
  const { saveCurrentPage, persistCurrentPageDraftSync, queueCurrentPageSaveForExit } =
    persistence;

  useEffect(() => () => cancelInkUiCommit(), [cancelInkUiCommit]);

  useEffect(() => {
    const saveBeforeExit = (event?: PageTransitionEvent | BeforeUnloadEvent) => {
      const { saveStatus: current } = pageState.read();
      if (current !== "unsaved" && current !== "failed") return;
      persistCurrentPageDraftSync();
      void saveCurrentPage({ flush: true });
      if (event?.type === "beforeunload") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveBeforeExit();
    };

    window.addEventListener("pagehide", saveBeforeExit);
    window.addEventListener("beforeunload", saveBeforeExit);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", saveBeforeExit);
      window.removeEventListener("beforeunload", saveBeforeExit);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pageState, persistCurrentPageDraftSync, saveCurrentPage]);

  // An app update waits until this page has saved (lib/app/app-build.ts).
  useEffect(() => {
    setUnsavedWork("notebook", saveStatus !== "saved");
    return () => setUnsavedWork("notebook", false);
  }, [saveStatus]);

  /** The back link: held back only when the page could not be secured first. */
  const handleExitNotebook = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      const exitDecision = prepareNotebookExit({
        saveStatus: pageState.read().saveStatus,
        persistDraftSync: persistCurrentPageDraftSync,
        queueSaveForExit: queueCurrentPageSaveForExit,
      });
      if (exitDecision.shouldPreventNavigation) {
        event.preventDefault();
        showError("Could not autosave before leaving the notebook.");
      }
    },
    [pageState, persistCurrentPageDraftSync, queueCurrentPageSaveForExit, showError]
  );

  /** The save indicator's retry, which never runs under a stroke in flight. */
  const handleRetryPageSave = useCallback(() => {
    if (pageState.read().saveStatus !== "failed" || isInkInteracting()) return;
    pageState.setSaveStatus("unsaved");
    void saveCurrentPage({ flush: true });
  }, [isInkInteracting, pageState, saveCurrentPage]);

  return { handleExitNotebook, handleRetryPageSave };
}
