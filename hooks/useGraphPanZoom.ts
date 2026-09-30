"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { GraphViewWindow } from "@/lib/math/graph-expression";
import {
  graphPlotArea,
  graphPointAtScreen,
  panGraphView,
  pinchGraphView,
  zoomGraphView,
  type GraphScreenFrame,
  type GraphScreenPoint,
} from "@/lib/workspace/notebook-graphs";

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
   * scrolls, such as a conversation, so scrolling past it still scrolls. A
   * trackpad pinch zooms either way: it arrives as a wheel with ctrl held, and
   * would otherwise zoom the whole page.
   */
  wheelZoom?: boolean;
  /** Pan with a finger. Off for the same reason: there a finger drag should scroll. */
  touchPan?: boolean;
};

type Pinch = {
  ids: [number, number];
  from: [GraphScreenPoint, GraphScreenPoint];
  view: GraphViewWindow;
};

/**
 * Drag to move around a graph and zoom in on it, the way a graphing calculator does.
 *
 * Distances are converted through the plotted area rather than the whole
 * element, so the point under the pointer stays under it while dragging and a
 * scroll zooms in on exactly where the pointer is.
 *
 * Two fingers pinch it, wherever it is. One finger is the surface's to decide
 * (`touchPan`), but two on a graph only ever mean the graph: a student
 * pinching a curve to see where it crosses wants the curve bigger, not the
 * page around it.
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
  const touchesRef = useRef(new Map<number, GraphScreenPoint>());
  const pinchRef = useRef<Pinch | null>(null);
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

  /** Held as well as sent, so a gesture that follows this one starts from it before the next render. */
  const emit = useCallback((next: GraphViewWindow) => {
    viewRef.current = next;
    onChangeRef.current(next);
  }, []);

  const screenFrame = useCallback((): GraphScreenFrame | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    return { rect, drawingWidth: viewBoxWidth, drawingHeight: viewBoxHeight, hasTitle };
  }, [hasTitle, ref, viewBoxHeight, viewBoxWidth]);

  /** Graph units per screen pixel, for a view. */
  const measure = useCallback(
    (current: GraphViewWindow) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return null;
      const plot = graphPlotArea(viewBoxWidth, viewBoxHeight, hasTitle, current);
      return {
        unitsPerPixelX:
          (current.xMax - current.xMin) / ((plot.right - plot.left) * (rect.width / viewBoxWidth)),
        unitsPerPixelY:
          (current.yMax - current.yMin) / ((plot.bottom - plot.top) * (rect.height / viewBoxHeight)),
      };
    },
    [hasTitle, ref, viewBoxHeight, viewBoxWidth]
  );

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!wheelZoom && !event.ctrlKey) return;
      const current = viewRef.current;
      const frame = screenFrame();
      if (!frame) return;
      event.preventDefault();
      const focus = graphPointAtScreen(current, frame, { x: event.clientX, y: event.clientY });
      // A pinch sends far smaller steps than a wheel's notches, so it is read more keenly.
      const sensitivity = event.ctrlKey ? 100 : 400;
      const factor = Math.exp(Math.max(-0.5, Math.min(0.5, event.deltaY / sensitivity)));
      emit(zoomGraphView(current, factor, focus));
    };
    // Not passive: a wheel over the graph zooms it instead of scrolling the page.
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [emit, ref, screenFrame, wheelZoom]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Where one finger scrolls past the graph, two must not scroll or zoom the
    // page instead of pinching it. Only fingers that are on the graph count.
    const handleTouchMove = (event: TouchEvent) => {
      if (!event.cancelable) return;
      let onGraph = 0;
      for (const touch of Array.from(event.touches)) {
        if (touch.target instanceof Node && element.contains(touch.target)) onGraph += 1;
      }
      if (onGraph > 1) event.preventDefault();
    };
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => element.removeEventListener("touchmove", handleTouchMove);
  }, [ref]);

  const pinchedView = useCallback(
    (pinch: Pinch) => {
      const first = touchesRef.current.get(pinch.ids[0]);
      const second = touchesRef.current.get(pinch.ids[1]);
      const frame = screenFrame();
      if (!first || !second || !frame) return null;
      return pinchGraphView(pinch.view, frame, pinch.from, [first, second]);
    },
    [screenFrame]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") {
        // The first finger of a new touch: nothing from an earlier one can still be down.
        if (event.isPrimary) {
          touchesRef.current.clear();
          pinchRef.current = null;
        }
        touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchesRef.current.size === 2 && !pinchRef.current) {
          const ids = [...touchesRef.current.keys()] as [number, number];
          const from = ids.map((id) => ({ ...touchesRef.current.get(id)! })) as Pinch["from"];
          // The second finger turns a drag into a pinch, from wherever the drag got to.
          dragRef.current = null;
          pinchRef.current = { ids, from, view: viewRef.current };
          for (const id of ids) {
            try {
              event.currentTarget.setPointerCapture(id);
            } catch {
              // A finger that already lifted has nothing to capture.
            }
          }
          return;
        }
      }
      if (pinchRef.current) return;
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
      if (touchesRef.current.has(event.pointerId)) {
        touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      const pinch = pinchRef.current;
      if (pinch?.ids.includes(event.pointerId)) {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const current = pinchRef.current;
          const next = current ? pinchedView(current) : null;
          if (next) emit(next);
        });
        return;
      }
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
        emit(
          panGraphView(
            current.view,
            -(clientX - current.clientX) * scale.unitsPerPixelX,
            (clientY - current.clientY) * scale.unitsPerPixelY
          )
        );
      });
    },
    [emit, measure, pinchedView]
  );

  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pinch = pinchRef.current;
      if (pinch?.ids.includes(event.pointerId)) {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        // The last movement, which may still have been waiting for a frame.
        const settled = pinchedView(pinch);
        if (settled) emit(settled);
        pinchRef.current = null;
        touchesRef.current.delete(event.pointerId);
        // A finger left behind carries on as a drag from where the pinch left the graph.
        const remaining = pinch.ids.find((id) => id !== event.pointerId);
        const at = remaining === undefined ? undefined : touchesRef.current.get(remaining);
        if (touchPan && remaining !== undefined && at) {
          dragRef.current = { pointerId: remaining, clientX: at.x, clientY: at.y, view: viewRef.current };
        }
      } else {
        touchesRef.current.delete(event.pointerId);
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [emit, pinchedView, touchPan]
  );

  const zoomBy = useCallback(
    (factor: number) => {
      emit(zoomGraphView(viewRef.current, factor));
    },
    [emit]
  );

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
