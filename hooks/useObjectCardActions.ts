"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";

/** How long a finger rests on a card before its actions open. */
const HOLD_MS = 550;
/** A finger that travels further than this first is scrolling, not holding. */
const SLOP_PX = 10;

/**
 * A deck or notebook card's actions on a phone.
 *
 * Wider screens show the actions as a menu on the card. A phone has no room
 * for one, so a press and hold opens them as a sheet instead, the way a phone's
 * own long press does -- and the tap the release would otherwise make is
 * swallowed, so holding a card does not also open it. Taps inside the sheet
 * itself are left alone.
 */
export function useObjectCardActions(kind: "deck" | "notebook") {
  const [sheetOpen, setSheetOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !window.matchMedia("(max-width: 767px)").matches) {
      return;
    }
    clearLongPress();
    startRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      suppressClickRef.current = true;
      setSheetOpen(true);
      navigator.vibrate?.(20);
    }, HOLD_MS);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (
      Math.abs(event.clientX - start.x) > SLOP_PX ||
      Math.abs(event.clientY - start.y) > SLOP_PX
    ) {
      clearLongPress();
    }
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest(`[data-mobile-object-actions="${kind}"]`)
    ) {
      suppressClickRef.current = false;
      return;
    }
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  // The phone's own long-press menu would open over the sheet.
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia("(max-width: 767px) and (pointer: coarse)").matches) {
      event.preventDefault();
    }
  };

  const closeSheet = () => {
    suppressClickRef.current = false;
    setSheetOpen(false);
  };

  return {
    isOpen: sheetOpen,
    open: () => setSheetOpen(true),
    close: closeSheet,
    pressProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: clearLongPress,
      onPointerCancel: clearLongPress,
      onLostPointerCapture: clearLongPress,
      onClickCapture,
      onContextMenu,
    },
  };
}
