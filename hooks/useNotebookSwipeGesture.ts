"use client";

import { useCallback, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { NotebookNavigationLock, NotebookPageTurn } from "@/hooks/useNotebookPageTurn";
import type { NotebookPageTrack } from "@/hooks/useNotebookPageTrack";
import type { NotebookViewportController } from "@/hooks/useNotebookViewportController";
import type { NotebookPageCreationState } from "@/hooks/useNotebookWorkspaceState";
import { getNotebookSwipePreviewDirection } from "@/lib/workspace/notebook-carousel";
import {
  safelyReleasePointerCapture,
  safelySetPointerCapture,
} from "@/lib/workspace/notebook-interaction-lock";
import {
  getNotebookCreatePagePull,
  getNotebookPageDragIntent,
  getNotebookSwipeDirection,
  getNotebookSwipeDragOffset,
  getNotebookSwipeReleaseDecision,
  getNotebookSwipeVelocity,
  isNotebookViewportZoomedIn,
  shouldCreateNotebookPageOnRelease,
  shouldPointerSwipePages,
} from "@/lib/workspace/notebook-inking";
import type { NotebookPage } from "@/lib/workspace/notebooks";

export type NotebookSwipeEndOptions = { allowTextTap?: boolean; cancelled?: boolean };

type UseNotebookSwipeGestureOptions = {
  /** Off while viewing on a phone, or while a text box is being dragged. */
  enabled: boolean;
  lock: NotebookNavigationLock;
  turn: Pick<NotebookPageTurn, "createPageActiveRef" | "turnTo" | "createPageAtEnd" | "settleBack">;
  track: Pick<
    NotebookPageTrack,
    | "offsetRef"
    | "setPreviewVisibility"
    | "setPreviewDirection"
    | "captureInkSnapshot"
    | "queueOffset"
    | "writeCreatePageProgress"
  >;
  creation: Pick<NotebookPageCreationState, "setCreatePageActive" | "setCreatePageProgress">;
  viewport: Pick<NotebookViewportController, "layout" | "pagePanLiveRef">;
  pages: NotebookPage[];
  selectedPageIndex: number;
  pageSurfaceRef: RefObject<HTMLDivElement | null>;
  inkInteractionActiveRef: RefObject<boolean>;
  /** A press that never moved: the text tool places a box there. */
  onTap: (event: ReactPointerEvent<HTMLElement>) => void;
};

/**
 * Reads a finger dragged across the page as a page turn, or a pull past the
 * last page as a new one, and hands the release to the page turn.
 *
 * Nothing here animates: the track follows the finger through queued offset
 * writes, and the decision on release -- turn, create, or settle back -- is
 * made by the pure rules in `notebook-inking`.
 */
export function useNotebookSwipeGesture({
  enabled,
  lock,
  turn,
  track,
  creation,
  viewport,
  pages,
  selectedPageIndex,
  pageSurfaceRef,
  inkInteractionActiveRef,
  onTap,
}: UseNotebookSwipeGestureOptions) {
  const { lockedRef, swipeRef } = lock;
  const { createPageActiveRef, turnTo, createPageAtEnd, settleBack } = turn;
  const {
    offsetRef: trackOffsetRef,
    setPreviewVisibility,
    setPreviewDirection,
    captureInkSnapshot,
    queueOffset,
    writeCreatePageProgress,
  } = track;
  const { setCreatePageActive, setCreatePageProgress } = creation;
  const { layout, pagePanLiveRef } = viewport;
  const zoom = layout.zoom;
  const pageOrigin = layout.pageOrigin;

  const start = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        !enabled ||
        !shouldPointerSwipePages(event.pointerType) ||
        lockedRef.current ||
        inkInteractionActiveRef.current
      ) {
        return;
      }
      pagePanLiveRef.current = { ...pageOrigin };
      swipeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        samples: [{ x: event.clientX, time: event.timeStamp }],
        axis: null,
        intent: null,
        completed: false,
      };
      safelySetPointerCapture(event.currentTarget, event.pointerId);
    },
    [enabled, inkInteractionActiveRef, lockedRef, pageOrigin, pagePanLiveRef, swipeRef]
  );

  const move = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const swipe = swipeRef.current;
      if (!swipe || swipe.pointerId !== event.pointerId || swipe.completed) return;

      swipe.currentX = event.clientX;
      swipe.currentY = event.clientY;
      swipe.lastX = event.clientX;
      swipe.lastY = event.clientY;
      swipe.samples = [...swipe.samples, { x: event.clientX, time: event.timeStamp }]
        .filter((sample) => event.timeStamp - sample.time <= 120)
        .slice(-24);

      const totalDx = swipe.currentX - swipe.startX;
      const totalDy = swipe.currentY - swipe.startY;
      if (swipe.axis === null && Math.max(Math.abs(totalDx), Math.abs(totalDy)) >= 8) {
        if (Math.abs(totalDx) > Math.abs(totalDy) * 1.05) {
          swipe.axis = "horizontal";
        } else if (Math.abs(totalDy) > Math.abs(totalDx) * 1.15) {
          swipe.axis = "vertical";
        }
        if (swipe.axis) {
          swipe.intent = getNotebookPageDragIntent({ axis: swipe.axis, zoom });
          if (swipe.intent === "page") {
            setPreviewVisibility(true);
          }
        }
      }

      if (swipe.intent === "none") {
        event.preventDefault();
        return;
      }

      if (swipe.intent !== "page") return;

      captureInkSnapshot();
      setPreviewDirection(getNotebookSwipePreviewDirection(totalDx));

      // Forward pull past the last page → engage the "create new page" affordance.
      if (selectedPageIndex === pages.length - 1 && totalDx < 0) {
        const pageWidth = pageSurfaceRef.current?.getBoundingClientRect().width ?? 1;
        const { progress, resistedOffset } = getNotebookCreatePagePull({ totalDx, pageWidth });
        if (!createPageActiveRef.current) {
          createPageActiveRef.current = true;
          setCreatePageActive(true);
          setCreatePageProgress(progress);
        } else {
          writeCreatePageProgress(progress);
        }
        queueOffset(resistedOffset);
        event.preventDefault();
        return;
      }
      createPageActiveRef.current = false;
      setCreatePageActive(false);
      setCreatePageProgress(0);
      queueOffset(
        getNotebookSwipeDragOffset({
          totalDx,
          currentIndex: selectedPageIndex,
          pageCount: pages.length,
        })
      );
      event.preventDefault();
    },
    [
      captureInkSnapshot,
      createPageActiveRef,
      pageSurfaceRef,
      pages.length,
      queueOffset,
      selectedPageIndex,
      setCreatePageActive,
      setCreatePageProgress,
      setPreviewDirection,
      setPreviewVisibility,
      swipeRef,
      writeCreatePageProgress,
      zoom,
    ]
  );

  const end = useCallback(
    (event: ReactPointerEvent<HTMLElement>, options: NotebookSwipeEndOptions = {}) => {
      const swipe = swipeRef.current;
      if (!swipe || swipe.pointerId !== event.pointerId) return;
      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
      swipeRef.current = null;
      const deltaX = event.clientX - swipe.startX;
      const deltaY = event.clientY - swipe.startY;

      const pageWidth = pageSurfaceRef.current?.getBoundingClientRect().width ?? 1;
      const velocityX = getNotebookSwipeVelocity([
        ...swipe.samples,
        { x: event.clientX, time: event.timeStamp },
      ]);
      // A release can arrive before any move resolved an axis, so the same
      // fitted-view rule is applied to the raw delta.
      const horizontalGesture =
        swipe.intent === "page" ||
        (swipe.intent === null &&
          !isNotebookViewportZoomedIn(zoom) &&
          Math.abs(deltaX) > 8 &&
          Math.abs(deltaX) > Math.abs(deltaY) * 1.05);

      // Releasing a forward pull past the last page either creates a page or
      // rubber-bands back, depending on how far it was pulled (or a fast flick).
      if (horizontalGesture && selectedPageIndex === pages.length - 1 && deltaX < 0) {
        event.preventDefault();
        createPageActiveRef.current = false;
        setCreatePageActive(false);
        if (
          !options.cancelled &&
          shouldCreateNotebookPageOnRelease({ totalDx: deltaX, pageWidth, velocityX })
        ) {
          swipe.completed = true;
          void createPageAtEnd(velocityX);
        } else {
          void settleBack(velocityX);
        }
        return;
      }

      if (horizontalGesture) {
        event.preventDefault();
        const decision = options.cancelled
          ? { direction: null, targetIndex: selectedPageIndex, shouldCommit: false }
          : getNotebookSwipeReleaseDecision({
              totalDx: deltaX,
              pageWidth,
              velocityX,
              currentIndex: selectedPageIndex,
              pageCount: pages.length,
            });
        const targetPage = decision.shouldCommit ? pages[decision.targetIndex] : null;
        if (targetPage && decision.direction) {
          swipe.completed = true;
          void turnTo(targetPage, decision.direction, velocityX);
        } else {
          void settleBack(velocityX);
        }
        return;
      }

      if (trackOffsetRef.current !== 0) {
        void settleBack(velocityX);
        return;
      }
      setPreviewVisibility(false);

      if (
        !swipe.completed &&
        !options.cancelled &&
        Math.abs(deltaX) <= 8 &&
        Math.abs(deltaY) <= 8 &&
        options.allowTextTap &&
        event.currentTarget instanceof HTMLElement &&
        !getNotebookSwipeDirection({
          startX: swipe.startX,
          startY: swipe.startY,
          currentX: event.clientX,
          currentY: event.clientY,
        })
      ) {
        onTap(event);
      }
    },
    [
      createPageActiveRef,
      createPageAtEnd,
      onTap,
      pageSurfaceRef,
      pages,
      selectedPageIndex,
      setCreatePageActive,
      setPreviewVisibility,
      settleBack,
      swipeRef,
      trackOffsetRef,
      turnTo,
      zoom,
    ]
  );

  return { start, move, end };
}
