"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";
import type { Feedback } from "@/lib/app/feedback";
import {
  createNotebookPageDraft,
  deleteNotebookPageDraft,
  getNotebookDraftDecision,
  readNotebookPageDraft,
  writeNotebookPageDraft,
  type NotebookPageDraft,
} from "@/lib/workspace/notebook-drafts";
import { getNotebookPageIdFromSearch } from "@/lib/workspace/notebook-navigation";
import { applyNotebookDraftToPage } from "@/lib/workspace/notebook-page-content";
import type { Notebook, NotebookFile, NotebookPage } from "@/lib/workspace/notebooks";
import { getNotebookFileDownloadUrl } from "@/services/study/notebook-files";
import {
  getNotebookById,
  getNotebookFiles,
  getNotebookPages,
  getNotebookPageWithInk,
} from "@/services/study/notebooks";
import { pageHasUnloadedInk } from "@/lib/workspace/notebook-page-ink-split";

export type NotebookDraftConflict = {
  draft: NotebookPageDraft;
  pageId: string;
};

/** A draft recovered during load, waiting for its page to hydrate. */
export type RecoveredNotebookDraft = {
  pageId: string;
  localRevision: number;
};

type UseNotebookLoaderOptions = {
  userId: string | undefined;
  notebookId: string | undefined;
  pageState: NotebookPageStore;
  onFeedback: (feedback: Feedback | null) => void;
  /** Clear editor-side state before a different notebook streams in. */
  onBeforeLoad: () => void;
  /** Remount the ink editor after a draft is rebased onto the page. */
  onDraftRestored: () => void;
};

export type NotebookLoader = {
  notebook: Notebook | null;
  setNotebook: Dispatch<SetStateAction<Notebook | null>>;
  pages: NotebookPage[];
  setPages: Dispatch<SetStateAction<NotebookPage[]>>;
  /**
   * Loads a page's ink before it is opened for editing. False means the ink
   * could not be fetched and the page must not be shown as an empty canvas.
   */
  hydratePageInk: (pageId: string) => Promise<boolean>;
  files: NotebookFile[];
  setFiles: Dispatch<SetStateAction<NotebookFile[]>>;
  /** Download URLs for image backgrounds, keyed by file id. */
  fileUrls: Record<string, string>;
  /** Image files whose URL lookup has finished, successfully or not. */
  resolvedImageFileIds: Record<string, true>;
  selectedPageId: string | null;
  setSelectedPageId: Dispatch<SetStateAction<string | null>>;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  draftConflict: NotebookDraftConflict | null;
  /**
   * Consumed by page hydration: a draft restored during load still needs its
   * local revision applied once the page's content reaches the editor.
   */
  takeRecoveredDraft: (pageId: string) => RecoveredNotebookDraft | null;
  reload: () => Promise<void>;
  restoreLocalDraft: () => void;
  keepSavedVersion: () => void;
};

/**
 * Loads a notebook and reconciles it with any local recovery draft.
 *
 * Draft reconciliation belongs here rather than in the persistence controller:
 * the decision to restore, conflict, or discard can only be made against the
 * page as it arrives from the server, which is this hook's job.
 */
export function useNotebookLoader({
  userId,
  notebookId,
  pageState,
  onFeedback,
  onBeforeLoad,
  onDraftRestored,
}: UseNotebookLoaderOptions): NotebookLoader {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [pages, setPages] = useState<NotebookPage[]>([]);
  // Read through a ref so page hydration stays referentially stable across
  // renders, matching how the other notebook handlers avoid re-subscribing
  // pointer work on every state change.
  const pagesRef = useRef<NotebookPage[]>([]);
  pagesRef.current = pages;
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [resolvedImageFileIds, setResolvedImageFileIds] = useState<
    Record<string, true>
  >({});
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftConflict, setDraftConflict] =
    useState<NotebookDraftConflict | null>(null);
  const recoveredDraftRef = useRef<RecoveredNotebookDraft | null>(null);

  const latestRef = useRef({ onFeedback, onBeforeLoad, onDraftRestored });
  useEffect(() => {
    latestRef.current = { onFeedback, onBeforeLoad, onDraftRestored };
  }, [onBeforeLoad, onDraftRestored, onFeedback]);

  const takeRecoveredDraft = useCallback((pageId: string) => {
    const recovered = recoveredDraftRef.current;
    if (recovered?.pageId !== pageId) return null;
    recoveredDraftRef.current = null;
    return recovered;
  }, []);

  const reload = useCallback(async () => {
    if (!userId || !notebookId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    latestRef.current.onBeforeLoad();
    pageState.resetHydration();
    pageState.setContentRevision(0);
    recoveredDraftRef.current = null;
    setDraftConflict(null);

    try {
      const nextNotebook = await getNotebookById(userId, notebookId);
      let nextPages: NotebookPage[] = [];
      let nextFiles: NotebookFile[] = [];

      if (nextNotebook) {
        const [pagesResult, filesResult] = await Promise.allSettled([
          getNotebookPages(userId, notebookId),
          getNotebookFiles(userId, notebookId),
        ]);

        if (pagesResult.status === "fulfilled") nextPages = pagesResult.value;
        if (filesResult.status === "fulfilled") nextFiles = filesResult.value;
        if (
          pagesResult.status === "rejected" ||
          filesResult.status === "rejected"
        ) {
          console.warn("Some notebook sections could not load.", {
            pagesError:
              pagesResult.status === "rejected" ? pagesResult.reason : null,
            filesError:
              filesResult.status === "rejected" ? filesResult.reason : null,
          });
          latestRef.current.onFeedback({
            type: "error",
            message:
              "This notebook opened, but pages or file details are still syncing. Refresh in a moment if something looks missing.",
          });
        }
      }

      const requestedPageId =
        typeof window === "undefined"
          ? null
          : getNotebookPageIdFromSearch(window.location.search);
      const nextSelectedPageId =
        nextPages.find((page) => page.id === requestedPageId)?.id ??
        nextPages[0]?.id ??
        null;
      // Pages arrive without ink once they are stored in the split shape, so
      // the page about to be edited needs its ink record before anything
      // compares against it. This must happen before the draft decision below,
      // which weighs a local draft against the saved page's content.
      const lightSelectedPage = nextPages.find(
        (page) => page.id === nextSelectedPageId
      );
      if (lightSelectedPage) {
        const hydrated = await getNotebookPageWithInk(userId, lightSelectedPage);
        if (hydrated !== lightSelectedPage) {
          nextPages = nextPages.map((page) =>
            page.id === hydrated.id ? hydrated : page
          );
        }
      }
      const nextSelectedPage = nextPages.find(
        (page) => page.id === nextSelectedPageId
      );

      if (nextSelectedPage && nextNotebook) {
        const draft = await readNotebookPageDraft({
          userId,
          notebookId: nextNotebook.id,
          pageId: nextSelectedPage.id,
        });
        if (draft) {
          const decision = getNotebookDraftDecision(draft, nextSelectedPage);
          if (decision === "restore") {
            nextPages = nextPages.map((page) =>
              page.id === nextSelectedPage.id
                ? applyNotebookDraftToPage(page, draft)
                : page
            );
            recoveredDraftRef.current = {
              pageId: nextSelectedPage.id,
              localRevision: Math.max(1, draft.localRevision),
            };
          } else if (decision === "conflict") {
            setDraftConflict({ draft, pageId: nextSelectedPage.id });
          } else {
            void deleteNotebookPageDraft({
              userId,
              notebookId: nextNotebook.id,
              pageId: nextSelectedPage.id,
            });
          }
        }
      }

      setNotebook(nextNotebook);
      setPages(nextPages);
      setFiles(nextFiles);
      setSelectedPageId(nextSelectedPageId);
    } catch (error) {
      console.error("Failed to load notebook content.", error);
      latestRef.current.onFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not load this notebook.",
      });
    } finally {
      setLoading(false);
    }
  }, [notebookId, pageState, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Image backgrounds need a download URL. `resolvedImageFileIds` records which
  // lookups have finished so a missing image reads as settled, not pending.
  useEffect(() => {
    if (files.length === 0) {
      setFileUrls({});
      setResolvedImageFileIds({});
      return;
    }

    let cancelled = false;
    const loadFileUrls = async () => {
      const entries = await Promise.all(
        files.map(async (file) => {
          if (!file.storagePath || !file.fileType.startsWith("image/")) {
            return [file.id, ""] as const;
          }
          try {
            return [
              file.id,
              await getNotebookFileDownloadUrl(file.storagePath),
            ] as const;
          } catch (error) {
            console.warn("Failed to resolve a notebook image preview.", {
              fileId: file.id,
              error,
            });
            return [file.id, ""] as const;
          }
        })
      );
      if (cancelled) return;
      setFileUrls(Object.fromEntries(entries.filter(([, url]) => Boolean(url))));
      setResolvedImageFileIds(
        Object.fromEntries(
          files
            .filter((file) => file.fileType.startsWith("image/"))
            .map((file) => [file.id, true] as const)
        )
      );
    };

    void loadFileUrls();
    return () => {
      cancelled = true;
    };
  }, [files]);

  const restoreLocalDraft = useCallback(() => {
    if (!draftConflict || !userId) return;
    const remotePage = pages.find((page) => page.id === draftConflict.pageId);
    if (!remotePage) return;

    // Rebase the draft onto the page that actually came back from the server,
    // so the next save is not rejected as stale.
    const rebasedDraft = createNotebookPageDraft({
      ...draftConflict.draft,
      baseContentRevision: remotePage.contentRevision,
      remoteUpdatedAt: remotePage.updatedAt,
      savedAt: Date.now(),
    });
    recoveredDraftRef.current = {
      pageId: remotePage.id,
      localRevision: Math.max(1, rebasedDraft.localRevision),
    };
    pageState.resetHydration();
    latestRef.current.onDraftRestored();
    setPages((current) =>
      current.map((page) =>
        page.id === remotePage.id
          ? applyNotebookDraftToPage(page, rebasedDraft)
          : page
      )
    );
    setDraftConflict(null);
    void writeNotebookPageDraft(rebasedDraft).catch((error) => {
      latestRef.current.onFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "This device could not update the recovery copy.",
      });
    });
  }, [draftConflict, pageState, pages, userId]);

  const keepSavedVersion = useCallback(() => {
    if (!draftConflict || !userId) return;
    setDraftConflict(null);
    void deleteNotebookPageDraft({
      userId,
      notebookId: draftConflict.draft.notebookId,
      pageId: draftConflict.pageId,
    });
    latestRef.current.onFeedback({
      type: "success",
      message: "Kept the latest synced version of this page.",
    });
  }, [draftConflict, userId]);

  /**
   * Ensures a page holds its full-fidelity ink before it is drawn on.
   *
   * Called when navigating to a page, because pages load without ink once they
   * are stored in the split shape. Resolves to true when the page is ready to
   * edit and false when its ink could not be fetched -- the caller must not
   * open a page for editing on a false, or an autosave would write an empty
   * canvas over saved work.
   */
  const hydratePageInk = useCallback(
    async (pageId: string): Promise<boolean> => {
      const target = pagesRef.current.find((page) => page.id === pageId);
      if (!target || !userId) return false;
      // A page with nothing to fetch is already ready, and asking for an ink
      // record that does not exist would be a read per blank page.
      if (!pageHasUnloadedInk(target)) return true;

      try {
        const hydrated = await getNotebookPageWithInk(userId, target);
        if (hydrated !== target) {
          setPages((current) =>
            current.map((page) => (page.id === hydrated.id ? hydrated : page))
          );
        }
        return true;
      } catch (error) {
        console.error("Failed to load this page's drawing.", error);
        latestRef.current.onFeedback({
          type: "error",
          message:
            "Jami could not load this page's drawing. Stay on this page and try again in a moment.",
        });
        return false;
      }
    },
    [setPages, userId]
  );

  // Swiping between pages commits inside an animation frame and cannot wait on
  // a fetch, so the neighbours of the open page are loaded in advance. A swipe
  // then finds their ink already in memory.
  useEffect(() => {
    const index = pages.findIndex((page) => page.id === selectedPageId);
    if (index < 0 || !userId) return;
    const ownerId = userId;

    let cancelled = false;
    const neighbours = [pages[index - 1], pages[index + 1]].filter(
      (page): page is NotebookPage => Boolean(page) && pageHasUnloadedInk(page)
    );

    void (async () => {
      for (const neighbour of neighbours) {
        if (cancelled) return;
        try {
          const hydrated = await getNotebookPageWithInk(ownerId, neighbour);
          if (cancelled || hydrated === neighbour) continue;
          setPages((current) =>
            current.map((page) => (page.id === hydrated.id ? hydrated : page))
          );
        } catch {
          // A prefetch is an optimisation. Failing silently is correct here:
          // navigating to the page runs hydratePageInk, which reports the
          // failure and refuses to open an empty canvas.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pages, selectedPageId, userId]);

  return {
    notebook,
    setNotebook,
    pages,
    setPages,
    hydratePageInk,
    files,
    setFiles,
    fileUrls,
    resolvedImageFileIds,
    selectedPageId,
    setSelectedPageId,
    loading,
    setLoading,
    draftConflict,
    takeRecoveredDraft,
    reload,
    restoreLocalDraft,
    keepSavedVersion,
  };
}
