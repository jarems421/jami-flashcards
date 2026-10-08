"use client";

import { useEffect, useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { NotebookPagePan } from "@/lib/workspace/notebook-inking";
import {
  clearNotebookNativeSelection,
  installNotebookStylusTouchListeners,
} from "@/lib/workspace/notebook-interaction-lock";

/**
 * What keeps a gesture on the page from being left half-done or taken over.
 *
 * When the app loses focus or the page is hidden mid-gesture, nothing may be
 * left half-done, because the pointer that would have finished it is gone: a
 * text box drag ends, a pinch drops back to the committed pan, a page turn is
 * interrupted. And on the page surface, iPad Safari is stopped from taking a
 * Pencil stroke for a scroll.
 */
export function useNotebookInteractionGuards(input: {
  finishActiveTextBlockGesture: () => void;
  stylusInteractionRef: RefObject<boolean>;
  stylusCooldownUntilRef: RefObject<number>;
  cancelActivePinch: (options?: { clearPointers?: boolean }) => boolean;
  cancelPinchZoomAnimationFrame: () => void;
  setPagePan: Dispatch<SetStateAction<NotebookPagePan>>;
  pagePanLiveRef: RefObject<NotebookPagePan>;
  interruptPageTurn: () => void;
  pageSurfaceRef: RefObject<HTMLDivElement | null>;
  /** The open page, once its surface has been laid out; null until then. */
  readySurfacePageId: string | null;
  inkInteractionActiveRef: RefObject<boolean>;
}) {
  const {
    finishActiveTextBlockGesture,
    stylusInteractionRef,
    stylusCooldownUntilRef,
    cancelActivePinch,
    cancelPinchZoomAnimationFrame,
    setPagePan,
    pagePanLiveRef,
    interruptPageTurn,
    pageSurfaceRef,
    readySurfacePageId,
    inkInteractionActiveRef,
  } = input;

  useEffect(() => {
    const clearActiveInteractions = () => {
      finishActiveTextBlockGesture();
      stylusInteractionRef.current = false;
      stylusCooldownUntilRef.current = Date.now() + 180;
      // A pinch was interrupted (blur/app switch): drop its live transform
      // back to the last committed pan.
      cancelActivePinch({ clearPointers: true });
      // Teardown always resyncs pan, pinch or not, so an interrupted drag
      // cannot leave the committed pan behind the live one.
      setPagePan(pagePanLiveRef.current);
      interruptPageTurn();
      if (typeof document !== "undefined") {
        clearNotebookNativeSelection(document);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearActiveInteractions();
      }
    };

    window.addEventListener("blur", clearActiveInteractions);
    window.addEventListener("pagehide", clearActiveInteractions);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", clearActiveInteractions);
      window.removeEventListener("pagehide", clearActiveInteractions);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelPinchZoomAnimationFrame();
    };
  }, [
    cancelActivePinch,
    cancelPinchZoomAnimationFrame,
    finishActiveTextBlockGesture,
    interruptPageTurn,
    pagePanLiveRef,
    setPagePan,
    stylusCooldownUntilRef,
    stylusInteractionRef,
  ]);

  useLayoutEffect(() => {
    const surface = pageSurfaceRef.current;
    if (!surface || !readySurfacePageId || typeof window === "undefined") {
      return;
    }

    // iPadOS Safari hijacks horizontal Apple Pencil movement for a native
    // scroll/back gesture even when `touch-action: none` is set — it fires a
    // pointercancel mid-stroke and then needs a frame to settle before the next
    // pointerdown is delivered, which is why a stroke right after a horizontal
    // one fails to register. touch-action is not honored for the Pencil here,
    // but suppressing the underlying touch-event default is. We only cancel for
    // stylus input (or while ink is being drawn) and never over a text editor
    // or an interactive control, so Pencil taps and finger navigation remain
    // native while bare-page ink still blocks Safari navigation gestures.
    return installNotebookStylusTouchListeners({
      surface,
      getInkInteractionActive: () => inkInteractionActiveRef.current,
    });
  }, [inkInteractionActiveRef, pageSurfaceRef, readySurfacePageId]);
}
