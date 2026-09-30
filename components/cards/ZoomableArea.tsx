"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type View = { scale: number; x: number; y: number };

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
/** Travel before a press becomes a drag, and stops counting as a tap. */
const DRAG_THRESHOLD = 6;
const DOUBLE_TAP_MS = 300;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A picture that can be looked at closely: pinch or wheel to zoom, drag to
 * move around, double-tap to jump in and back out.
 *
 * Moved by transform, never by scrolling -- scrolling from a touch shakes the
 * page on iPad. A tap still reaches what is inside, so a diagram's boxes can
 * be uncovered at any zoom; a drag never does, so looking around never
 * uncovers one by accident.
 */
export default function ZoomableArea({
  children,
  className = "",
  label = "Zoomable picture",
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    kind: "pan" | "pinch";
    start: View;
    origin: { x: number; y: number };
    distance: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  /** Keeps the picture covering the frame: no panning off into empty space. */
  const bounded = useCallback((next: View): View => {
    const host = hostRef.current;
    const scale = clamp(next.scale, MIN_SCALE, MAX_SCALE);
    if (!host) return { ...next, scale };
    const { width, height } = host.getBoundingClientRect();
    return {
      scale,
      x: clamp(next.x, width * (1 - scale), 0),
      y: clamp(next.y, height * (1 - scale), 0),
    };
  }, []);

  /** Zoom to `scale`, keeping the point under `focus` (frame coordinates) where it is. */
  const zoomAt = useCallback(
    (from: View, scale: number, focus: { x: number; y: number }) => {
      const next = clamp(scale, MIN_SCALE, MAX_SCALE);
      const ratio = next / from.scale;
      return bounded({ scale: next, x: focus.x - (focus.x - from.x) * ratio, y: focus.y - (focus.y - from.y) * ratio });
    },
    [bounded]
  );

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Registered by hand: React's wheel listener is passive and cannot stop the page scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const focus = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView((current) => zoomAt(current, current.scale * Math.exp(-event.deltaY * 0.0022), focus));
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, local(event));
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      gesture.current = {
        kind: "pinch",
        start: view,
        origin: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        moved: true,
      };
      suppressClick.current = true;
    } else if (points.length === 1) {
      gesture.current = { kind: "pan", start: view, origin: points[0], distance: 0, moved: false };
      suppressClick.current = false;
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    const current = gesture.current;
    if (!current) return;
    const points = [...pointers.current.values()];
    if (current.kind === "pinch" && points.length >= 2) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const zoomed = zoomAt(current.start, current.start.scale * (distance / Math.max(1, current.distance)), current.origin);
      setView(bounded({ ...zoomed, x: zoomed.x + midpoint.x - current.origin.x, y: zoomed.y + midpoint.y - current.origin.y }));
      return;
    }
    if (current.kind !== "pan") return;
    const dx = points[0].x - current.origin.x;
    const dy = points[0].y - current.origin.y;
    if (!current.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      current.moved = true;
      suppressClick.current = true;
      // Only now, once it is a drag: capturing on press would steal the tap from the box under it.
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (current.start.scale > 1) setView(bounded({ ...current.start, x: current.start.x + dx, y: current.start.y + dy }));
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const point = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (pointers.current.size > 0) {
      // One finger left after a pinch carries on as a pan from where it is.
      const [remaining] = [...pointers.current.values()];
      gesture.current = { kind: "pan", start: view, origin: remaining, distance: 0, moved: true };
      return;
    }
    gesture.current = null;
    if (!point || !current || current.moved || event.type === "pointercancel") return;
    // A tap: a second one soon after, near the first, zooms in or back out.
    const now = Date.now();
    const previous = lastTap.current;
    if (previous && now - previous.at < DOUBLE_TAP_MS && Math.hypot(point.x - previous.x, point.y - previous.y) < 30) {
      lastTap.current = null;
      suppressClick.current = true;
      setView((currentView) =>
        currentView.scale > 1.05 ? { scale: 1, x: 0, y: 0 } : zoomAt(currentView, DOUBLE_TAP_SCALE, point)
      );
      return;
    }
    lastTap.current = { at: now, x: point.x, y: point.y };
  };

  const zoomBy = (factor: number) => {
    const host = hostRef.current;
    if (!host) return;
    const { width, height } = host.getBoundingClientRect();
    setView((current) => zoomAt(current, current.scale * factor, { x: width / 2, y: height / 2 }));
  };

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div
        ref={hostRef}
        role="group"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(event) => {
          // The end of a drag or pinch is not a tap on whatever it ended over.
          if (!suppressClick.current) return;
          event.stopPropagation();
          event.preventDefault();
          suppressClick.current = false;
        }}
        className={`h-full w-full touch-none overflow-hidden ${view.scale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {/* Room under the fitted picture keeps the controls off its bottom corner, where they would hide a box. */}
        <div
          className="h-full w-full origin-top-left pb-14"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {children}
        </div>
      </div>
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1 shadow-card">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={view.scale <= MIN_SCALE}
          onClick={() => zoomBy(1 / 1.5)}
          className="grid h-8 w-8 place-items-center rounded-full text-lg font-semibold text-text-primary transition hover:bg-[var(--color-glass-medium)] disabled:opacity-40"
        >
          −
        </button>
        <button
          type="button"
          aria-label="Fit the whole picture"
          disabled={view.scale <= MIN_SCALE}
          onClick={() => setView({ scale: 1, x: 0, y: 0 })}
          className="min-w-12 rounded-full px-2 text-xs font-medium tabular-nums text-text-secondary transition hover:bg-[var(--color-glass-medium)] disabled:opacity-60"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={view.scale >= MAX_SCALE}
          onClick={() => zoomBy(1.5)}
          className="grid h-8 w-8 place-items-center rounded-full text-lg font-semibold text-text-primary transition hover:bg-[var(--color-glass-medium)] disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
