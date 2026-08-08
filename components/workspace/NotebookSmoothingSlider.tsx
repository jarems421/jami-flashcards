"use client";

import { useId } from "react";
import {
  clampNotebookPenSmoothing,
  getNotebookPenSmoothingLabel,
} from "@/lib/workspace/notebook-pen-feel";

/** Half the thumb: the distance its centre is inset at either end of travel. */
const THUMB_RADIUS = "9px";

const RAIL_MIDDLE = 7;
const RAIL_AMPLITUDE = 4;
const RAIL_HALF_WAVES = 8;

/**
 * The rail: one wave of the same height the whole way across, drawn with
 * corners on the left and rounded through on the right -- the line the pen
 * makes at either end of the control.
 *
 * Built rather than written out because the last one was hand-tuned and tapered
 * off towards one end, so the wave ran out a quarter of the way along and the
 * thumb appeared to slide on nothing after it. Generated from a fixed half-wave
 * count, every peak reaches the same height and the last one lands exactly on
 * the far end.
 */
const RAIL = (() => {
  const step = 100 / RAIL_HALF_WAVES;
  const parts = [`M0 ${RAIL_MIDDLE}`];

  for (let index = 0; index < RAIL_HALF_WAVES; index += 1) {
    const to = (index + 1) * step;
    const peakX = index * step + step / 2;
    const reach = index % 2 === 0 ? -RAIL_AMPLITUDE : RAIL_AMPLITUDE;
    parts.push(
      index < RAIL_HALF_WAVES / 2
        ? // A point: straight up to the peak and straight back down.
          `L${peakX} ${RAIL_MIDDLE + reach} L${to} ${RAIL_MIDDLE}`
        : // A curve reaching the same peak, which a quadratic does with its
          // control twice as far out as the height it should touch.
          `Q${peakX} ${RAIL_MIDDLE + reach * 2} ${to} ${RAIL_MIDDLE}`
    );
  }
  return parts.join(" ");
})();

function Rail({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 100 ${RAIL_MIDDLE * 2}`}
      preserveAspectRatio="none"
      className={`pointer-events-none absolute left-0 top-1/2 h-3.5 w-full -translate-y-1/2 ${className}`}
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
        <span className="text-2xs font-semibold text-text-muted">
          {name}
        </span>
      </div>
      <div className="mt-1 flex h-8 items-center">
        <div className="relative flex h-8 flex-1 items-center">
          <Rail className="text-[var(--color-border)]" />
          {/* The travelled part, clipped to the thumb's own travel rather than
              to the full width, since the thumb centre stops half a thumb
              short of either end. */}
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
      <p className="px-0.5 text-2xs leading-4 text-text-secondary">
        {description}
      </p>
    </div>
  );
}
