"use client";

import { useCallback, useEffect, useRef } from "react";

const STAR_GESTURE_BODY_CLASS = "jami-star-gesture-active";

/**
 * Keeps a finger on a star from scrolling the page.
 *
 * Whether a finger is currently on a star is a ref rather than state, read by
 * a listener attached for the life of the page, because the ordering is what
 * the whole bug was: both touch blockers used to be attached inside effects
 * keyed on the drag state, so `pointerdown` set state, React scheduled a
 * render, and the first `touchmove` arrived before the listener existed. iOS
 * decides on that first move whether a gesture scrolls the page, and once it
 * has decided, no `touch-action` and no later `preventDefault` takes it back --
 * which is why dragging a star up, or reaching down to the star below it, took
 * the page with it.
 *
 * Returns the switch a star's press turns on; any release anywhere turns it off.
 */
export function useStarGestureLock() {
  const starGestureRef = useRef(false);

  const setStarGesture = useCallback((active: boolean, pointerType?: string) => {
    starGestureRef.current = active;
    if (typeof document === "undefined") return;
    /*
     * The page-wide scroll lock is for fingers and pens only.
     *
     * A mouse drag never scrolls the page, and locking it removed the desktop
     * scrollbar for the length of the press -- the page grew by its width, and
     * the full-width sky, with stars placed in percentages, zoomed in a little
     * every time a star was clicked.
     */
    document.body.classList.toggle(STAR_GESTURE_BODY_CLASS, active && pointerType !== "mouse");
  }, []);

  useEffect(() => {
    // Listen on window because the sky is absent until its data has loaded.
    const refuseScroll = (event: TouchEvent) => {
      if (starGestureRef.current) event.preventDefault();
    };

    // Released anywhere -- on a star, on empty sky, off the page entirely.
    const endGesture = () => {
      setStarGesture(false);
    };

    window.addEventListener("touchmove", refuseScroll, { passive: false });
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
    window.addEventListener("touchend", endGesture);
    window.addEventListener("touchcancel", endGesture);

    return () => {
      window.removeEventListener("touchmove", refuseScroll);
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
      window.removeEventListener("touchend", endGesture);
      window.removeEventListener("touchcancel", endGesture);
    };
  }, [setStarGesture]);

  return setStarGesture;
}
