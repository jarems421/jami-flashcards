"use client";

import { useId } from "react";
import {
  clampNotebookPenSmoothing,
  getNotebookPenSmoothingLabel,
} from "@/lib/workspace/notebook-pen-feel";

/** Half the thumb: the distance its centre is inset at either end of travel. */
const THUMB_RADIUS = "9px";

/**
 * How hard the pen tidies the line.
 *
 * Named rather than shown as a bare percentage: the number means nothing on its
 * own, and the two ends are a genuine preference -- a fast joined-up hand wants
 * the line carried through, a careful printed one wants every point it made.
 */
export default function SmoothingSlider({
  percent,
  onChange,
}: {
  percent: number;
  onChange: (value: number) => void;
}) {
  const sliderId = useId();
  const clampedPercent = clampNotebookPenSmoothing(percent);
  const { name, description } = getNotebookPenSmoothingLabel(clampedPercent);
  // The thumb's centre never reaches the ends of the control, so the filled
  // part of the rail is measured against its travel rather than the full width.
  const filledTo = `calc(${THUMB_RADIUS} + (100% - ${THUMB_RADIUS} * 2) * ${
    clampedPercent / 100
  })`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <label
          className="text-xs font-semibold text-text-secondary"
          htmlFor={sliderId}
        >
          Smoothing
        </label>
        <span className="text-[0.68rem] font-semibold text-text-muted">
          {name}
        </span>
      </div>
      <div className="mt-1 flex h-8 items-center">
        <div className="relative flex h-8 flex-1 items-center">
          {/* A plain rail, end to end, with the travelled part filled. The
              fill is measured against the thumb's own travel rather than the
              full width, since the thumb centre stops half a thumb short of
              either end. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-border)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-selected-text)]"
            style={{ width: filledTo }}
          />
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={clampedPercent}
            aria-label="Pen smoothing"
            aria-valuetext={`${name}, ${clampedPercent}%`}
            onChange={(event) => onChange(Number(event.target.value))}
            className="notebook-thickness-slider relative z-10 h-8 w-full cursor-pointer bg-transparent"
          />
        </div>
      </div>
      <p className="px-0.5 text-[0.7rem] leading-4 text-text-secondary">
        {description}
      </p>
    </div>
  );
}
