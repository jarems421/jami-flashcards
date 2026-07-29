"use client";

import { clampNotebookThicknessPercent } from "@/lib/workspace/notebook-inking";

export default function ThicknessSlider({
  label,
  percent,
  color,
  previewWidth,
  onChange,
}: {
  label: string;
  percent: number;
  color: string;
  previewWidth: number;
  onChange: (value: number) => void;
}) {
  const clampedPercent = clampNotebookThicknessPercent(percent);
  const sliderId = `${label.toLowerCase().replace(/\s+/g, "-")}-slider`;
  const previewDot = Math.max(4, Math.min(24, previewWidth * 2));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <label
          className="text-xs font-semibold text-text-secondary"
          htmlFor={sliderId}
        >
          {label}
        </label>
        <span className="text-[0.68rem] font-semibold tabular-nums text-text-muted">
          {clampedPercent}%
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="relative flex h-8 flex-1 items-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 bg-[var(--color-border)]"
            style={{
              clipPath: "polygon(0 43%, 100% 12%, 100% 88%, 0 57%)",
              borderRadius: "999px",
            }}
          />
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={clampedPercent}
            aria-label={label}
            onChange={(event) => onChange(Number(event.target.value))}
            className="notebook-thickness-slider relative z-10 h-8 w-full cursor-pointer bg-transparent"
          />
        </div>
        <span className="inline-grid h-8 w-8 shrink-0 place-items-center">
          <span
            aria-hidden="true"
            className="rounded-full"
            style={{
              backgroundColor: color,
              width: `${previewDot}px`,
              height: `${previewDot}px`,
            }}
          />
        </span>
      </div>
    </div>
  );
}
