"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/ui/reduced-motion";
import {
  getNotebookCreatePagePull,
  getNotebookPageDragIntent,
  getNotebookSwipeDragOffset,
  getNotebookSwipeReleaseDecision,
  getNotebookSwipeSettleDuration,
  getNotebookSwipeVelocity,
  NOTEBOOK_PAGE_SWIPE_VELOCITY_WINDOW_MS,
  shouldCreateNotebookPageOnRelease,
  shouldPointerSwipePages,
  type NotebookSwipeSample,
} from "@/lib/workspace/notebook-inking";

/**
 * A finger has to travel this far before the sheet decides what it means.
 *
 * Kept short of the slop a browser waits out before starting a scroll of its
 * own, so a sideways swipe is claimed before it can be taken for one.
 */
const PAN_START_DISTANCE = 8;
/** How far a committed page turn slides the sheet before it is replaced. */
const SWIPE_HANDOFF_TRAVEL = 0.32;
/** The notebook's settle curve, so a page lands here the way it lands there. */
const SWIPE_SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Enough recent positions to read a flick from; older ones say nothing. */
const SWIPE_SAMPLE_LIMIT = 12;

/**
 * One finger on the sheet, before it has said what it means.
 *
 * A drag is either the page moving under the frame or the page turning, and
 * which it is cannot be known at the moment of contact. So the contact is
 * recorded, nothing happens until it has travelled, and the first travel
 * decides: sideways on a fitted sheet turns the page, anything else is a
 * scroll. That is the notebook's rule, and the thresholds are the notebook's
 * own numbers -- turning a page should not be a different gesture here.
 */
type FingerGesture = {
  pointerId: number;
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  intent: "undecided" | "pan" | "swipe";
  /** Recent x positions, for the flick check on release. */
  samples: NotebookSwipeSample[];
  /** How far the sheet has been dragged, in px. */
  offset: number;
  /** The pull past the last page that asks for another sheet. */
  creating: boolean;
};

/**
 * What the sheet is, read at the moment a finger lifts rather than at the
 * moment it landed. The handlers here are held stable so the ink editor is
 * never reconciled mid-stroke, so they cannot close over it.
 */
export type ExamSheetSwipeTarget = {
  pageIndex: number;
  pageCount: number;
  canAddPage: boolean;
  disabled: boolean;
  zoom: number;
  /** The page as drawn on screen, in px. */
  pageWidth: number;
  goToPage: (index: number) => void;
  addPage: () => void;
};

/**
 * Turning the working sheet's pages with a finger, and pulling another sheet
 * in past the last one.
 *
 * Everything that moves during the gesture is written to the elements
 * directly, never through React state, so nothing re-renders under a finger.
 */
export function useExamSheetSwipe({
  frameRef,
  pageShellRef,
  addSheetHintRef,
  sheetRef,
  isInking,
}: {
  frameRef: RefObject<HTMLDivElement | null>;
  /** The track a page turn slides. */
  pageShellRef: RefObject<HTMLDivElement | null>;
  /** The ring that fills as the last page is pulled past. */
  addSheetHintRef: RefObject<HTMLDivElement | null>;
  sheetRef: RefObject<ExamSheetSwipeTarget>;
  isInking: () => boolean;
}) {
  const gestureRef = useRef<FingerGesture | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What a settling page turn does when it lands, so a new one can land it early. */
  const settleActRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = null;
    },
    []
  );

  /** Slides the sheet. Written to the element, never through React state. */
  const writeSheetOffset = useCallback(
    (offset: number, durationMs = 0) => {
      const shell = pageShellRef.current;
      if (!shell) return;
      shell.style.transition = durationMs > 0 ? `transform ${durationMs}ms ${SWIPE_SETTLE_EASING}` : "none";
      shell.style.transform = offset === 0 ? "" : `translate3d(${offset}px, 0, 0)`;
    },
    [pageShellRef]
  );

  /** The ring that fills as the last page is pulled past. */
  const writeCreatePull = useCallback(
    (progress: number) => {
      const hint = addSheetHintRef.current;
      if (!hint) return;
      const bounded = Math.max(0, Math.min(1, progress));
      hint.style.opacity = bounded <= 0 ? "0" : String(0.3 + bounded * 0.7);
      hint.style.transform = `translateY(-50%) scale(${0.72 + bounded * 0.28})`;
      const ring = hint.querySelector("[data-pull-ring]");
      if (ring instanceof SVGElement) {
        ring.style.strokeDashoffset = String(2 * Math.PI * 16 * (1 - bounded));
      }
    },
    [addSheetHintRef]
  );

  /*
   * Lets the sheet finish the movement the finger started, then acts.
   *
   * A page that changes under a finger still halfway through a swipe reads as
   * a glitch rather than a turn, so the committed direction is carried on a
   * little further and the page is replaced at the end of it. Reduced motion
   * skips straight to the new page.
   */
  const settleSheet = useCallback(
    (input: { fromOffset: number; targetOffset: number; velocityX: number; pageWidth: number; act?: () => void }) => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      const duration = getNotebookSwipeSettleDuration({
        currentOffset: input.fromOffset,
        targetOffset: input.targetOffset,
        travelDistance: input.pageWidth,
        velocityX: input.velocityX,
        reducedMotion: prefersReducedMotion(),
      });
      const finish = () => {
        settleTimer.current = null;
        settleActRef.current = null;
        writeSheetOffset(0);
        input.act?.();
      };
      if (duration <= 0) {
        finish();
        return;
      }
      settleActRef.current = finish;
      writeSheetOffset(input.targetOffset, duration);
      settleTimer.current = setTimeout(finish, duration);
    },
    [writeSheetOffset]
  );

  /*
   * Lands a page turn that is still settling, now.
   *
   * A finger that comes down again before the last turn has finished animating
   * is turning the next page. That used to clear the timer and drop the turn
   * with it, so a quick pair of flicks moved one page instead of two.
   */
  const landSettlingTurn = useCallback(() => {
    const land = settleActRef.current;
    if (!land) return;
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    land();
  }, []);

  const cancelGesture = useCallback(() => {
    gestureRef.current = null;
    writeCreatePull(0);
    writeSheetOffset(0);
  }, [writeCreatePull, writeSheetOffset]);

  /** The viewport took the finger for itself, so it was never a swipe. */
  const forgetCandidate = useCallback(() => {
    gestureRef.current = null;
  }, []);

  /** A sideways drag has been read as a page turn, which the browser must not scroll. */
  const isSwiping = useCallback(() => gestureRef.current?.intent === "swipe", []);

  /*
   * One finger on the sheet, once the viewport has passed on it.
   *
   * Sideways on a fitted page turns it, or pulls another sheet in past the
   * last one. Up and down is a scroll, and a scroll is the browser's: inline,
   * the practice page scrolls natively and takes the finger off the sheet with
   * a `pointercancel`; full screen there is nothing behind the sheet to move.
   * A zoomed page belongs to the viewport -- one finger moves it, two pinch it
   * -- and those never reach here.
   *
   * The sheet used to scroll the practice page itself, a `scrollBy` for every
   * move of the finger. On iPad that is a feedback loop: Safari reports a
   * touch against the scroll position the screen is showing, which trails the
   * one the page has just been given, so each scroll moved the finger it was
   * measured from and the page shook up and down under a finger held still.
   *
   * There used to be a size check here that dropped any contact wider than
   * 40px as a resting palm. iPadOS reports a fingertip at around that size, so
   * turning and scrolling failed for most fingers most of the time. The
   * notebook never measured contacts: it ignores touch while the Pencil is down
   * and for a moment after it lifts, which is when a palm is actually on the
   * glass, and the viewport now does the same here before this is reached.
   */
  const beginSwipe = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!shouldPointerSwipePages(event.pointerType)) return;
      if (isInking() || gestureRef.current) return;
      landSettlingTurn();
      gestureRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        intent: "undecided",
        samples: [{ x: event.clientX, time: event.timeStamp }],
        offset: 0,
        creating: false,
      };
      // The new-sheet ring waits level with the finger, rather than halfway
      // down a frame that can be taller than the screen.
      const hint = addSheetHintRef.current;
      const frame = frameRef.current;
      if (hint && frame) {
        const rect = frame.getBoundingClientRect();
        const top = Math.min(Math.max(event.clientY - rect.top, 48), Math.max(48, rect.height - 48));
        hint.style.top = `${top}px`;
      }
    },
    [addSheetHintRef, frameRef, isInking, landSettlingTurn]
  );

  const moveSwipe = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      // The pen wins every argument: a drag under a stroke is a resting hand.
      if (isInking()) {
        cancelGesture();
        return;
      }
      const dx = event.clientX - gesture.originX;
      const dy = event.clientY - gesture.originY;
      gesture.samples.push({ x: event.clientX, time: event.timeStamp });
      if (gesture.samples.length > SWIPE_SAMPLE_LIMIT) gesture.samples.shift();

      if (gesture.intent === "undecided") {
        if (Math.hypot(dx, dy) < PAN_START_DISTANCE) return;
        const intent = getNotebookPageDragIntent({
          axis: Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical",
          zoom: sheetRef.current.zoom,
        });
        gesture.intent = intent === "page" ? "swipe" : "pan";
      }

      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      // A scroll is the browser's; see `beginSwipe`.
      if (gesture.intent === "pan") return;

      const sheet = sheetRef.current;
      const pullingPastTheEnd =
        dx < 0 && sheet.pageIndex >= sheet.pageCount - 1 && sheet.canAddPage && !sheet.disabled;
      if (pullingPastTheEnd) {
        const pull = getNotebookCreatePagePull({ totalDx: dx, pageWidth: sheet.pageWidth });
        gesture.creating = true;
        gesture.offset = pull.resistedOffset;
        writeCreatePull(pull.progress);
        writeSheetOffset(pull.resistedOffset);
        return;
      }
      if (gesture.creating) {
        gesture.creating = false;
        writeCreatePull(0);
      }
      gesture.offset = getNotebookSwipeDragOffset({
        totalDx: dx,
        currentIndex: sheet.pageIndex,
        pageCount: sheet.pageCount,
      });
      writeSheetOffset(gesture.offset);
    },
    [cancelGesture, isInking, sheetRef, writeCreatePull, writeSheetOffset]
  );

  const endSwipe = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;
      writeCreatePull(0);
      if (gesture.intent !== "swipe") return;

      const sheet = sheetRef.current;
      const pageWidth = sheet.pageWidth;
      const totalDx = gesture.lastX - gesture.originX;
      const velocityX = getNotebookSwipeVelocity(gesture.samples, NOTEBOOK_PAGE_SWIPE_VELOCITY_WINDOW_MS);

      if (gesture.creating) {
        const creating =
          sheet.canAddPage && !sheet.disabled && shouldCreateNotebookPageOnRelease({ totalDx, pageWidth, velocityX });
        settleSheet({
          fromOffset: gesture.offset,
          targetOffset: creating ? -pageWidth * SWIPE_HANDOFF_TRAVEL : 0,
          velocityX,
          pageWidth,
          act: creating ? () => sheetRef.current.addPage() : undefined,
        });
        return;
      }

      const decision = getNotebookSwipeReleaseDecision({
        totalDx,
        pageWidth,
        velocityX,
        currentIndex: sheet.pageIndex,
        pageCount: sheet.pageCount,
      });
      const targetIndex = decision.targetIndex;
      settleSheet({
        fromOffset: gesture.offset,
        targetOffset: decision.shouldCommit
          ? (decision.direction === "next" ? -1 : 1) * pageWidth * SWIPE_HANDOFF_TRAVEL
          : 0,
        velocityX,
        pageWidth,
        act: decision.shouldCommit ? () => sheetRef.current.goToPage(targetIndex) : undefined,
      });
    },
    [settleSheet, sheetRef, writeCreatePull]
  );

  const cancelSwipe = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (gestureRef.current?.pointerId !== event.pointerId) return;
      cancelGesture();
    },
    [cancelGesture]
  );

  return { beginSwipe, moveSwipe, endSwipe, cancelSwipe, cancelGesture, forgetCandidate, isSwiping };
}
