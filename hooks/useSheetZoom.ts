"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export const MIN_SHEET_ZOOM = 1;
export const MAX_SHEET_ZOOM = 3;
/** One press of a zoom button. */
const BUTTON_STEP = 1.25;
/** Quiet time after a pinch or a zooming scroll before the sheet is redrawn at its new size. */
const SETTLE_MS = 160;

const clampZoom = (value: number) => Math.min(MAX_SHEET_ZOOM, Math.max(MIN_SHEET_ZOOM, value));

/** A point in the scroller's frame that should stay where it is through a zoom. */
type Focus = { x: number; y: number };

type Preview = { scale: number; origin: Focus };

/**
 * Zooming into a sheet kept beside the page: buttons, Ctrl or Cmd with the
 * scroll wheel (which is also what a trackpad pinch sends), and a two-finger
 * pinch on a tablet.
 *
 * The sheet is redrawn at the new size rather than stretched, so a PDF is as
 * sharp at three times as it is at fit. Redrawing on every frame of a pinch
 * would stutter, so the gesture is previewed by scaling what is already drawn
 * and the sheet is redrawn once it settles. One finger still scrolls, so a
 * zoomed sheet is moved around the way any page is; the point under the pinch,
 * the pointer or the middle of the view stays put as it grows.
 */
export function useSheetZoom() {
  const [zoom, setZoom] = useState(MIN_SHEET_ZOOM);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const zoomRef = useRef(zoom);
  const previewRef = useRef(preview);
  const pending = useRef<{ focus: Focus; ratio: number; left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    previewRef.current = preview;
    scrollerRef.current = scroller;
  });

  /** Settles on `target`, keeping `focus` (in the scroller's frame) where it is. */
  const commit = (target: number, focus?: Focus) => {
    const next = clampZoom(target);
    const scroller = scrollerRef.current;
    const ratio = next / zoomRef.current;
    if (scroller && ratio !== 1) {
      pending.current = {
        focus: focus ?? { x: scroller.clientWidth / 2, y: scroller.clientHeight / 2 },
        ratio,
        left: scroller.scrollLeft,
        top: scroller.scrollTop,
      };
    }
    setPreview(null);
    setZoom(next);
  };
  // The gestures below are listened for once, and settle through the latest commit.
  const commitRef = useRef(commit);
  useLayoutEffect(() => {
    commitRef.current = commit;
  });

  // The sheet has its new size by now, so the scroll that keeps the focus still can be set.
  useLayoutEffect(() => {
    const move = pending.current;
    const scroller = scrollerRef.current;
    pending.current = null;
    if (!move || !scroller) return;
    scroller.scrollLeft = (move.left + move.focus.x) * move.ratio - move.focus.x;
    scroller.scrollTop = (move.top + move.focus.y) * move.ratio - move.focus.y;
  }, [zoom]);

  useEffect(() => {
    if (!host) return;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let pinch: { distance: number; focus: Focus } | null = null;

    const focusOf = (clientX: number, clientY: number): Focus | null => {
      const scroller = scrollerRef.current;
      if (!scroller) return null;
      const rect = scroller.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    /** Shows `scale` times the current size, growing from `focus`. */
    const show = (scale: number, focus: Focus) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      // Held inside the limits, so the preview never promises a size the sheet will not take.
      const bounded = clampZoom(zoomRef.current * scale) / zoomRef.current;
      setPreview({
        scale: bounded,
        origin: { x: scroller.scrollLeft + focus.x, y: scroller.scrollTop + focus.y },
      });
    };
    const finish = (focus: Focus) => {
      const scale = previewRef.current?.scale ?? 1;
      if (scale !== 1) commitRef.current(zoomRef.current * scale, focus);
      else setPreview(null);
    };

    // By hand, because React's wheel listener is passive and cannot stop the page zooming instead.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const focus = focusOf(event.clientX, event.clientY);
      if (!focus) return;
      event.preventDefault();
      show((previewRef.current?.scale ?? 1) * Math.exp(-event.deltaY * 0.01), focus);
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => finish(focus), SETTLE_MS);
    };

    const fingers = (event: TouchEvent) => {
      const [a, b] = [event.touches[0], event.touches[1]];
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      };
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const { distance, x, y } = fingers(event);
      const focus = focusOf(x, y);
      if (focus && distance > 0) pinch = { distance, focus };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      // Two fingers are a pinch of the sheet, not of the whole page.
      event.preventDefault();
      show(fingers(event).distance / pinch.distance, pinch.focus);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!pinch || event.touches.length >= 2) return;
      const { focus } = pinch;
      pinch = null;
      finish(focus);
    };

    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);
    return () => {
      if (settle) clearTimeout(settle);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [host]);

  /** What is drawn inside the scroller, scaled while a gesture is previewed. */
  const contentStyle: CSSProperties | undefined = preview
    ? { transform: `scale(${preview.scale})`, transformOrigin: `${preview.origin.x}px ${preview.origin.y}px` }
    : undefined;

  return {
    /** For the `ref` of the element the gestures are read from: the whole sheet. */
    setHost,
    /** For the `ref` of the element that scrolls the zoomed sheet: for a PDF, the page in view. */
    setScroller,
    /*
     * Apart from the two element setters, because they are passed as refs: the
     * React Compiler would otherwise read everything beside them as a ref too.
     */
    zoom: {
      level: zoom,
      contentStyle,
      zoomIn: () => commit(zoom * BUTTON_STEP),
      zoomOut: () => commit(zoom / BUTTON_STEP),
      fit: () => commit(MIN_SHEET_ZOOM),
      canZoomIn: zoom < MAX_SHEET_ZOOM,
      canZoomOut: zoom > MIN_SHEET_ZOOM,
    },
  };
}

export type SheetZoom = ReturnType<typeof useSheetZoom>["zoom"];
