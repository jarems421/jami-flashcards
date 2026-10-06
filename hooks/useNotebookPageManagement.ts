"use client";

import { useCallback, useState } from "react";
import type { NotebookLoader } from "@/hooks/useNotebookLoader";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";
import type { NotebookPersistenceController } from "@/hooks/useNotebookPersistenceController";
import type { Notebook, NotebookPage } from "@/lib/workspace/notebooks";
import { appendUploadedFileToNotebook } from "@/services/study/notebook-import";
import { deleteNotebookPage } from "@/services/study/notebooks";

/** What the editor's confirmation dialog is asking about. */
export type NotebookConfirmRequest =
  | { kind: "clear-page" }
  | { kind: "delete-page"; page: NotebookPage };

type UseNotebookPageManagementOptions = {
  userId: string | undefined;
  notebook: Notebook | null;
  pages: NotebookPage[];
  pageState: NotebookPageStore;
  loader: Pick<
    NotebookLoader,
    "setPages" | "setFiles" | "setNotebook" | "selectedPageId" | "setSelectedPageId" | "hydratePageInk"
  >;
  saveCurrentPage: NotebookPersistenceController["saveCurrentPage"];
  /** Off on a phone that is only viewing. */
  editingEnabled: boolean;
  /** Wipes the open page's ink. Text boxes stay. */
  clearPageInk: () => void;
  resetTextBlockInteraction: () => void;
  feedback: {
    success: (message: string) => void;
    showError: (message: string) => void;
    showThrownError: (error: unknown, fallback: string) => void;
    clear: () => void;
  };
};

/**
 * Adding, deleting and clearing whole pages, and the confirmation the
 * destructive two ask for first.
 */
export function useNotebookPageManagement({
  userId,
  notebook,
  pages,
  pageState,
  loader,
  saveCurrentPage,
  editingEnabled,
  clearPageInk,
  resetTextBlockInteraction,
  feedback,
}: UseNotebookPageManagementOptions) {
  const { setPages, setFiles, setNotebook, selectedPageId, setSelectedPageId, hydratePageInk } =
    loader;
  const { success, showError, showThrownError, clear: clearFeedback } = feedback;

  const [confirmRequest, setConfirmRequest] = useState<NotebookConfirmRequest | null>(null);
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [addPagesOpen, setAddPagesOpen] = useState(false);
  const [addPagesFile, setAddPagesFile] = useState<File | null>(null);
  const [addPagesProgress, setAddPagesProgress] = useState<number | null>(null);
  const [addingPages, setAddingPages] = useState(false);

  const deletePage = useCallback(
    async (page: NotebookPage) => {
      if (!userId || !notebook || !editingEnabled) return;
      if (pages.length <= 1) {
        showError("A notebook needs at least one page.");
        return;
      }

      const { saveStatus } = pageState.read();
      if (saveStatus === "unsaved" || saveStatus === "failed") {
        const saved = await saveCurrentPage({ flush: true });
        if (!saved) {
          showError("Could not autosave before deleting the page.");
          return;
        }
      }

      setDeletingPageId(page.id);
      clearFeedback();
      try {
        const deletedIndex = pages.findIndex((candidate) => candidate.id === page.id);
        const nextPages = await deleteNotebookPage(userId, notebook.id, page.id);
        const openPageId = pageState.read().selectedPage?.id;
        const nextSelectedPage =
          page.id === openPageId
            ? nextPages[Math.min(Math.max(deletedIndex, 0), nextPages.length - 1)] ?? nextPages[0]
            : nextPages.find((candidate) => candidate.id === openPageId) ?? nextPages[0];

        pageState.resetHydration();
        setPages(nextPages);
        // Ink first, as everywhere else: the page taking this one's place must
        // not open on an empty canvas that autosave could write over its drawing.
        if (nextSelectedPage) await hydratePageInk(nextSelectedPage.id);
        setSelectedPageId(nextSelectedPage?.id ?? null);
        resetTextBlockInteraction();
        success(`Page ${page.pageNumber} deleted.`);
      } catch (error) {
        showThrownError(error, "Could not delete this page.");
      } finally {
        setDeletingPageId(null);
      }
    },
    [
      clearFeedback,
      editingEnabled,
      hydratePageInk,
      notebook,
      pageState,
      pages,
      resetTextBlockInteraction,
      saveCurrentPage,
      setPages,
      setSelectedPageId,
      showError,
      showThrownError,
      success,
      userId,
    ]
  );

  const requestDeletePage = useCallback((page: NotebookPage) => {
    setConfirmRequest({ kind: "delete-page", page });
  }, []);

  const requestClearPage = useCallback(() => {
    setConfirmRequest({ kind: "clear-page" });
  }, []);

  const dismissRequest = useCallback(() => setConfirmRequest(null), []);

  const confirmPendingRequest = useCallback(() => {
    if (!confirmRequest) return;
    setConfirmRequest(null);
    if (confirmRequest.kind === "delete-page") {
      void deletePage(confirmRequest.page);
      return;
    }
    clearPageInk();
  }, [clearPageInk, confirmRequest, deletePage]);

  const openAddPages = useCallback(() => setAddPagesOpen(true), []);

  const closeAddPages = useCallback(() => {
    if (addingPages) return;
    setAddPagesOpen(false);
    setAddPagesFile(null);
    setAddPagesProgress(null);
  }, [addingPages]);

  const addPagesFromFile = useCallback(async () => {
    if (!userId || !notebook || !addPagesFile) return;
    setAddingPages(true);
    setAddPagesProgress(null);
    clearFeedback();
    try {
      const appended = await appendUploadedFileToNotebook({
        userId,
        notebook,
        existingPageCount: pages.length,
        file: addPagesFile,
        onProgress: setAddPagesProgress,
      });
      setPages([...pages, ...appended.pages].sort((a, b) => a.pageNumber - b.pageNumber));
      setFiles((current) => [appended.file, ...current]);
      if (!notebook.uploadedFileId) {
        setNotebook((current) =>
          current
            ? { ...current, uploadedFileId: appended.file.id, updatedAt: Date.now() }
            : current
        );
      }
      setSelectedPageId(appended.pages[0]?.id ?? selectedPageId);
      setAddPagesFile(null);
      setAddPagesProgress(null);
      setAddPagesOpen(false);
      const count = appended.pages.length;
      success(`${count} ${count === 1 ? "page" : "pages"} added to ${notebook.title}`);
    } catch (error) {
      showThrownError(error, "Could not add these pages to the notebook.");
    } finally {
      setAddingPages(false);
      setAddPagesProgress(null);
    }
  }, [
    addPagesFile,
    clearFeedback,
    notebook,
    pages,
    selectedPageId,
    setFiles,
    setNotebook,
    setPages,
    setSelectedPageId,
    showThrownError,
    success,
    userId,
  ]);

  return {
    confirmRequest,
    deletingPageId,
    requestDeletePage,
    requestClearPage,
    dismissRequest,
    confirmPendingRequest,
    openAddPages,
    /** Props for NotebookAddPagesDialog. */
    addPagesDialog: {
      open: addPagesOpen,
      file: addPagesFile,
      adding: addingPages,
      progress: addPagesProgress,
      onFileChange: setAddPagesFile,
      onCancel: closeAddPages,
      onConfirm: () => void addPagesFromFile(),
    },
  };
}
