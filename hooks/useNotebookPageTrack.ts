"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import {
  getNotebookSwipePreviewDirection,
  type NotebookPageSwipeMotion,
} from "@/lib/workspace/notebook-carousel";

const NOTEBOOK_PAGE_SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export type NotebookPageInkSnapshot = {
  pageId: string;
  svg: string;
};

type UseNotebookPageTrackOptions = {
  /** The sliding strip holding the previous, current, and next page. */
  trackRef: RefObject<HTMLDivElement | null>;
  /** The layer that renders neighbouring pages during a swipe. */
  previewLayerRef: RefObject<HTMLDivElement | null>;
  createPageAffordanceRef: RefObject<HTMLDivElement | null>;
  createPageIndicatorRef: RefObject<HTMLDivElement | null>;
  createPageProgressCircleRef: RefObject<SVGCircleElement | null>;
  getSelectedPageId: () => string | null;
  /** Serialised ink for the open page, used to freeze it during a swipe. */
  getInkSnapshotSvg: () => string;
  onSwipeMotionChange: (motion: NotebookPageSwipeMotion | null) => void;
  onInkSnapshotChange: (snapshot: NotebookPageInkSnapshot | null) => void;
};

export type NotebookPageTrack = {
  /** Committed track offset in px. Read by the swipe gesture handlers. */
  offsetRef: RefObject<number>;
  motionRef: RefObject<NotebookPageSwipeMotion | null>;
  previewDirectionRef: RefObject<"next" | "previous" | null>;
  updateSwipeMotion: (motion: NotebookPageSwipeMotion | null) => void;
  setPreviewDirection: (direction: "next" | "previous" | null) => void;
  setPreviewVisibility: (visible: boolean) => void;
  captureInkSnapshot: () => void;
  markInkSnapshotReady: (pageId: string) => void;
  /** Writes the offset immediately; use during a gesture. */
  writeOffset: (offset: number) => void;
  /** Coalesces writes to one per animation frame. */
  queueOffset: (offset: number) => void;
  /** Runs a settle animation and resolves when the transition lands. */
  animateTo: (motion: NotebookPageSwipeMotion) => Promise<void>;
  handleTransitionEnd: (event: ReactTransitionEvent<HTMLDivElement>) => void;
  resolveTransition: () => void;
  cancelQueuedOffset: () => void;
  writeCreatePageProgress: (progress: number) => void;
};

/**
 * Drives the page-track transform and the swipe preview layer.
 *
 * Everything here writes to the DOM directly rather than through React state:
 * a swipe has to stay on the compositor, so React only learns about the motion
 * once it settles.
 */
export function useNotebookPageTrack({
  trackRef,
  previewLayerRef,
  createPageAffordanceRef,
  createPageIndicatorRef,
  createPageProgressCircleRef,
  getSelectedPageId,
  getInkSnapshotSvg,
  onSwipeMotionChange,
  onInkSnapshotChange,
}: UseNotebookPageTrackOptions): NotebookPageTrack {
  const offsetRef = useRef(0);
  const pendingOffsetRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const transitionResolverRef = useRef<(() => void) | null>(null);
  const previewDirectionRef = useRef<"next" | "previous" | null>(null);
  const motionRef = useRef<NotebookPageSwipeMotion | null>(null);
  const inkSnapshotRef = useRef<NotebookPageInkSnapshot | null>(null);

  const latestRef = useRef({
    getSelectedPageId,
    getInkSnapshotSvg,
    onSwipeMotionChange,
    onInkSnapshotChange,
  });
  useEffect(() => {
    latestRef.current = {
      getSelectedPageId,
      getInkSnapshotSvg,
      onSwipeMotionChange,
      onInkSnapshotChange,
    };
  }, [
    getInkSnapshotSvg,
    getSelectedPageId,
    onInkSnapshotChange,
    onSwipeMotionChange,
  ]);

  const updateSwipeMotion = useCallback(
    (motion: NotebookPageSwipeMotion | null) => {
      motionRef.current = motion;
      latestRef.current.onSwipeMotionChange(motion);
    },
    []
  );

  const setPreviewDirection = useCallback(
    (direction: "next" | "previous" | null) => {
      if (previewDirectionRef.current === direction) return;
      previewDirectionRef.current = direction;
      const track = trackRef.current;
      if (!track) return;
      if (direction) {
        track.dataset.swipeDirection = direction;
      } else {
        delete track.dataset.swipeDirection;
      }
    },
    [trackRef]
  );

  const captureInkSnapshot = useCallback(() => {
    const pageId = latestRef.current.getSelectedPageId();
    if (!pageId || inkSnapshotRef.current?.pageId === pageId) return;
    const snapshot = { pageId, svg: latestRef.current.getInkSnapshotSvg() };
    inkSnapshotRef.current = snapshot;
    // The outgoing page renders from this frozen SVG until it reports ready.
    const track = trackRef.current;
    if (track) delete track.dataset.inkSnapshotReady;
    latestRef.current.onInkSnapshotChange(snapshot);
  }, [trackRef]);

  const markInkSnapshotReady = useCallback(
    (pageId: string) => {
      if (inkSnapshotRef.current?.pageId !== pageId) return;
      const track = trackRef.current;
      if (track) track.dataset.inkSnapshotReady = "true";
    },
    [trackRef]
  );

  const setPreviewVisibility = useCallback(
    (visible: boolean) => {
      const layer = previewLayerRef.current;
      if (layer) layer.style.visibility = visible ? "visible" : "hidden";
      const track = trackRef.current;
      if (track) {
        if (visible) {
          track.dataset.swipeActive = "true";
        } else {
          delete track.dataset.swipeActive;
          delete track.dataset.swipeDirection;
          delete track.dataset.inkSnapshotReady;
        }
      }
      if (!visible) {
        previewDirectionRef.current = null;
        inkSnapshotRef.current = null;
        latestRef.current.onInkSnapshotChange(null);
      }
    },
    [previewLayerRef, trackRef]
  );

  const writeOffset = useCallback(
    (offset: number) => {
      offsetRef.current = offset;
      pendingOffsetRef.current = offset;
      const track = trackRef.current;
      if (track) track.style.transform = `translate3d(${offset}px, 0, 0)`;
    },
    [trackRef]
  );

  const cancelQueuedOffset = useCallback(() => {
    if (animationFrameRef.current === null) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const queueOffset = useCallback(
    (offset: number) => {
      offsetRef.current = offset;
      pendingOffsetRef.current = offset;
      // Pointer events outpace paint; keep only the newest sample per frame.
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        writeOffset(pendingOffsetRef.current);
      });
    },
    [writeOffset]
  );

  const resolveTransition = useCallback(() => {
    const resolve = transitionResolverRef.current;
    transitionResolverRef.current = null;
    resolve?.();
  }, []);

  const animateTo = useCallback(
    (motion: NotebookPageSwipeMotion) => {
      const previewDirection =
        motion.direction ?? getNotebookSwipePreviewDirection(offsetRef.current);
      if (motion.targetOffset !== 0 || offsetRef.current !== 0) {
        captureInkSnapshot();
      }
      setPreviewDirection(previewDirection);
      updateSwipeMotion(motion);
      setPreviewVisibility(true);
      cancelQueuedOffset();

      const track = trackRef.current;
      if (!track) {
        writeOffset(motion.targetOffset);
        return Promise.resolve();
      }
      track.style.transition = "none";
      track.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
      // Force a reflow so the transition below starts from this offset.
      void track.getBoundingClientRect();

      return new Promise<void>((resolve) => {
        transitionResolverRef.current = resolve;
        if (
          motion.durationMs <= 0 ||
          Math.abs(motion.targetOffset - offsetRef.current) < 0.5
        ) {
          writeOffset(motion.targetOffset);
          queueMicrotask(resolveTransition);
          return;
        }
        track.style.transition = `transform ${motion.durationMs}ms ${NOTEBOOK_PAGE_SETTLE_EASING}`;
        writeOffset(motion.targetOffset);
      });
    },
    [
      cancelQueuedOffset,
      captureInkSnapshot,
      resolveTransition,
      setPreviewDirection,
      setPreviewVisibility,
      trackRef,
      updateSwipeMotion,
      writeOffset,
    ]
  );

  const handleTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLDivElement>) => {
      if (
        event.target === event.currentTarget &&
        event.propertyName === "transform"
      ) {
        resolveTransition();
      }
    },
    [resolveTransition]
  );

  const writeCreatePageProgress = useCallback(
    (progress: number) => {
      const next = Math.max(0, Math.min(1, progress));
      if (createPageAffordanceRef.current) {
        createPageAffordanceRef.current.style.opacity = String(
          Math.min(1, 0.2 + next * 0.8)
        );
      }
      if (createPageIndicatorRef.current) {
        createPageIndicatorRef.current.style.transform = `scale(${
          0.72 + next * 0.28
        })`;
      }
      if (createPageProgressCircleRef.current) {
        createPageProgressCircleRef.current.style.strokeDashoffset = String(
          2 * Math.PI * 20 * (1 - next)
        );
      }
    },
    [createPageAffordanceRef, createPageIndicatorRef, createPageProgressCircleRef]
  );

  useEffect(() => cancelQueuedOffset, [cancelQueuedOffset]);

  return {
    offsetRef,
    motionRef,
    previewDirectionRef,
    updateSwipeMotion,
    setPreviewDirection,
    setPreviewVisibility,
    captureInkSnapshot,
    markInkSnapshotReady,
    writeOffset,
    queueOffset,
    animateTo,
    handleTransitionEnd,
    resolveTransition,
    cancelQueuedOffset,
    writeCreatePageProgress,
  };
}
