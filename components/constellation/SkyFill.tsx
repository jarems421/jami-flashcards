"use client";

import { Button } from "@/components/ui";
import {
  getConstellationProgressPercent,
  type Constellation,
} from "@/lib/constellation/constellations";

/** How full the open sky is, and the way to finish it once it is full. */
export default function SkyFill({
  sky,
  canFinish,
  finishing,
  onFinish,
}: {
  sky: Constellation;
  /** True only for the active sky, once it is full. */
  canFinish: boolean;
  finishing: boolean;
  onFinish: () => void;
}) {
  const percent = getConstellationProgressPercent(sky);

  return (
    <>
      <div>
        <div className="mb-2 flex justify-between text-xs text-text-muted">
          <span>
            {sky.starCount} of {sky.maxStars} stars
          </span>
          <span>{percent}% filled</span>
        </div>
        <div className="h-2 rounded-full bg-glass-medium">
          <div
            className="h-2 rounded-full bg-accent transition-all duration-slow"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/*
       * Finishing, offered where it applies and only when it can be done. It
       * used to be a permanently disabled button in the page header reading
       * "Finish at 40 stars" -- a control that spends almost its whole life
       * explaining why it does not work.
       */}
      {canFinish ? (
        <div className="app-subtle-panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">This sky is full</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Finish it to keep it as a record, and a new sky starts collecting your next stars.
              You can still rearrange this one and draw on it afterwards.
            </p>
          </div>
          <Button type="button" className="shrink-0" disabled={finishing} onClick={onFinish}>
            {finishing ? "Finishing..." : "Finish this sky"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
