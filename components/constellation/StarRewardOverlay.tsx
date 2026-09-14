"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import { ButtonLink } from "@/components/ui";
import { type NormalizedStar, type Star } from "@/lib/constellation/stars";

export type StarReward = { star: Star; goalName: string };

type StarRewardOverlayProps = {
  reward: StarReward | null;
  onDone: () => void;
};

/** Long enough to look at, short enough not to interrupt a run of reviews. */
const HOLD_MS = 4_000;
const FADE_MS = 400;

/**
 * Every reward star is drawn at this size, whatever the goal earned.
 *
 * Size carries meaning in the sky, where it grows with the goal behind it, but
 * a one-card goal's smallest star is a speck when it is the whole subject of
 * the screen. Its sparkles sit out beyond the tips, so the sky below leaves
 * room for them.
 */
const REWARD_STAR_SIZE = 72;

/**
 * The moment a goal turns into a star.
 *
 * The star is the one from the student's sky -- the same white light, bloom and
 * slow sparkles, drawn by the same component -- on a small window of the same
 * night. It used to be its own drawing that flew in on an arc, traced its
 * outline and trailed a constellation behind it, so the star earned here and
 * the star found in the sky looked like two different things, and the arrival
 * was busier than a pause between flashcards should be.
 *
 * Now it simply fades up and settles, then breathes. It holds for a few seconds
 * and leaves on its own, but it sits over the session rather than beside it, so
 * a tap anywhere or Escape ends it immediately for anyone mid-run.
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

  /*
   * What a screen reader is told.
   *
   * This said "Goal complete: {goalName}" for every star, including the one
   * for finishing the walkthrough -- which has no goal behind it at all, only
   * `goalId: ""` and the label "First study loop". A student using a reader
   * was told they had completed a goal they never set. The constellation page
   * already reads `rewardKind` to caption the same star correctly; this
   * follows it.
   */
  const announcement =
    reward.star.rewardKind === "onboarding"
      ? `Walkthrough complete: ${reward.star.rewardLabel ?? reward.goalName}`
      : `Goal complete: ${reward.goalName}`;

  // Centred in its window; where it sits in the real sky is the sky's business.
  const shownStar: NormalizedStar = {
    ...reward.star,
    position: { x: 50, y: 50 },
    needsBackfill: false,
  };

  return createPortal(
    <div
      className={`star-reward-overlay fixed inset-0 z-[95] flex items-center justify-center p-4 ${
        leaving ? "star-reward-overlay-leaving" : ""
      }`}
      role="status"
      aria-live="polite"
      onPointerDown={finish}
    >
      <div className="star-reward-card relative flex w-full max-w-xs flex-col items-center p-3 pb-6 text-center">
        <div className="star-reward-sky relative h-40 w-full overflow-hidden" aria-hidden="true">
          <div className="star-reward-star absolute inset-0">
            <ConstellationStar star={shownStar} variant="preview" visualSize={REWARD_STAR_SIZE} />
          </div>
        </div>
        <div className="star-reward-copy mt-5 flex flex-col items-center gap-1 px-3">
          <div className="text-2xs font-semibold uppercase tracking-[0.24em] text-text-muted">
            Star earned
          </div>
          <div className="max-w-[16rem] text-base font-semibold leading-snug text-text-primary">
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
      <span className="sr-only">{announcement}. You earned a star.</span>
    </div>,
    document.body
  );
}
