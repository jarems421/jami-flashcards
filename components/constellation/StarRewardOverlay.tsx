"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import ConstellationStar from "@/components/constellation/ConstellationStar";
import {
  getEffectiveStarVisualSize,
  normalizeStar,
  type Star,
} from "@/lib/constellation/stars";

export type StarReward = { star: Star; goalName: string };

type StarRewardOverlayProps = {
  reward: StarReward | null;
  onDone: () => void;
};

/** Long enough to look at, short enough not to interrupt a run of reviews. */
const HOLD_MS = 3_200;
const FADE_MS = 520;

/**
 * How big the star is drawn here, in pixels.
 *
 * On the constellation a star's size carries meaning - it grows with the goal
 * behind it, and a one-card goal earns the smallest one there is. That reads as
 * a speck when the star is the entire subject of the screen, so the reward
 * always draws at a fixed hero size and leaves size to mean something back on
 * the canvas.
 */
const HERO_STAR_PX = 132;

/**
 * The moment a goal turns into a star.
 *
 * Shows the star that was actually written to the constellation, so what
 * appears here is the same shape and colour the student will find on the Stars
 * page rather than a generic badge. It sits above the session without taking
 * pointer events, because finishing a goal should not interrupt a run of
 * reviews; it arrives, holds, and leaves on its own.
 */
export default function StarRewardOverlay({ reward, onDone }: StarRewardOverlayProps) {
  const [leaving, setLeaving] = useState(false);
  // Held in a ref so a parent re-render cannot restart the timers below.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const starId = reward?.star.id;

  useEffect(() => {
    if (!starId) return;

    const fadeAt = window.setTimeout(() => setLeaving(true), HOLD_MS);
    const doneAt = window.setTimeout(() => onDoneRef.current(), HOLD_MS + FADE_MS);

    return () => {
      window.clearTimeout(fadeAt);
      window.clearTimeout(doneAt);
    };
  }, [starId]);

  if (!reward || typeof document === "undefined") return null;

  // The star positions itself by percentage inside its container, so centring
  // it here reuses the constellation rendering without touching that component.
  const centred = normalizeStar({ ...reward.star, position: { x: 50, y: 50 } });
  const naturalSize = getEffectiveStarVisualSize(centred);
  const heroScale = HERO_STAR_PX / Math.max(1, naturalSize);

  return createPortal(
    <div
      className={`star-reward-overlay pointer-events-none fixed inset-0 z-[95] flex items-center justify-center ${
        leaving ? "star-reward-overlay-leaving" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="star-reward-card relative flex flex-col items-center px-10 pb-8 pt-6 text-center">
        <div className="star-reward-bloom" aria-hidden="true" />
        <div
          className="star-reward-star relative"
          aria-hidden="true"
          style={{ height: `${HERO_STAR_PX}px`, width: `${HERO_STAR_PX}px` }}
        >
          <div
            className="absolute inset-0"
            style={{
              transform: `scale(${heroScale})`,
              transformOrigin: "center",
            }}
          >
            <ConstellationStar star={centred} variant="preview" label={reward.goalName} />
          </div>
        </div>
        <div className="star-reward-copy relative flex flex-col items-center gap-1.5">
          <div className="text-2xs font-semibold uppercase tracking-[0.24em] text-text-muted">
            Star earned
          </div>
          <div className="max-w-[17rem] text-lg font-semibold leading-snug text-text-primary">
            {reward.goalName}
          </div>
        </div>
      </div>
      <span className="sr-only">
        Goal complete: {reward.goalName}. You earned a star.
      </span>
    </div>,
    document.body
  );
}
