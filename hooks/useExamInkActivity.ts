"use client";

import { useCallback, useEffect, useRef } from "react";
import { shouldSuppressTouchAfterStylus } from "@/lib/workspace/notebook-inking";

/**
 * How long after the Pencil lifts that a touch is still taken for the hand
 * that was holding it. The notebook's own figure.
 */
const STYLUS_TOUCH_COOLDOWN_MS = 180;

/*
 * No scrolling at all while a stroke is being drawn.
 *
 * The practice page scrolls, and a notebook does not. A hand resting on the
 * question, the answer box or the margin scrolled the page under the pen, and
 * a stroke whose page moves mid-line jumps or smears. Installed only for the
 * length of a stroke: a document-wide non-passive touch listener slows every
 * scroll on the page, and between strokes a finger has to be free to move it.
 */
function lockTouchScrolling() {
  const block = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
  };
  const options: AddEventListenerOptions = { capture: true, passive: false };
  document.addEventListener("touchmove", block, options);
  return () => document.removeEventListener("touchmove", block, options);
}

/**
 * Whether the pen is on the working sheet, and whether a touch now is the
 * hand that holds it.
 *
 * Read from refs, never from state: everything that asks is a handler held
 * stable so the ink editor is not reconciled mid-stroke.
 */
export function useExamInkActivity() {
  const activeRef = useRef(false);
  /** Until when a touch is still taken for the hand that held the Pencil. */
  const cooldownUntilRef = useRef(0);
  const releaseTouchLockRef = useRef<(() => void) | null>(null);

  const isInking = useCallback(() => activeRef.current, []);

  /** The pen is down, or lifted so recently that a touch is still its hand. */
  const isHoldingPen = useCallback(
    () => activeRef.current || Date.now() < cooldownUntilRef.current,
    []
  );

  const isSuppressingTouch = useCallback(
    () =>
      shouldSuppressTouchAfterStylus({
        stylusActive: activeRef.current,
        cooldownUntil: cooldownUntilRef.current,
        now: Date.now(),
      }),
    []
  );

  const noteStroke = useCallback((active: boolean) => {
    activeRef.current = active;
    // While a stroke is live the cooldown never expires: the hand holding the
    // Pencil is on the page, and it is not asking to turn it.
    cooldownUntilRef.current = active ? Number.POSITIVE_INFINITY : Date.now() + STYLUS_TOUCH_COOLDOWN_MS;
    if (active) {
      releaseTouchLockRef.current ??= lockTouchScrolling();
      return;
    }
    releaseTouchLockRef.current?.();
    releaseTouchLockRef.current = null;
  }, []);

  useEffect(
    () => () => {
      releaseTouchLockRef.current?.();
      releaseTouchLockRef.current = null;
    },
    []
  );

  return { isInking, isHoldingPen, isSuppressingTouch, noteStroke };
}

export type ExamInkActivity = ReturnType<typeof useExamInkActivity>;
