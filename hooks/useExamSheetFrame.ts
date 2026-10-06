"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { ExamInkActivity } from "@/hooks/useExamInkActivity";
import { useExamSheetSwipe, type ExamSheetSwipeTarget } from "@/hooks/useExamSheetSwipe";
import {
  useNotebookViewportController,
  type NotebookViewportFrameSize,
} from "@/hooks/useNotebookViewportController";
import {
  examSheetInlineFrameHeight,
  examSheetTallestPage,
  type ExamSheetPage,
} from "@/lib/practice/exam-question-sheet";
import { installNotebookStylusTouchListeners, installNotebookViewportZoomBlock } from "@/lib/workspace/notebook-interaction-lock";
import {
  clampNotebookViewportOrigin,
  getNotebookViewportLayout,
  isNotebookViewportZoomedIn,
  zoomNotebookViewportAbout,
  type NotebookViewportPoint,
} from "@/lib/workspace/notebook-viewport";

/** How far one notch of a mouse wheel, or a trackpad pinch, zooms. */
const WHEEL_ZOOM_SENSITIVITY = 0.0025;
const NO_PAN: NotebookViewportPoint = { x: 0, y: 0 };

/**
 * The window the working sheet is seen through, and every finger on it.
 *
 * The page as the notebook holds one: a frame, a zoom and where the page sits
 * inside the frame. This was a scrolling box whose page was made wider to
 * zoom, which is why it could only be zoomed full screen, only with buttons,
 * and not pinched at all. The notebook's viewport is what a student has
 * already learned to pinch, pan and turn, so the sheet uses it -- inline and
 * full screen alike. What the viewport does not take for itself, it hands back
 * as a page turn.
 */
export function useExamSheetFrame({
  rootRef,
  frameRef,
  surfaceRef,
  pageShellRef,
  addSheetHintRef,
  expanded,
  disabled,
  sheetPages,
  currentPage,
  pageIndex,
  pageKey,
  canAddPage,
  goToPage,
  addPage,
  ink,
}: {
  /** The whole sheet, tools included, which a pinch never zooms the web page from. */
  rootRef: RefObject<HTMLDivElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
  /** The page itself: what a pinch scales and a pan moves. */
  surfaceRef: RefObject<HTMLDivElement | null>;
  pageShellRef: RefObject<HTMLDivElement | null>;
  addSheetHintRef: RefObject<HTMLDivElement | null>;
  expanded: boolean;
  disabled: boolean;
  sheetPages: readonly ExamSheetPage[];
  currentPage: ExamSheetPage;
  pageIndex: number;
  /** Changes whenever another page is opened. */
  pageKey: number;
  canAddPage: boolean;
  goToPage: (index: number) => void;
  addPage: () => void;
  ink: Pick<ExamInkActivity, "isInking" | "isHoldingPen" | "isSuppressingTouch">;
}) {
  const { isInking, isHoldingPen, isSuppressingTouch } = ink;
  const [frameSize, setFrameSize] = useState<NotebookViewportFrameSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<NotebookViewportPoint>(NO_PAN);
  /**
   * Fingers that are down on the frame, by pointer id.
   *
   * Only so a capture lost after the finger has already been let go is not
   * read as a second release of it -- see `handleFrameLostPointerCapture`.
   */
  const frameTouchesRef = useRef<Set<number>>(new Set());
  const sheetRef = useRef<ExamSheetSwipeTarget>({
    pageIndex: 0,
    pageCount: 1,
    canAddPage: false,
    disabled: false,
    zoom: 1,
    pageWidth: 1,
    goToPage: () => undefined,
    addPage: () => undefined,
  });
  const swipe = useExamSheetSwipe({ frameRef, pageShellRef, addSheetHintRef, sheetRef, isInking });
  const { beginSwipe, moveSwipe, endSwipe, cancelSwipe, cancelGesture, forgetCandidate, isSwiping } = swipe;

  /*
   * The notebook's Pencil guard.
   *
   * iPadOS Safari reads Apple Pencil movement as a native scroll or back
   * gesture even under `touch-action: none`: it cancels the stroke part way
   * and then needs a frame to settle before it delivers the next one. It
   * cancels the touch default only for Pencil contact or while ink is being
   * drawn, so taps on controls stay native.
   *
   * On the whole frame rather than the page, and for the moment after the
   * Pencil lifts as well as while it writes. A fitted sheet lets a finger
   * scroll the practice page natively (see `data-sheet-touch`), so this guard
   * is all that stops the Pencil in the margin, or the hand that was holding
   * it, from scrolling the page instead.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    return installNotebookStylusTouchListeners({ surface: frame, getInkInteractionActive: isHoldingPen });
  }, [frameRef, isHoldingPen]);

  /*
   * The frame the page is seen through.
   *
   * Full screen it is whatever the screen leaves under the tools. Inline it is
   * as wide as the column and as tall as the page needs to fill that width, so
   * the sheet still flows with the practice page -- see
   * `examSheetInlineFrameHeight`. It is the same element in both modes, so
   * switching restyles it rather than remounting the editor inside.
   */
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      setFrameSize((previous) =>
        Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5
          ? previous
          : { width, height }
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frameRef]);

  /*
   * Inline, the frame is as tall as the tallest page, whichever is open.
   *
   * It used to take the height of the open page, and a question's pages are
   * rarely one shape: a full printed page, then the three-line stub where the
   * question ran over. Turning from one to the other shrank the sheet by most
   * of a screen under the finger that turned it, so the next pinch or swipe
   * landed on the practice page around it -- and that zoomed the whole web
   * page instead of the sheet. A shorter page now sits in the middle of the
   * same frame, the way the notebook shows pages of different shapes, and the
   * frame round it still takes every finger.
   */
  const tallestPage = useMemo(() => examSheetTallestPage(sheetPages), [sheetPages]);
  const inlineHeight = examSheetInlineFrameHeight(frameSize.width, tallestPage.width, tallestPage.height);
  /**
   * The frame the viewport lays the page out in.
   *
   * Inline its height is known from its width the moment the page changes, so
   * it is handed over then rather than waiting a frame for the observer to
   * measure it -- a frame in which the page was fitted to the old height.
   */
  const viewportFrameSize = useMemo<NotebookViewportFrameSize>(
    () => (expanded || inlineHeight <= 0 ? frameSize : { width: frameSize.width, height: inlineHeight }),
    [expanded, frameSize, inlineHeight]
  );

  /*
   * The notebook's own viewport: its fit, its pinch anchored under the
   * fingers, one finger moving a zoomed page, and its palm rule -- touch is
   * ignored while the Pencil is down and for a moment after it lifts.
   */
  const { layout, pagePanLiveRef, handleTouchPointerDown, handleTouchPointerMove, handleTouchPointerEnd } =
    useNotebookViewportController({
      frameSize: viewportFrameSize,
      pageZoom: zoom,
      pagePan: pan,
      pageWidth: currentPage.width,
      pageHeight: currentPage.height,
      setPageZoom: setZoom,
      setPagePan: setPan,
      pageSurfaceRef: surfaceRef,
      pageFrameRef: frameRef,
      isNavigationLocked: () => false,
      isStylusSuppressingTouch: isSuppressingTouch,
      onPinchTakeover: cancelGesture,
      onClearSwipeCandidate: forgetCandidate,
      onSwipeEnd: (event, options) => {
        if (options.cancelled) cancelSwipe(event);
        else endSwipe(event);
      },
    });
  const zoomed = isNotebookViewportZoomedIn(layout.zoom);

  /*
   * Another page opens fitted to the same zoom, at its top: a zoomed sheet
   * stays zoomed, the way a notebook does, but the pages are different shapes,
   * so wherever the last one was being read means nothing on the next.
   */
  const [openedPageKey, setOpenedPageKey] = useState(pageKey);
  if (openedPageKey !== pageKey) {
    setOpenedPageKey(pageKey);
    if (zoomed) {
      const opened = getNotebookViewportLayout({
        frameWidth: layout.frameSize.width,
        frameHeight: layout.frameSize.height,
        pageWidth: currentPage.width,
        pageHeight: currentPage.height,
        zoom: layout.zoom,
      });
      setPan(
        clampNotebookViewportOrigin({
          origin: { x: opened.pageOrigin.x, y: opened.inset },
          bounds: opened.panBounds,
        })
      );
    }
  }

  /** The layout as last rendered, for handlers held stable across renders. */
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
    sheetRef.current = {
      pageIndex,
      pageCount: sheetPages.length,
      canAddPage,
      disabled,
      zoom: layout.zoom,
      pageWidth: Math.max(1, layout.pageSize.width),
      goToPage,
      addPage,
    };
  });

  // Where the page settled, for the next pinch or pan to start from.
  useEffect(() => {
    pagePanLiveRef.current = layout.pageOrigin;
  }, [layout.pageOrigin, pagePanLiveRef]);

  const fitPage = useCallback(() => {
    setZoom(1);
    setPan(NO_PAN);
  }, []);

  /*
   * Zooms about a point in the frame, keeping whatever is under it still.
   *
   * The buttons zoom about the middle of the frame, and a mouse wheel or a
   * trackpad pinch about the pointer. A pinch on glass never comes here: the
   * viewport anchors that itself.
   */
  const zoomAbout = useCallback((nextZoom: number, focus?: NotebookViewportPoint) => {
    const next = zoomNotebookViewportAbout({ layout: layoutRef.current, zoom: nextZoom, focus });
    if (!next) return;
    setZoom(next.zoom);
    setPan(next.pan);
  }, []);

  /*
   * A mouse wheel and a trackpad, on a desktop.
   *
   * A zoomed page used to be a scrolling box, so a wheel moved it for free. It
   * is positioned now, the way the notebook positions one, so the wheel is
   * read here: it pans a zoomed page, and with Ctrl -- which is also how a
   * trackpad pinch arrives -- it zooms about the pointer. A fitted page leaves
   * a plain wheel alone, so the practice page scrolls past it as it always did.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let pendingPan: NotebookViewportPoint | null = null;
    let animationFrame = 0;
    const onWheel = (event: WheelEvent) => {
      if (isInking()) return;
      const current = layoutRef.current;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = frame.getBoundingClientRect();
        zoomAbout(current.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        return;
      }
      if (!isNotebookViewportZoomedIn(current.zoom)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? current.frameSize.height : 1;
      const from = pendingPan ?? current.pageOrigin;
      pendingPan = clampNotebookViewportOrigin({
        origin: { x: from.x - event.deltaX * unit, y: from.y - event.deltaY * unit },
        bounds: current.panBounds,
      });
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const next = pendingPan;
        pendingPan = null;
        if (next) setPan(next);
      });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      frame.removeEventListener("wheel", onWheel);
    };
  }, [frameRef, isInking, zoomAbout]);

  /*
   * A pinch that starts on the sheet is the sheet's, never Safari's page zoom.
   *
   * The whole sheet, tools included, rather than only the frame: a pinch
   * begun with one finger on the tools or the edge of the paper zoomed the
   * web page, and the next gesture then landed on a page magnified around it.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return installNotebookViewportZoomBlock(root);
  }, [rootRef]);

  /*
   * What a finger on a fitted sheet keeps from the browser.
   *
   * Inline and fitted, the frame is `touch-action: pan-y`, so a finger dragged
   * up or down scrolls the practice page natively. Two gestures are still the
   * sheet's, and are claimed before the browser can start a scroll of its own:
   * a sideways drag once it has been read as a page turn, and any second
   * finger, which is a pinch. `touch-action` is not trusted with either alone:
   * iPadOS can begin a pan on a sideways drag and cancel the pointer, and a
   * pinch drifting upwards is a two-finger scroll to a browser.
   *
   * Pointer events are dispatched before the touch events for the same
   * movement, so a swipe's intent is decided by the time its `touchmove`
   * arrives.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const claim = (event: TouchEvent) => {
      if (!event.cancelable) return;
      if (event.touches.length >= 2 || isSwiping()) {
        event.preventDefault();
      }
    };
    const options: AddEventListenerOptions = { passive: false };
    frame.addEventListener("touchstart", claim, options);
    frame.addEventListener("touchmove", claim, options);
    return () => {
      frame.removeEventListener("touchstart", claim, options);
      frame.removeEventListener("touchmove", claim, options);
    };
  }, [frameRef, isSwiping]);

  /*
   * Every finger lands on the frame rather than the ink.
   *
   * The ink editor passes touches straight through -- fingers never draw -- so
   * they bubble up to here. The viewport answers first, and only what it
   * declines becomes a page turn or a scroll. The margin round the page is part
   * of the frame, so a turn can start there too.
   */
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      frameTouchesRef.current.add(event.pointerId);
      if (handleTouchPointerDown(event)) return;
      beginSwipe(event);
    },
    [beginSwipe, handleTouchPointerDown]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      if (handleTouchPointerMove(event)) return;
      moveSwipe(event);
    },
    [handleTouchPointerMove, moveSwipe]
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      frameTouchesRef.current.delete(event.pointerId);
      handleTouchPointerEnd(event);
    },
    [handleTouchPointerEnd]
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      frameTouchesRef.current.delete(event.pointerId);
      handleTouchPointerEnd(event, { cancelled: true });
    },
    [handleTouchPointerEnd]
  );

  /*
   * The frame losing a finger it still holds, and nothing else.
   *
   * `lostpointercapture` bubbles. The frame takes every finger from whatever
   * it landed on, and the element that gave it up reports the loss -- which
   * reached here and ended the gesture the frame had just begun. And letting a
   * finger go releases the capture, which reported the same release twice.
   */
  const onLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (!frameTouchesRef.current.has(event.pointerId)) return;
      onPointerCancel(event);
    },
    [onPointerCancel]
  );

  return {
    layout,
    zoomed,
    tallestPage,
    inlineHeight,
    fitPage,
    zoomAbout,
    cancelGesture,
    frameHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture },
  };
}
