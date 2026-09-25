"use client";

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampFloatingRect,
  cornerFloatingRect,
  maximisedFloatingRect,
  moveFloatingRect,
  parseStoredFloatingRect,
  resizeFloatingRect,
  restoreFloatingRectUnderPointer,
  type FloatingLimits,
  type FloatingRect,
  type FloatingResizeEdges,
  type FloatingViewport,
} from "@/lib/ui/floating-panel";
import {
  safelyReleasePointerCapture,
  safelySetPointerCapture,
} from "@/lib/workspace/notebook-interaction-lock";

type UseFloatingPanelOptions = {
  /** Where this panel's place and size are remembered on this device. */
  storageKey: string;
  /** The panel has no place while false, because it is not on screen. */
  enabled: boolean;
  /** Size for a first visit, before the student has moved or resized anything. */
  preferredSize: { width: number; height: number };
  limits: FloatingLimits;
};

type StoredFloatingPanel = {
  rect: FloatingRect;
  maximised: boolean;
};

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startRect: FloatingRect;
  lastRect: FloatingRect;
  resize: FloatingResizeEdges | null;
  /** Set while a full-size panel is held but has not yet been dragged out of it. */
  fromFull: FloatingRect | null;
};

/** How far a full-size panel must be dragged before it comes back to its own size. */
const LEAVE_FULL_SIZE_DISTANCE = 8;

/** Controls inside a drag handle keep their own tap; only bare handle drags. */
const HANDLE_CONTROL_SELECTOR =
  "button, a[href], input, textarea, select, summary, [role='button'], [role='menu'], [role^='menuitem']";

function subscribeToResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const readWidth = () => window.innerWidth;
const readHeight = () => window.innerHeight;
/** No window on the server: nothing floats until the browser has measured. */
const readNothing = () => 0;

function readViewport(): FloatingViewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

function readStored(storageKey: string): StoredFloatingPanel | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const rect = parseStoredFloatingRect((parsed as { rect?: unknown }).rect);
    if (!rect) return null;
    return { rect, maximised: (parsed as { maximised?: unknown }).maximised === true };
  } catch {
    // Storage can be unavailable in privacy modes; the corner default is safe.
    return null;
  }
}

function writeStored(storageKey: string, value: StoredFloatingPanel) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Non-critical local layout preference.
  }
}

/**
 * A panel the student can drag anywhere on screen and resize from any edge or
 * corner, within the viewport, up to the whole window.
 *
 * Where it was left is remembered per device, because a tablet and a laptop
 * want different places for it.
 */
export function useFloatingPanel({
  storageKey,
  enabled,
  preferredSize,
  limits,
}: UseFloatingPanelOptions) {
  // Only listens while on screen, so a hidden panel does not re-render its host on every resize.
  const subscribe = useCallback(
    (onChange: () => void) => (enabled ? subscribeToResize(onChange) : () => undefined),
    [enabled]
  );
  const width = useSyncExternalStore(subscribe, enabled ? readWidth : readNothing, readNothing);
  const height = useSyncExternalStore(subscribe, enabled ? readHeight : readNothing, readNothing);
  // Read once; after that this device's place is whatever the student last left.
  const [stored] = useState(() => readStored(storageKey));
  const [placed, setPlaced] = useState<FloatingRect | null>(stored?.rect ?? null);
  const [maximised, setMaximised] = useState(stored?.maximised ?? false);
  const gestureRef = useRef<Gesture | null>(null);
  const [activeGesture, setActiveGesture] = useState<"move" | "resize" | null>(null);

  /*
   * Derived on every render rather than stored clamped, so a rotation or a
   * window resize pulls the panel back on screen without forgetting the size
   * the student chose: it springs back if the room comes back.
   */
  const viewport: FloatingViewport = { width, height };
  const placedRect =
    width > 0
      ? placed
        ? clampFloatingRect(placed, viewport, limits)
        : cornerFloatingRect(preferredSize, viewport, limits)
      : null;
  const rect =
    placedRect && maximised ? maximisedFloatingRect(viewport, limits) : placedRect;

  const toggleMaximised = () => {
    if (!placedRect) return;
    setMaximised(!maximised);
    writeStored(storageKey, { rect: placedRect, maximised: !maximised });
  };

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    resize: FloatingResizeEdges | null
  ) => {
    if (!placedRect || !rect || (maximised && resize)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (
      !resize &&
      event.target instanceof Element &&
      event.target !== event.currentTarget &&
      event.target.closest(HANDLE_CONTROL_SELECTOR)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    safelySetPointerCapture(event.currentTarget, event.pointerId);
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: placedRect,
      lastRect: placedRect,
      resize,
      fromFull: maximised ? rect : null,
    };
    setActiveGesture(resize ? "resize" : "move");
  };

  const continueGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    const currentViewport = readViewport();
    if (gesture.fromFull) {
      /*
       * A full-size panel stays put for a tap or the first half of a double
       * click; only a real drag brings it back to its own size, under the hand.
       */
      const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (moved < LEAVE_FULL_SIZE_DISTANCE) return;
      gesture.startRect = restoreFloatingRectUnderPointer(
        gesture.startRect,
        gesture.fromFull,
        { x: gesture.startX, y: gesture.startY },
        currentViewport,
        limits
      );
      gesture.fromFull = null;
      setMaximised(false);
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const next = gesture.resize
      ? resizeFloatingRect(gesture.startRect, gesture.resize, dx, dy, currentViewport, limits)
      : moveFloatingRect(gesture.startRect, dx, dy, currentViewport, limits);
    gesture.lastRect = next;
    setPlaced(next);
  };

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setActiveGesture(null);
    safelyReleasePointerCapture(event.currentTarget, event.pointerId);
    // Held at full size and let go without dragging: nothing changed.
    if (gesture.fromFull) return;
    writeStored(storageKey, { rect: gesture.lastRect, maximised: false });
  };

  const dragHandleProps = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => beginGesture(event, null),
    onPointerMove: continueGesture,
    onPointerUp: endGesture,
    onPointerCancel: endGesture,
    // Like a window's title bar: a double click on bare header toggles full size.
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest(HANDLE_CONTROL_SELECTOR)) return;
      toggleMaximised();
    },
  };

  const getResizeHandleProps = (edges: FloatingResizeEdges) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => beginGesture(event, edges),
    onPointerMove: continueGesture,
    onPointerUp: endGesture,
    onPointerCancel: endGesture,
  });

  return {
    rect,
    maximised,
    /** What the student is doing to the panel right now, for feedback while they do it. */
    activeGesture,
    toggleMaximised,
    dragHandleProps,
    getResizeHandleProps,
  };
}
