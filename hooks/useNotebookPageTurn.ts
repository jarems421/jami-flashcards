"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { NotebookInkController } from "@/hooks/useNotebookInkController";
import type { NotebookLoader } from "@/hooks/useNotebookLoader";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";
import type { NotebookPageTrack } from "@/hooks/useNotebookPageTrack";
import type { NotebookPersistenceController } from "@/hooks/useNotebookPersistenceController";
import type { NotebookViewportController } from "@/hooks/useNotebookViewportController";
import type { NotebookPageCreationState } from "@/hooks/useNotebookWorkspaceState";
import { prefersReducedMotion } from "@/lib/ui/reduced-motion";
import {
  getNotebookPageIndexAfterSwipe,
  getNotebookSwipeSettleDuration,
  type NotebookPageDragIntent,
} from "@/lib/workspace/notebook-inking";
import { withNotebookPage } from "@/lib/workspace/notebook-navigation";
import type { Notebook, NotebookFile, NotebookPage } from "@/lib/workspace/notebooks";
import { createNotebookPage } from "@/services/study/notebooks";

/** The most blank pages one request adds. */
const MAX_APPENDED_PAGES = 20;

/** A pointer that may yet become a page swipe, sampled as it moves. */
export type NotebookPageSwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  lastX: number;
  lastY: number;
  samples: Array<{ x: number; time: number }>;
  axis: "horizontal" | "vertical" | null;
  intent: NotebookPageDragIntent | null;
  completed: boolean;
};

/**
 * What every part of the editor checks before acting on the page: whether a
 * page turn has it locked, and the pointer that may be starting a swipe.
 *
 * Created before the controllers that consult it -- the viewport and text
 * boxes refuse new gestures while a turn settles -- and shared with the page
 * turn and the swipe gesture, which set it.
 */
export function useNotebookNavigationLock() {
  const lockedRef = useRef(false);
  const swipeRef = useRef<NotebookPageSwipeState | null>(null);
  const isLocked = useCallback(() => lockedRef.current, []);
  return { lockedRef, swipeRef, isLocked };
}

export type NotebookNavigationLock = ReturnType<typeof useNotebookNavigationLock>;

type PageBackground = { file: NotebookFile | null; url: string | undefined };

type UseNotebookPageTurnOptions = {
  userId: string;
  notebook: Notebook | null;
  pages: NotebookPage[];
  selectedPageIndex: number;
  pageState: NotebookPageStore;
  lock: NotebookNavigationLock;
  loader: Pick<
    NotebookLoader,
    "hydratePageInk" | "setSelectedPageId" | "setPages" | "resolvedImageFileIds"
  >;
  persistence: Pick<NotebookPersistenceController, "saveCurrentPage" | "hasSaveInFlight">;
  ink: Pick<NotebookInkController, "inkReadyRef" | "isInteracting">;
  track: NotebookPageTrack;
  viewport: Pick<NotebookViewportController, "pageTrackTravelDistance" | "cancelActivePinch"> & {
    frameSize: { width: number; height: number };
  };
  creation: NotebookPageCreationState;
  /** The open page's background, and how to find any page's. */
  background: {
    active: PageBackground;
    resolve: (page: NotebookPage | null | undefined) => PageBackground;
  };
  onError: (error: unknown, fallback: string) => void;
};

/**
 * Turns pages: the settle animation, the hand-off to the incoming page, and
 * the new page made by pulling past the last one.
 *
 * A turn locks navigation and takes a token; anything that starts later
 * takes a newer one, so a turn whose token is stale stops wherever it is.
 * The track stays shifted until the incoming page has hydrated, painted its
 * ink and loaded its background, and only then snaps home -- which is what
 * keeps a turn from flashing an empty sheet.
 */
export function useNotebookPageTurn({
  userId,
  notebook,
  pages,
  selectedPageIndex,
  pageState,
  lock,
  loader,
  persistence,
  ink,
  track,
  viewport,
  creation,
  background,
  onError,
}: UseNotebookPageTurnOptions) {
  const { lockedRef, swipeRef } = lock;
  const { hydratePageInk, setSelectedPageId, setPages, resolvedImageFileIds } = loader;
  const { saveCurrentPage, hasSaveInFlight } = persistence;
  const { inkReadyRef, isInteracting: isInkInteracting } = ink;
  const {
    offsetRef: trackOffsetRef,
    motionRef,
    updateSwipeMotion,
    setPreviewVisibility,
    jumpTo,
    animateTo,
    resolveTransition,
    cancelQueuedOffset,
  } = track;
  const { pageTrackTravelDistance, cancelActivePinch, frameSize } = viewport;
  const {
    createPageActive,
    setCreatePageActive,
    setCreatePageProgress,
    setCreatingPage,
    setCreatePageBounce,
  } = creation;
  const { file: activeFile, url: activeFileUrl } = background.active;
  const resolvePageBackground = background.resolve;
  const openPageId = pages[selectedPageIndex]?.id;

  const tokenRef = useRef(0);
  const creationInFlightRef = useRef(false);
  const createPageActiveRef = useRef(false);
  const handoffFrameRef = useRef<number | null>(null);
  const backgroundReadyRef = useRef(true);
  const maybeFinishHandoffRef = useRef<() => void>(() => undefined);

  /** Asks, a frame from now, whether a waiting hand-off can finish. */
  const requestHandoffCheck = useCallback(() => {
    window.requestAnimationFrame(() => maybeFinishHandoffRef.current());
  }, []);

  useEffect(() => {
    createPageActiveRef.current = createPageActive;
  }, [createPageActive]);

  const markBackgroundSettled = useCallback(() => {
    backgroundReadyRef.current = true;
    requestHandoffCheck();
  }, [requestHandoffCheck]);

  const handleBackgroundRenderStateChange = useCallback(
    (status: "loading" | "ready" | "error") => {
      backgroundReadyRef.current = status !== "loading";
      if (status !== "loading") requestHandoffCheck();
    },
    [requestHandoffCheck]
  );

  // Whether the open page's background has finished arriving. A page with no
  // file, or one whose picture could not be found, has nothing to wait for.
  useEffect(() => {
    if (!activeFile) {
      backgroundReadyRef.current = true;
      requestHandoffCheck();
      return;
    }
    if (activeFile.fileType.startsWith("image/")) {
      const terminalWithoutImage = Boolean(resolvedImageFileIds[activeFile.id]) && !activeFileUrl;
      backgroundReadyRef.current = terminalWithoutImage;
      if (terminalWithoutImage) requestHandoffCheck();
      return;
    }
    const waitingForPdf =
      activeFile.fileType === "application/pdf" && Boolean(activeFile.storagePath);
    backgroundReadyRef.current = !waitingForPdf;
    if (!waitingForPdf) requestHandoffCheck();
  }, [activeFile, activeFileUrl, openPageId, requestHandoffCheck, resolvedImageFileIds]);

  /** Saves the page being left, unless a stroke is still on it. False blocks the turn. */
  const prepareForNavigation = useCallback(async () => {
    if (isInkInteracting()) return false;
    const { saveStatus } = pageState.read();
    const savePending =
      saveStatus === "saving" || saveStatus === "unsaved" || saveStatus === "failed";
    if (hasSaveInFlight() || savePending) return saveCurrentPage({ flush: true });
    return true;
  }, [hasSaveInFlight, isInkInteracting, pageState, saveCurrentPage]);

  const selectPageById = useCallback(
    async (pageId: string) => {
      if (pageId === pageState.read().selectedPage?.id) return true;
      if (lockedRef.current) return false;
      const ready = await prepareForNavigation();
      if (!ready) return false;
      // Ink first: selecting a page before its ink arrives would mount an
      // empty canvas that autosave could write over the saved drawing.
      if (!(await hydratePageInk(pageId))) return false;
      setSelectedPageId(pageId);
      return true;
    },
    [hydratePageInk, lockedRef, pageState, prepareForNavigation, setSelectedPageId]
  );

  /** Puts the pull-to-create affordance and the swipe candidate away. */
  const resetCreateAffordance = useCallback(() => {
    swipeRef.current = null;
    createPageActiveRef.current = false;
    setCreatePageActive(false);
    setCreatePageProgress(0);
    if (!creationInFlightRef.current) {
      setCreatingPage(false);
    }
    setCreatePageBounce(false);
  }, [setCreatePageActive, setCreatePageBounce, setCreatePageProgress, setCreatingPage, swipeRef]);

  /** Snaps the track home and ends any turn, invalidating it unless told not to. */
  const clearMotion = useCallback(
    (options: { invalidate?: boolean } = {}) => {
      if (options.invalidate !== false) {
        tokenRef.current += 1;
      }
      cancelQueuedOffset();
      if (handoffFrameRef.current !== null) {
        window.cancelAnimationFrame(handoffFrameRef.current);
        handoffFrameRef.current = null;
      }
      resolveTransition();
      jumpTo(0);
      setPreviewVisibility(false);
      updateSwipeMotion(null);
      lockedRef.current = creationInFlightRef.current;
      resetCreateAffordance();
    },
    [
      cancelQueuedOffset,
      jumpTo,
      lockedRef,
      resetCreateAffordance,
      resolveTransition,
      setPreviewVisibility,
      updateSwipeMotion,
    ]
  );

  // A resize mid-turn: a hand-off keeps its place a page away at the new
  // width, and anything else in motion is put back.
  useEffect(() => {
    cancelActivePinch({ clearPointers: true, commitPan: true });
    const motion = motionRef.current;
    if (motion?.phase === "handoff" && motion.direction) {
      const targetOffset =
        motion.direction === "next" ? -pageTrackTravelDistance : pageTrackTravelDistance;
      jumpTo(targetOffset);
      updateSwipeMotion({ ...motion, targetOffset });
      return;
    }
    if (!swipeRef.current && !motion && trackOffsetRef.current === 0) {
      return;
    }
    clearMotion();
  }, [
    cancelActivePinch,
    clearMotion,
    frameSize.height,
    frameSize.width,
    jumpTo,
    motionRef,
    pageTrackTravelDistance,
    swipeRef,
    trackOffsetRef,
    updateSwipeMotion,
  ]);

  const maybeFinishHandoff = useCallback(() => {
    const isReady = () => {
      const motion = motionRef.current;
      const { selectedPage, hydratedPageId } = pageState.read();
      return (
        motion?.phase === "handoff" &&
        Boolean(motion.targetPage) &&
        selectedPage?.id === motion.targetPage?.id &&
        hydratedPageId === motion.targetPage?.id &&
        inkReadyRef.current &&
        backgroundReadyRef.current
      );
    };
    if (!isReady() || handoffFrameRef.current !== null) return;
    // Checked again a frame later: the incoming page must still be the one
    // being handed to, and still ready, when the track snaps home.
    handoffFrameRef.current = window.requestAnimationFrame(() => {
      handoffFrameRef.current = null;
      if (!isReady()) return;
      jumpTo(0);
      setPreviewVisibility(false);
      updateSwipeMotion(null);
      lockedRef.current = false;
      createPageActiveRef.current = false;
      setCreatePageActive(false);
      setCreatePageProgress(0);
      setCreatingPage(false);
    });
  }, [
    inkReadyRef,
    jumpTo,
    lockedRef,
    motionRef,
    pageState,
    setCreatePageActive,
    setCreatePageProgress,
    setCreatingPage,
    setPreviewVisibility,
    updateSwipeMotion,
  ]);
  // Readers call it from a later animation frame, so the committed handler is
  // always in place by then.
  useLayoutEffect(() => {
    maybeFinishHandoffRef.current = maybeFinishHandoff;
  }, [maybeFinishHandoff]);

  const beginHandoff = useCallback(
    (
      targetPage: NotebookPage,
      direction: "next" | "previous",
      kind: "page" | "create",
      token: number
    ) => {
      const targetBackground = resolvePageBackground(targetPage).file;
      inkReadyRef.current = false;
      backgroundReadyRef.current = !(
        targetBackground?.fileType.startsWith("image/") ||
        (targetBackground?.fileType === "application/pdf" && targetBackground.storagePath)
      );
      updateSwipeMotion({
        phase: "handoff",
        kind,
        direction,
        targetPage,
        targetOffset: trackOffsetRef.current,
        durationMs: 0,
      });
      window.requestAnimationFrame(() => {
        if (tokenRef.current !== token) return;
        setSelectedPageId(targetPage.id);
      });
    },
    [inkReadyRef, resolvePageBackground, setSelectedPageId, trackOffsetRef, updateSwipeMotion]
  );

  const returnToSource = useCallback(
    async (velocityX: number, token: number) => {
      const durationMs = getNotebookSwipeSettleDuration({
        currentOffset: trackOffsetRef.current,
        targetOffset: 0,
        travelDistance: pageTrackTravelDistance,
        velocityX,
        reducedMotion: prefersReducedMotion(),
      });
      await animateTo({
        phase: "returning",
        kind: "cancel",
        direction: null,
        targetPage: null,
        targetOffset: 0,
        durationMs,
      });
      if (tokenRef.current !== token) return;
      clearMotion({ invalidate: false });
    },
    [animateTo, clearMotion, pageTrackTravelDistance, trackOffsetRef]
  );

  /** Gives up whatever the track was doing and settles it back on the open page. */
  const settleBack = useCallback(
    (velocityX: number) => {
      lockedRef.current = true;
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      return returnToSource(velocityX, token);
    },
    [lockedRef, returnToSource]
  );

  const turnTo = useCallback(
    async (targetPage: NotebookPage, direction: "next" | "previous", velocityX: number) => {
      if (lockedRef.current || pageTrackTravelDistance <= 0) {
        return false;
      }
      lockedRef.current = true;
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      const targetOffset = direction === "next" ? -pageTrackTravelDistance : pageTrackTravelDistance;
      const durationMs = getNotebookSwipeSettleDuration({
        currentOffset: trackOffsetRef.current,
        targetOffset,
        travelDistance: pageTrackTravelDistance,
        velocityX,
        reducedMotion: prefersReducedMotion(),
      });
      // Ink first, exactly as `selectPageById` does: opening a page before its
      // ink arrives would mount an empty canvas that autosave could later write
      // over the saved drawing. Neighbour prefetch usually makes this instant,
      // and it runs against the settle animation rather than after it.
      const readyPromise = Promise.all([
        prepareForNavigation(),
        hydratePageInk(targetPage.id),
      ]).then(([saved, hydrated]) => saved && hydrated);
      const settlePromise = animateTo({
        phase: "settling",
        kind: "page",
        direction,
        targetPage,
        targetOffset,
        durationMs,
      });
      let ready = false;
      try {
        [ready] = await Promise.all([readyPromise, settlePromise]);
      } catch (error) {
        console.error("Could not prepare the notebook page change.", error);
        onError(error, "Could not save this page before changing pages.");
        if (tokenRef.current === token) {
          await returnToSource(velocityX, token);
        }
        return false;
      }
      if (tokenRef.current !== token) return false;
      if (!ready) {
        await returnToSource(velocityX, token);
        return false;
      }
      beginHandoff(targetPage, direction, "page", token);
      return true;
    },
    [
      animateTo,
      beginHandoff,
      hydratePageInk,
      lockedRef,
      onError,
      pageTrackTravelDistance,
      prepareForNavigation,
      returnToSource,
      trackOffsetRef,
    ]
  );

  /** The previous or next page, by button or keyboard rather than by swipe. */
  const turnByOffset = useCallback(
    async (offset: -1 | 1) => {
      if (selectedPageIndex < 0 || lockedRef.current) return false;
      const direction = offset === 1 ? "next" : "previous";
      const nextIndex = getNotebookPageIndexAfterSwipe({
        currentIndex: selectedPageIndex,
        pageCount: pages.length,
        direction,
      });
      if (nextIndex === selectedPageIndex) return false;
      const targetPage = pages[nextIndex];
      if (!targetPage) return false;
      return turnTo(targetPage, direction, direction === "next" ? -2 : 2);
    },
    [lockedRef, pages, selectedPageIndex, turnTo]
  );

  const createPageAtEnd = useCallback(
    async (velocityX = -2) => {
      if (lockedRef.current || creationInFlightRef.current || pageTrackTravelDistance <= 0) {
        return false;
      }
      if (!userId || !notebook) {
        await settleBack(velocityX);
        return false;
      }
      const lastPage = pages[pages.length - 1];
      // A new page is on the notebook's own paper. Copying the page being left
      // gave a PDF notebook's added pages the PDF page's plain white, whatever
      // paper the student chose for the notebook.
      const pageColorValue = notebook.pageColor ?? "white";
      const pageStyleValue = notebook.pageStyle ?? "plain";
      const nextPageNumber = (lastPage?.pageNumber ?? pages.length) + 1;

      lockedRef.current = true;
      creationInFlightRef.current = true;
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      setCreatingPage(true);
      createPageActiveRef.current = true;
      setCreatePageActive(true);
      setCreatePageProgress(1);
      setCreatePageBounce(true);
      window.setTimeout(() => setCreatePageBounce(false), 420);
      const targetOffset = -pageTrackTravelDistance;
      const durationMs = getNotebookSwipeSettleDuration({
        currentOffset: trackOffsetRef.current,
        targetOffset,
        travelDistance: pageTrackTravelDistance,
        velocityX,
        reducedMotion: prefersReducedMotion(),
      });
      const createPromise = (async () => {
        const ready = await prepareForNavigation();
        if (!ready) return null;
        return createNotebookPage(userId, {
          notebookId: notebook.id,
          folderId: notebook.folderId,
          pageNumber: nextPageNumber,
          pageType: "blank",
          pageColor: pageColorValue,
          pageStyle: pageStyleValue,
          status: "blank",
        });
      })();
      const settlePromise = animateTo({
        phase: "settling",
        kind: "create",
        direction: "next",
        targetPage: null,
        targetOffset,
        durationMs,
      });
      try {
        const [newPage] = await Promise.all([createPromise, settlePromise]);
        creationInFlightRef.current = false;
        if (tokenRef.current !== token) {
          // Something else took over mid-turn; keep the page, skip the hand-off.
          if (newPage) setPages((current) => withNotebookPage(current, newPage));
          lockedRef.current = false;
          setCreatingPage(false);
          return Boolean(newPage);
        }
        if (!newPage) {
          await returnToSource(velocityX, token);
          setCreatingPage(false);
          return false;
        }
        setPages((current) => withNotebookPage(current, newPage));
        beginHandoff(newPage, "next", "create", token);
        return true;
      } catch (error) {
        creationInFlightRef.current = false;
        console.error("Could not add a notebook page.", error);
        onError(error, "Could not add a new page.");
        if (tokenRef.current === token) {
          await returnToSource(velocityX, token);
        } else {
          lockedRef.current = false;
        }
        setCreatingPage(false);
        createPageActiveRef.current = false;
        setCreatePageActive(false);
        setCreatePageProgress(0);
        return false;
      }
    },
    [
      animateTo,
      beginHandoff,
      lockedRef,
      notebook,
      onError,
      pageTrackTravelDistance,
      pages,
      prepareForNavigation,
      returnToSource,
      setCreatePageActive,
      setCreatePageBounce,
      setCreatePageProgress,
      setCreatingPage,
      setPages,
      settleBack,
      trackOffsetRef,
      userId,
    ]
  );

  /**
   * Blank pages at the end, without leaving the page being written on: what
   * Tutor adds when a student asks it for pages.
   *
   * It takes the same in-flight guard as a swipe past the last page, so the
   * two cannot both number "the next page" at once. Pages are made one at a
   * time, in order, on the notebook's own paper. Returns how many were made.
   */
  const appendBlankPages = useCallback(
    async (count: number) => {
      if (!userId || !notebook || lockedRef.current || creationInFlightRef.current) return 0;
      const wanted = Math.max(1, Math.min(MAX_APPENDED_PAGES, Math.round(count)));
      const lastPage = pages[pages.length - 1];
      const firstNumber = (lastPage?.pageNumber ?? pages.length) + 1;
      creationInFlightRef.current = true;
      const created: NotebookPage[] = [];
      try {
        for (let index = 0; index < wanted; index += 1) {
          created.push(
            await createNotebookPage(userId, {
              notebookId: notebook.id,
              folderId: notebook.folderId,
              pageNumber: firstNumber + index,
              pageType: "blank",
              pageColor: notebook.pageColor ?? "white",
              pageStyle: notebook.pageStyle ?? "plain",
              status: "blank",
            })
          );
        }
      } catch (error) {
        console.error("Could not add notebook pages.", error);
        onError(error, created.length > 0 ? "Not every page could be added." : "Could not add pages.");
      } finally {
        creationInFlightRef.current = false;
      }
      if (created.length > 0) {
        setPages((current) => created.reduce((next, page) => withNotebookPage(next, page), current));
      }
      return created.length;
    },
    [lockedRef, notebook, onError, pages, setPages, userId]
  );

  /**
   * A second finger landed mid-swipe. Unwind the page track so the pinch
   * starts from a settled sheet instead of a half-committed swipe.
   */
  const cancelSwipeForPinch = useCallback(() => {
    if (!swipeRef.current) return;
    cancelQueuedOffset();
    jumpTo(0);
    setPreviewVisibility(false);
    createPageActiveRef.current = false;
    setCreatePageActive(false);
    setCreatePageProgress(0);
    swipeRef.current = null;
  }, [cancelQueuedOffset, jumpTo, setCreatePageActive, setCreatePageProgress, setPreviewVisibility, swipeRef]);

  /** The app lost focus or the page was hidden: abandon any turn in motion. */
  const interrupt = useCallback(() => {
    if (swipeRef.current || motionRef.current || trackOffsetRef.current !== 0) {
      clearMotion();
    } else {
      resetCreateAffordance();
    }
  }, [clearMotion, motionRef, resetCreateAffordance, swipeRef, trackOffsetRef]);

  return {
    createPageActiveRef,
    prepareForNavigation,
    selectPageById,
    turnTo,
    turnByOffset,
    settleBack,
    createPageAtEnd,
    appendBlankPages,
    cancelSwipeForPinch,
    interrupt,
    requestHandoffCheck,
    markBackgroundSettled,
    handleBackgroundRenderStateChange,
  };
}

export type NotebookPageTurn = ReturnType<typeof useNotebookPageTurn>;
