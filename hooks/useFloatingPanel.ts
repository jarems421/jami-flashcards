"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampFloatingRect,
  cornerFloatingRect,
  floatingRectClearOf,
  floatingRectClearOfAll,
  floatingRectsOverlap,
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
  /** The bottom corner it starts in. Right unless it would sit on the Tutor card. */
  side?: "left" | "right";
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

/**
 * What a press on the panel's body leaves alone: controls, anything typed
 * into, pictures and graphs (which pan, zoom and add themselves to pages), and
 * anything marked as having a gesture of its own. Text is checked separately,
 * by what is actually under the pointer, so it can still be selected.
 */
const BODY_KEEP_SELECTOR = `${HANDLE_CONTROL_SELECTOR}, label, [contenteditable=''], [contenteditable='true'], img, svg, canvas, video, iframe, [data-floating-no-drag]`;

/** How long a finger rests in a scrolling list before the press moves the panel instead. */
const TOUCH_HOLD_MS = 300;
/** A finger that travels this far before then is scrolling, not holding. */
const TOUCH_HOLD_SLOP = 8;

/** Whether the point is over a run of text, rather than the space around it. */
function pointIsOnText(x: number, y: number) {
  if (typeof document === "undefined") return false;
  const caretDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
  };
  const node =
    caretDocument.caretRangeFromPoint?.(x, y)?.startContainer ??
    caretDocument.caretPositionFromPoint?.(x, y)?.offsetNode ??
    null;
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
  // The caret lands on the nearest text even from empty space; only a hit on the text's own box counts.
  const range = document.createRange();
  range.selectNodeContents(node);
  return Array.from(range.getClientRects()).some(
    (box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
  );
}

/** Whether something between the target and the panel scrolls, so a swipe there means scroll. */
function isInScrollingArea(target: Element, panel: Element) {
  for (let element: Element | null = target; element && element !== panel; element = element.parentElement) {
    if (element.scrollHeight > element.clientHeight + 1) {
      const overflow = window.getComputedStyle(element).overflowY;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

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
  side = "right",
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
        : cornerFloatingRect(preferredSize, viewport, limits, side)
      : null;
  const rect =
    placedRect && maximised ? maximisedFloatingRect(viewport, limits) : placedRect;

  const toggleMaximised = () => {
    if (!placedRect) return;
    setMaximised(!maximised);
    writeStored(storageKey, { rect: placedRect, maximised: !maximised });
  };

  /** Starts a move or resize from where the pointer is now. */
  const startGestureAt = (
    pointerId: number,
    x: number,
    y: number,
    resize: FloatingResizeEdges | null
  ) => {
    if (!placedRect || !rect) return false;
    gestureRef.current = {
      pointerId,
      startX: x,
      startY: y,
      startRect: placedRect,
      lastRect: placedRect,
      resize,
      fromFull: maximised ? rect : null,
    };
    setActiveGesture(resize ? "resize" : "move");
    return true;
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
    startGestureAt(event.pointerId, event.clientX, event.clientY, resize);
  };

  const continueGestureAt = (pointerId: number, x: number, y: number) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return false;
    const currentViewport = readViewport();
    if (gesture.fromFull) {
      /*
       * A full-size panel stays put for a tap or the first half of a double
       * click; only a real drag brings it back to its own size, under the hand.
       */
      const moved = Math.hypot(x - gesture.startX, y - gesture.startY);
      if (moved < LEAVE_FULL_SIZE_DISTANCE) return true;
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
    const dx = x - gesture.startX;
    const dy = y - gesture.startY;
    const next = gesture.resize
      ? resizeFloatingRect(gesture.startRect, gesture.resize, dx, dy, currentViewport, limits)
      : moveFloatingRect(gesture.startRect, dx, dy, currentViewport, limits);
    gesture.lastRect = next;
    setPlaced(next);
    return true;
  };

  const continueGesture = (event: ReactPointerEvent<HTMLElement>) => {
    if (continueGestureAt(event.pointerId, event.clientX, event.clientY)) event.preventDefault();
  };

  const endGestureFor = (pointerId: number) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return false;
    gestureRef.current = null;
    setActiveGesture(null);
    // Held at full size and let go without dragging: nothing changed.
    if (!gesture.fromFull) writeStored(storageKey, { rect: gesture.lastRect, maximised: false });
    return true;
  };

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    if (endGestureFor(event.pointerId)) {
      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
    }
  };

  /*
   * A finger resting in the conversation, waiting to see whether it is a
   * scroll or a hold. Listened for on the window because the browser, not the
   * panel, owns a touch that might yet become a scroll.
   */
  const holdRef = useRef<(() => void) | null>(null);
  const cancelHold = () => {
    holdRef.current?.();
    holdRef.current = null;
  };
  useEffect(
    () => () => {
      holdRef.current?.();
      holdRef.current = null;
    },
    []
  );

  const armTouchHold = (pointerId: number, startX: number, startY: number) => {
    cancelHold();
    let armed = false;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (!armed) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > TOUCH_HOLD_SLOP) cancelHold();
        return;
      }
      continueGestureAt(pointerId, event.clientX, event.clientY);
    };
    const onEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (armed) endGestureFor(pointerId);
      cancelHold();
    };
    // Once held, the finger carries the panel: the list under it must not scroll as well.
    const holdScroll = (event: TouchEvent) => {
      if (armed && event.cancelable) event.preventDefault();
    };
    const timer = window.setTimeout(() => {
      armed = startGestureAt(pointerId, startX, startY, null);
      if (!armed) cancelHold();
    }, TOUCH_HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("touchmove", holdScroll, { passive: false });
    holdRef.current = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("touchmove", holdScroll);
      if (armed) endGestureFor(pointerId);
    };
  };

  /**
   * The whole panel, as somewhere to pick it up.
   *
   * Only the header used to move it, marked by a grab bar; now any bare part
   * does -- padding, the gaps between messages, the space around the composer.
   * Text, controls, pictures and graphs keep their own gestures, and the
   * resize handles sit over the edges in a layer of their own, so neither a
   * selection nor a resize can turn into a move.
   */
  const onBodyPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (gestureRef.current || !placedRect || !rect) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(BODY_KEEP_SELECTOR) || pointIsOnText(event.clientX, event.clientY)) return;
    if (event.pointerType === "touch" && isInScrollingArea(target, event.currentTarget)) {
      armTouchHold(event.pointerId, event.clientX, event.clientY);
      return;
    }
    beginGesture(event, null);
  };

  const bodyDragProps = {
    onPointerDown: onBodyPointerDown,
    onPointerMove: continueGesture,
    onPointerUp: endGesture,
    onPointerCancel: endGesture,
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

  /**
   * Moves the panel off another one it would cover, remembering where it went.
   *
   * Callable before the panel is on screen -- in the same tap that brings it
   * up -- so it works from this device's saved place, or the corner default,
   * against the live viewport. A full-size panel covers everything, so it
   * comes back to its own size to be moved.
   */
  const moveClearOf = (other: FloatingRect | FloatingRect[]) => {
    const currentViewport = readViewport();
    const own = placed
      ? clampFloatingRect(placed, currentViewport, limits)
      : cornerFloatingRect(preferredSize, currentViewport, limits, side);
    const others = Array.isArray(other) ? other : [other];
    if (!maximised && others.every((rect) => !floatingRectsOverlap(own, rect))) return;
    const clear =
      others.length === 1
        ? floatingRectClearOf(own, others[0], currentViewport, limits)
        : floatingRectClearOfAll(own, others, currentViewport, limits);
    setPlaced(clear);
    setMaximised(false);
    writeStored(storageKey, { rect: clear, maximised: false });
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
    moveClearOf,
    dragHandleProps,
    /** For the panel itself: any bare part of it picks it up. */
    bodyDragProps,
    getResizeHandleProps,
  };
}
