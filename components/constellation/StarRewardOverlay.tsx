"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ButtonLink } from "@/components/ui";
import {
  NORTHERN_STAR_FACET_PATH,
  NORTHERN_STAR_PATH,
  northernStarTransform,
} from "@/components/ui/NorthernStar";
import { type Star } from "@/lib/constellation/stars";

export type StarReward = { star: Star; goalName: string };

type StarRewardOverlayProps = {
  reward: StarReward | null;
  onDone: () => void;
};

/** Long enough to look at, short enough not to interrupt a run of reviews. */
const HOLD_MS = 3_200;
const FADE_MS = 300;

/**
 * The trail the star arrives along, drawn as its own small constellation.
 *
 * The companions sit under the flight path rather than anywhere decorative, so
 * the arc the star flies in on and the constellation it joins are the same
 * line. They are placed clear of the star's arms; the lone mark at the top
 * right stops the whole drawing leaning into one corner.
 */
const TRAIL = [
  { x: -4, y: 130, size: 15 },
  { x: 30, y: 156, size: 11 },
  { x: 74, y: 169, size: 8 },
  { x: 119, y: 161, size: 12 },
  { x: 157, y: 135, size: 9 },
] as const;

/**
 * The star is drawn in its own 160 box; the viewBox is wider than that on
 * purpose, and the margin is where the constellation lives.
 *
 * Packed inside the star's own box the companions had nowhere to go but under
 * its arms, where they read as specks rather than as a shape the star is
 * joining.
 */
const MARK_VIEW_BOX = "-20 -14 200 200";

function NorthernStarMark() {
  return (
    <svg viewBox={MARK_VIEW_BOX} className="h-full w-full" aria-hidden="true">
      <g className="star-reward-orbit">
        <polyline
          points={TRAIL.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {TRAIL.map((point) => (
          <path
            key={`${point.x}-${point.y}`}
            d={NORTHERN_STAR_PATH}
            transform={northernStarTransform(point.x, point.y, point.size)}
            fill="currentColor"
          />
        ))}
        <path
          d={NORTHERN_STAR_PATH}
          transform={northernStarTransform(152, 22, 9)}
          fill="currentColor"
        />
      </g>
      <path
        className="star-reward-trace"
        d={NORTHERN_STAR_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path className="star-reward-core" d={NORTHERN_STAR_PATH} fill="currentColor" />
      <path
        className="star-reward-cut"
        d={NORTHERN_STAR_FACET_PATH}
        fill="var(--color-surface-base)"
      />
    </svg>
  );
}

/**
 * The moment a goal turns into a star.
 *
 * Every reward draws the same northern star at the same size, whatever the
 * star written to the constellation looks like. Size and preset carry meaning
 * on the canvas -- they grow with the goal behind them -- and a one-card goal's
 * smallest star reads as a speck when it is the entire subject of the screen.
 * So this is the shape of the reward rather than a preview of the object, and
 * the constellation page is where the real one is found.
 *
 * It holds for a few seconds and leaves on its own, but it sits over the
 * session rather than beside it, so a tap anywhere or Escape ends it
 * immediately for anyone mid-run.
 */
export default function StarRewardOverlay({ reward, onDone }: StarRewardOverlayProps) {
  const [leavingStarId, setLeavingStarId] = useState<string | null>(null);
  const leavingStarIdRef = useRef<string | null>(null);
  const doneTimerRef = useRef<number | null>(null);
  // Held in a ref so a parent re-render cannot restart the timers below.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const starId = reward?.star.id;
  const leaving = Boolean(starId && leavingStarId === starId);

  const finish = useCallback(() => {
    if (!starId || leavingStarIdRef.current === starId) return;
    leavingStarIdRef.current = starId;
    setLeavingStarId(starId);
    doneTimerRef.current = window.setTimeout(
      () => onDoneRef.current(),
      FADE_MS
    );
  }, [starId]);

  useEffect(() => {
    if (!starId) return;
    leavingStarIdRef.current = null;
    const fadeAt = window.setTimeout(finish, HOLD_MS);
    return () => {
      window.clearTimeout(fadeAt);
      if (doneTimerRef.current !== null) {
        window.clearTimeout(doneTimerRef.current);
        doneTimerRef.current = null;
      }
    };
  }, [finish, starId]);

  useEffect(() => {
    if (!starId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Nothing else should also close on this Escape: the celebration is the
      // topmost thing on screen, so it is the thing being dismissed.
      event.stopPropagation();
      finish();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [finish, starId]);

  if (!reward || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`star-reward-overlay fixed inset-0 z-[95] flex items-center justify-center p-4 ${
        leaving ? "star-reward-overlay-leaving" : ""
      }`}
      role="status"
      aria-live="polite"
      onPointerDown={finish}
    >
      <div
        className="star-reward-card relative flex w-full max-w-sm flex-col items-center px-8 pb-7 pt-9 text-center"
      >
        <div className="star-reward-arc">
          <div className="star-reward-star relative h-32 w-32 text-text-primary sm:h-36 sm:w-36">
            <NorthernStarMark />
          </div>
        </div>
        <div className="star-reward-copy relative mt-1 flex flex-col items-center gap-1.5">
          <div className="text-2xs font-semibold uppercase tracking-[0.24em] text-text-muted">
            Star earned
          </div>
          <div className="max-w-[17rem] text-lg font-semibold leading-snug text-text-primary">
            {reward.goalName}
          </div>
          <ButtonLink
            href="/dashboard/constellation"
            variant="secondary"
            size="sm"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onDoneRef.current()}
            className="mt-4"
          >
            View Stars
          </ButtonLink>
          <p className="mt-2 text-2xs text-text-muted">Tap anywhere to continue</p>
        </div>
      </div>
      <span className="sr-only">
        Goal complete: {reward.goalName}. You earned a star.
      </span>
    </div>,
    document.body
  );
}
