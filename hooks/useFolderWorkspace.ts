"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { featureFlags } from "@/lib/app/feature-flags";
import type { Topic } from "@/lib/material/topics";
import {
  FOLDER_ASSET_PAGE_SIZE,
  mergeNewestFirst,
} from "@/lib/workspace/folder-workspace";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { isFirebasePermissionDenied } from "@/services/firebase/errors";
import { getStudyFolderById } from "@/services/study/folders";
import {
  getNotebooksForFolderPage,
  updateNotebook,
  type NotebookFolderPageCursor,
} from "@/services/study/notebooks";
import { deletePracticePaper } from "@/services/study/practice-papers";
import { getActiveTopics } from "@/services/study/topics";

export type FolderLoadState = "loading" | "ready" | "not-found" | "unavailable";

type Feedback = {
  clear: () => void;
  success: (message: string) => void;
  showError: (message: string) => void;
  showThrownError: (error: unknown, fallback: string) => void;
};

/**
 * A study folder, its notebooks and the student's topics.
 *
 * The folder is what the page cannot open without; notebooks and topics are
 * sections of it, so either failing leaves the folder open and says so rather
 * than showing an empty section that is not really empty. Opening another
 * folder clears what the last one showed; reloading the same folder keeps it
 * on screen while the reload runs.
 */
export function useFolderWorkspace({
  uid,
  folderId,
  feedback,
}: {
  uid: string;
  folderId: string | undefined;
  feedback: Feedback;
}) {
  const { clear, success, showError, showThrownError } = feedback;
  const [folder, setFolder] = useState<StudyFolder | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadState, setLoadState] = useState<FolderLoadState>("loading");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookCursor, setNotebookCursor] = useState<NotebookFolderPageCursor | null>(null);
  const [notebooksAvailability, setNotebooksAvailability] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [retryingNotebooks, setRetryingNotebooks] = useState(false);
  const [loadingMoreNotebooks, setLoadingMoreNotebooks] = useState(false);
  const [notebookPendingDelete, setNotebookPendingDelete] = useState<Notebook | null>(null);
  const [deletingNotebookId, setDeletingNotebookId] = useState<string | null>(null);
  const loadedFolderIdRef = useRef<string | null>(null);

  const loadFolder = useCallback(async () => {
    if (!folderId || !featureFlags.enableFolders) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadState("loading");
    setNotebooksAvailability("loading");
    if (loadedFolderIdRef.current !== folderId) {
      setFolder(null);
      setNotebooks([]);
      setTopics([]);
      setNotebookCursor(null);
    }
    try {
      const [folderResult, notebooksResult, topicsResult] = await Promise.allSettled([
        getStudyFolderById(uid, folderId),
        getNotebooksForFolderPage(uid, folderId, { pageSize: FOLDER_ASSET_PAGE_SIZE }),
        getActiveTopics(uid),
      ]);

      if (folderResult.status === "rejected") {
        throw folderResult.reason;
      }

      const optionalErrors = [notebooksResult, topicsResult]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (optionalErrors.length > 0) {
        console.warn("Some folder sections could not load.", optionalErrors);
        showError(
          "This folder opened, but one section is still syncing. Refresh in a moment if something looks missing."
        );
      }

      const nextFolder = folderResult.value;
      loadedFolderIdRef.current = folderId;
      setFolder(nextFolder);
      setLoadState(nextFolder ? "ready" : "not-found");

      if (notebooksResult.status === "fulfilled") {
        setNotebooks(notebooksResult.value.items);
        setNotebookCursor(notebooksResult.value.nextCursor);
        setNotebooksAvailability("ready");
      } else {
        setNotebooksAvailability("unavailable");
      }

      if (topicsResult.status === "fulfilled") {
        setTopics(topicsResult.value);
      }
    } catch (error) {
      console.error(error);
      setLoadState("unavailable");
      showError(
        isFirebasePermissionDenied(error)
          ? "Could not open this folder yet. Refresh once the workspace has finished syncing."
          : "Could not load this folder. Try refreshing in a moment."
      );
    } finally {
      setLoading(false);
    }
  }, [folderId, showError, uid]);

  useEffect(() => {
    void loadFolder();
  }, [loadFolder]);

  const retryNotebooks = useCallback(async () => {
    if (!folderId) return;
    setRetryingNotebooks(true);
    try {
      const page = await getNotebooksForFolderPage(uid, folderId, {
        pageSize: FOLDER_ASSET_PAGE_SIZE,
      });
      setNotebooks(page.items);
      setNotebookCursor(page.nextCursor);
      setNotebooksAvailability("ready");
    } catch (error) {
      console.error("Failed to reload this folder's notebooks.", error);
      setNotebooksAvailability("unavailable");
      showThrownError(error, "Could not load this folder's notebooks.");
    } finally {
      setRetryingNotebooks(false);
    }
  }, [folderId, showThrownError, uid]);

  const loadMoreNotebooks = async () => {
    if (!folderId || !notebookCursor) return;
    setLoadingMoreNotebooks(true);
    try {
      const page = await getNotebooksForFolderPage(uid, folderId, {
        cursor: notebookCursor,
        pageSize: FOLDER_ASSET_PAGE_SIZE,
      });
      setNotebooks((current) =>
        mergeNewestFirst(current, page.items, (notebook) => notebook.updatedAt)
      );
      setNotebookCursor(page.nextCursor);
    } catch (error) {
      console.error("Failed to load more folder notebooks.", error);
      showError("Could not load more notebooks. Try again in a moment.");
    } finally {
      setLoadingMoreNotebooks(false);
    }
  };

  /** A practice paper is deleted for good; any other notebook is archived. */
  const deletePendingNotebook = async () => {
    const notebook = notebookPendingDelete;
    if (!notebook) return;
    setDeletingNotebookId(notebook.id);
    clear();
    try {
      if (notebook.type === "practice_paper") {
        await deletePracticePaper(uid, notebook.pastPaperId ?? notebook.id);
      } else {
        await updateNotebook(uid, notebook.id, { archived: true });
      }
      setNotebooks((current) => current.filter((item) => item.id !== notebook.id));
      setNotebookPendingDelete(null);
      success(`${notebook.title} deleted.`);
    } catch (error) {
      showThrownError(error, "Could not delete notebook.");
    } finally {
      setDeletingNotebookId(null);
    }
  };

  return {
    folder,
    setFolder,
    loading,
    loadState,
    reload: loadFolder,
    topics,
    setTopics,
    notebooks,
    setNotebooks,
    notebooksAvailability,
    retryingNotebooks,
    retryNotebooks,
    hasMoreNotebooks: Boolean(notebookCursor),
    loadingMoreNotebooks,
    loadMoreNotebooks,
    notebookPendingDelete,
    setNotebookPendingDelete,
    deletingNotebookId,
    deletePendingNotebook,
  };
}
