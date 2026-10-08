"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clampPercentage, SKY_CONTAINER_ID, type NormalizedStar } from "@/lib/constellation/stars";

/**
 * Joining two stars in Connect mode, by dragging from one to the other or by
 * tapping one and then the other.
 *
 * Tracks the star a line starts from, where its loose end is, and which star
 * it is over. The star under the pointer is tracked during the drag rather than
 * only read on release, so the line can snap to it and the star can light up.
 * Dropping a line used to be aimed blind: nothing on screen said whether
 * letting go would join anything.
 */
export function useConstellationLinking({
  toggleLine,
}: {
  toggleLine: (fromStarId: string, toStarId: string) => void;
}) {
  const [linkFromStarId, setLinkFromStarId] = useState<string | null>(null);
  const [linkPoint, setLinkPoint] = useState<{ x: number; y: number } | null>(null);
  const [linkHoverStarId, setLinkHoverStarId] = useState<string | null>(null);
  /**
   * Whether the press now in progress already settled what it meant.
   *
   * Pressing a second star finishes the line there and then, so the release
   * that follows has nothing left to do -- and would otherwise draw the same
   * line a second time, which is how a line is taken back. The release reads
   * this and stands down.
   */
  const linkPressResolvedRef = useRef(false);

  const clearLink = useCallback(() => {
    setLinkFromStarId(null);
    setLinkPoint(null);
    setLinkHoverStarId(null);
  }, []);

  /**
   * A press on a star in Connect mode.
   *
   * With nothing picked it picks this star, and the gesture carries on -- the
   * drag from here to another star is still the fast way to draw a line. With
   * something already picked, the press is the second half of a tap-and-tap:
   * another star joins the two, and the same star lets go of it. Both finish
   * here rather than waiting for the release, because a tap has no meaningful
   * release position and the hint has always said to choose a second star.
   */
  const beginOrFinishLink = useCallback(
    (star: NormalizedStar) => {
      if (!linkFromStarId) {
        linkPressResolvedRef.current = false;
        setLinkFromStarId(star.id);
        setLinkPoint(star.position);
        return;
      }

      linkPressResolvedRef.current = true;
      if (linkFromStarId !== star.id) {
        toggleLine(linkFromStarId, star.id);
      }
      clearLink();
    },
    [clearLink, toggleLine, linkFromStarId]
  );

  useEffect(() => {
    if (!linkFromStarId) {
      return;
    }

    const container = document.getElementById(SKY_CONTAINER_ID);
    if (!container) {
      return;
    }

    const trackTo = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      setLinkPoint({
        x: clampPercentage(((clientX - rect.left) / rect.width) * 100),
        y: clampPercentage(((clientY - rect.top) / rect.height) * 100),
      });
    };

    /*
     * Which star is under the pointer, asked of the document rather than
     * tracked with enter and leave handlers.
     *
     * A pointer that is down is captured, so the stars underneath it never
     * receive an enter event -- the only reliable way to know what is beneath
     * the finger is to ask the document directly. It is one hit test per move,
     * which is what buys the snap.
     */
    const starUnder = (clientX: number, clientY: number) => {
      const element = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-star-id]");

      return element?.dataset.starId ?? null;
    };

    const handleMove = (event: PointerEvent) => {
      trackTo(event.clientX, event.clientY);
      const under = starUnder(event.clientX, event.clientY);
      setLinkHoverStarId(under === linkFromStarId ? null : under);
    };

    /*
     * Safari decides whether a gesture scrolls the page on its first move, and
     * the sky's `touch-action` is what tells it not to. This is the second lock
     * on the same door, for the case where the finger has already left the sky.
     */
    const blockTouchScroll = (event: TouchEvent) => {
      event.preventDefault();
    };

    /*
     * Where the press ended decides what it meant.
     *
     * Landing on another star joins the two: that is the drag. Ending on the
     * star it began from leaves it picked, so a second star can be tapped
     * instead of dragged to. Ending on empty sky lets go of it -- a pick used
     * to survive that, so the only way out of one was to find another star, and
     * a half-drawn line followed the pointer around with no way to put it down.
     */
    const handleEnd = (event: PointerEvent) => {
      if (linkPressResolvedRef.current) {
        linkPressResolvedRef.current = false;
        return;
      }

      const releasedOn = starUnder(event.clientX, event.clientY);

      if (releasedOn && releasedOn !== linkFromStarId) {
        toggleLine(linkFromStarId, releasedOn);
        clearLink();
        return;
      }

      if (releasedOn === linkFromStarId) {
        setLinkPoint(null);
        setLinkHoverStarId(null);
        return;
      }

      clearLink();
    };

    const handleCancelKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearLink();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    window.addEventListener("keydown", handleCancelKey);
    window.addEventListener("touchmove", blockTouchScroll, { passive: false });

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      window.removeEventListener("keydown", handleCancelKey);
      window.removeEventListener("touchmove", blockTouchScroll);
    };
  }, [clearLink, toggleLine, linkFromStarId]);

  return { linkFromStarId, linkPoint, linkHoverStarId, beginOrFinishLink, clearLink };
}
