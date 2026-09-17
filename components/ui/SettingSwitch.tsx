"use client";

import type { ReactNode } from "react";

type SettingSwitchProps = {
  label: string;
  /** A line under the label saying what turning it on does. */
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /**
   * `compact` is for a floating panel, where the surrounding type is smaller
   * and the row cannot afford a form's breathing space.
   */
  density?: "comfortable" | "compact";
  className?: string;
};

/**
 * One thing that is either on or off.
 *
 * A bare `input type="checkbox"` was being used for these, tinted with
 * `accent-accent` and paired with a label -- which gives a 16px target on a
 * tablet, where the whole point is to be tapped with a finger. The row itself
 * is the control here, so anywhere along it will do.
 */
export default function SettingSwitch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  density = "comfortable",
  className = "",
}: SettingSwitchProps) {
  const compact = density === "compact";

  return (
    <button
      type="button"
      role="switch"
      // Named explicitly so the line underneath stays a description rather than
      // becoming part of the control's name.
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl text-left transition hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50 ${
        compact ? "px-1" : "px-2"
      } ${className}`}
    >
      <span className="min-w-0">
        <span
          className={`block font-semibold text-text-primary ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {label}
        </span>
        {description ? (
          <span
            className={`mt-0.5 block leading-4 text-text-secondary ${
              compact ? "text-2xs" : "text-xs"
            }`}
          >
            {description}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-10 shrink-0 rounded-full border transition ${
          checked
            ? "border-transparent bg-[var(--color-selected-text)]"
            : "border-[var(--color-border-strong)] bg-[var(--color-glass-subtle)]"
        }`}
      >
        <span
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-[left] ${
            checked ? "left-[1.25rem]" : "left-[0.15rem]"
          }`}
        />
      </span>
    </button>
  );
}
