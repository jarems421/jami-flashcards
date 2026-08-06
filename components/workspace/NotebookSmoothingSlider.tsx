"use client";

import { useId } from "react";
import {
  clampNotebookPenSmoothing,
  getNotebookPenSmoothingLabel,
} from "@/lib/workspace/notebook-pen-feel";

/**
 * One continuous line, drawn the way the pen would draw it at each point along
 * the control: every turn kept on the left, curves carried through on the
 * right. It reads as a rail rather than as decoration only because it keeps the
 * same amplitude the whole way across -- a motif that flattens out towards one
 * end looks like a rail that stops halfway.
 */
const RAIL =
  "M0 7 L4 3 L8 11 L12 3 L16 11 L20 3 L24 11 L28 3 L32 11 L36 4 Q39 2 42 7 Q45 12 48 7 Q52 2 56 7 Q60 12 65 7 Q71 2 77 7 Q84 12 91 7 Q96 4 100 7";

/** Half the thumb: the distance its centre is inset at either end of travel. */
const THUMB_RADIUS = "9px";

function Rail({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 14"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-x-0 top-1/2 h-3.5 -translate-y-1/2 ${className}`}
    >
      <path
        d={RAIL}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

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
          <Rail className="text-[var(--color-border)]" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ clipPath: `inset(0 calc(100% - ${filledTo}) 0 0)` }}
          >
            <Rail className="text-[var(--color-selected-text)]" />
          </div>
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
      <div className="flex items-baseline justify-between gap-3 px-0.5 text-[0.65rem] leading-4 text-text-muted">
        <span>Every turn kept</span>
        <span>Curves carried through</span>
      </div>
      <p className="mt-1 px-0.5 text-[0.7rem] leading-4 text-text-secondary">
        {description}
      </p>
    </div>
  );
}
