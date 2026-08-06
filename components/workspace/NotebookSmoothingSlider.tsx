"use client";

import {
  clampNotebookPenSmoothing,
  getNotebookPenSmoothingLabel,
} from "@/lib/workspace/notebook-pen-feel";

const SLIDER_ID = "pen-smoothing-slider";

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
  const clampedPercent = clampNotebookPenSmoothing(percent);
  const { name, description } = getNotebookPenSmoothingLabel(clampedPercent);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <label
          className="text-xs font-semibold text-text-secondary"
          htmlFor={SLIDER_ID}
        >
          Smoothing
        </label>
        <span className="text-[0.68rem] font-semibold text-text-muted">
          {name}
        </span>
      </div>
      <div className="mt-1 flex h-8 items-center">
        <div className="relative flex h-8 flex-1 items-center">
          <svg
            aria-hidden="true"
            viewBox="0 0 100 12"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 text-[var(--color-border)]"
          >
            {/* Jagged at the faithful end, flowing at the other: the track
                itself says which way the control goes. */}
            <path
              d="M0 6 L8 2 L14 10 L22 3 L28 9 L36 4 L44 8 Q54 1 62 6 Q70 11 78 6 Q86 1 100 6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <input
            id={SLIDER_ID}
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
      <p className="mt-0.5 px-0.5 text-[0.7rem] leading-4 text-text-secondary">
        {description}
      </p>
    </div>
  );
}
