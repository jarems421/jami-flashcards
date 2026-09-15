"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { GraphViewWindow } from "@/lib/math/graph-expression";
import { graphPlotArea, panGraphView, zoomGraphView } from "@/lib/workspace/notebook-graphs";

type Options = {
  /** The element the graph is drawn in. */
  ref: RefObject<HTMLDivElement | null>;
  view: GraphViewWindow;
  /** The size of the graph's drawing, in the units NotebookGraphView is given. */
  viewBoxWidth: number;
  viewBoxHeight: number;
  hasTitle: boolean;
  onChange: (view: GraphViewWindow) => void;
  /**
   * Zoom with the scroll wheel. Off where the graph sits inside something that
   * scrolls, such as a conversation, so scrolling past it still scrolls.
   */
  wheelZoom?: boolean;
  /** Pan with a finger. Off for the same reason: there a finger drag should scroll. */
  touchPan?: boolean;
};

/**
 * Drag to move around a graph and zoom in on it, the way a graphing calculator does.
 *
 * Distances are converted through the plotted area rather than the whole
 * element, so the point under the pointer stays under it while dragging and a
 * scroll zooms in on exactly where the pointer is.
 */
export function useGraphPanZoom({
  ref,
  view,
  viewBoxWidth,
  viewBoxHeight,
  hasTitle,
  onChange,
  wheelZoom = false,
  touchPan = false,
}: Options) {
  const viewRef = useRef(view);
  const onChangeRef = useRef(onChange);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    view: GraphViewWindow;
  } | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    viewRef.current = view;
    onChangeRef.current = onChange;
  });

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  /** Screen pixels per drawing unit, and graph units per screen pixel, for a view. */
  const measure = useCallback(
    (current: GraphViewWindow) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return null;
      const plot = graphPlotArea(viewBoxWidth, viewBoxHeight, hasTitle, current);
      const pixelsX = rect.width / viewBoxWidth;
      const pixelsY = rect.height / viewBoxHeight;
      return {
        rect,
        plot,
        pixelsX,
        pixelsY,
        unitsPerPixelX: (current.xMax - current.xMin) / ((plot.right - plot.left) * pixelsX),
        unitsPerPixelY: (current.yMax - current.yMin) / ((plot.bottom - plot.top) * pixelsY),
      };
    },
    [hasTitle, ref, viewBoxHeight, viewBoxWidth]
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || !wheelZoom) return;
    const handleWheel = (event: WheelEvent) => {
      const current = viewRef.current;
      const scale = measure(current);
      if (!scale) return;
      event.preventDefault();
      const focus = {
        x:
          current.xMin +
          (event.clientX - scale.rect.left - scale.plot.left * scale.pixelsX) * scale.unitsPerPixelX,
        y:
          current.yMax -
          (event.clientY - scale.rect.top - scale.plot.top * scale.pixelsY) * scale.unitsPerPixelY,
      };
      const factor = Math.exp(Math.max(-0.5, Math.min(0.5, event.deltaY / 400)));
      onChangeRef.current(zoomGraphView(current, factor, focus));
    };
    // Not passive: a wheel over the graph zooms it instead of scrolling the page.
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [measure, ref, wheelZoom]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || (event.pointerType === "touch" && !touchPan)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        view: viewRef.current,
      };
    },
    [touchPan]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const { clientX, clientY } = event;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const current = dragRef.current;
        // Scaled by the view the drag began with, so the graph follows the
        // pointer rather than drifting as the view changes under it.
        const scale = current ? measure(current.view) : null;
        if (!current || !scale) return;
        onChangeRef.current(
          panGraphView(
            current.view,
            -(clientX - current.clientX) * scale.unitsPerPixelX,
            (clientY - current.clientY) * scale.unitsPerPixelY
          )
        );
      });
    },
    [measure]
  );

  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const zoomBy = useCallback((factor: number) => {
    onChangeRef.current(zoomGraphView(viewRef.current, factor));
  }, []);

  return {
    zoomBy,
    bindings: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  };
}
