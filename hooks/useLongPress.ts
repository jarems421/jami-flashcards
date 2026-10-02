"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

/** How long a press rests before it is a hold rather than a tap. */
export const LONG_PRESS_MS = 500;
/** A press that travels this far first is a scroll or a selection, not a hold. */
export const LONG_PRESS_SLOP_PX = 10;

export type LongPressHold<T extends HTMLElement> = {
  /** Where the press began, in viewport coordinates. */
  clientX: number;
  clientY: number;
  pointerType: string;
  element: T;
};

/**
 * Press and hold, for finger, Pencil and mouse alike.
 *
 * The hold fires while the pointer is still down, the way a phone's own
 * press-and-hold does, and the tap that the release would otherwise make is
 * swallowed so it cannot also act on whatever is underneath. A press that
 * moves is left alone -- it is a scroll, or a mouse selecting text -- and so is
 * a right click, which keeps the browser's own menu.
 *
 * This only listens. Stopping the browser's own hold (iOS starts selecting
 * text, or offers to save a picture) is the caller's styling: `select-none`
 * and `-webkit-touch-callout: none` on the element held.
 */
export function useLongPress<T extends HTMLElement>({
  enabled,
  onHold,
  ignoreSelector,
}: {
  enabled: boolean;
  onHold: (hold: LongPressHold<T>) => void;
  /** Parts of the element with gestures of their own: buttons, figures, graphs. */
  ignoreSelector?: string;
}) {
  const pressRef = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null);
  // Set once a hold has fired, until the click or context menu it leaves behind.
  const firedRef = useRef(false);
  const onHoldRef = useRef(onHold);

  useEffect(() => {
    onHoldRef.current = onHold;
  }, [onHold]);

  const cancel = useCallback(() => {
    if (!pressRef.current) return;
    window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!enabled) cancel();
  }, [cancel, enabled]);

  const onPointerDown = (event: ReactPointerEvent<T>) => {
    firedRef.current = false;
    cancel();
    if (!enabled || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (
      ignoreSelector &&
      event.target instanceof Element &&
      event.target.closest(ignoreSelector)
    ) {
      return;
    }
    const element = event.currentTarget;
    const { pointerId, clientX, clientY, pointerType } = event;
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      // A mouse that has selected something meanwhile was selecting, not holding.
      if (pointerType === "mouse" && window.getSelection()?.isCollapsed === false) return;
      firedRef.current = true;
      navigator.vibrate?.(15);
      onHoldRef.current({ clientX, clientY, pointerType, element });
    }, LONG_PRESS_MS);
    pressRef.current = { pointerId, x: clientX, y: clientY, timer };
  };

  const onPointerMove = (event: ReactPointerEvent<T>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX) {
      cancel();
    }
  };

  const onClickCapture = (event: ReactMouseEvent<T>) => {
    if (!firedRef.current) return;
    firedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  // Android opens its own menu on a long touch, at about the moment this fires.
  const onContextMenu = (event: ReactMouseEvent<T>) => {
    if (firedRef.current || pressRef.current) event.preventDefault();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture,
    onContextMenu,
  };
}
