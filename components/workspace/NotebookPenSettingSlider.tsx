"use client";

import { useId } from "react";

/**
 * One named advanced pen control.
 *
 * The same shape as the Smoothing slider on the front of the panel -- a label,
 * the name of where it currently sits, and a line saying what that does -- but
 * without the drawn rail, which is Smoothing's alone: that rail illustrates the
 * one setting a reader can picture the result of, and repeating it under five
 * more would make five different things look like the same thing.
 */
export default function NotebookPenSettingSlider({
  label,
  name,
  description,
  percent,
  onChange,
  disabled = false,
}: {
  label: string;
  /** What the current position is called, shown instead of a bare percentage. */
  name: string;
  description: string;
  percent: number;
  onChange: (value: number) => void;
  /** Greyed while something else is deciding this control's value. */
  disabled?: boolean;
}) {
  const sliderId = useId();

  return (
    <div className={disabled ? "opacity-55" : undefined}>
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <label
          className="text-xs font-semibold text-text-secondary"
          htmlFor={sliderId}
        >
          {label}
        </label>
        <span className="text-2xs font-semibold text-text-muted">{name}</span>
      </div>
      <div className="mt-0.5 flex h-7 items-center">
        <div className="relative flex h-7 flex-1 items-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-border)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-selected-text)]"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            disabled={disabled}
            aria-label={label}
            aria-valuetext={`${name}, ${percent}%`}
            onChange={(event) => onChange(Number(event.target.value))}
            className="notebook-thickness-slider relative z-10 h-7 w-full cursor-pointer bg-transparent disabled:cursor-not-allowed"
          />
        </div>
      </div>
      <p className="px-0.5 text-2xs leading-4 text-text-secondary">
        {description}
      </p>
    </div>
  );
}
