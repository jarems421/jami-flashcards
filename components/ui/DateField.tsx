"use client";

import { useId } from "react";

/**
 * A date or time field that fits the space it is given.
 *
 * The native control is the picker -- every platform has a good one and none of
 * them agree on how it should look -- but it is not the thing on screen. Safari
 * lays `-webkit-date-and-time-edit` out at an intrinsic width that ignores its
 * container, so two bare `<input type="date">` fields in a two-column grid
 * overflowed their tracks and overlapped on an iPad, where the viewport is wide
 * enough to open the second column and the panel is not wide enough to hold it.
 *
 * So the value is drawn as ordinary text that truncates, the native input sits
 * invisibly on top of it and does all the work, and the whole thing is told it
 * may be narrower than it would like. That also buys a visible label: the two
 * fields it replaced were distinguishable only by `aria-label`, which is to say
 * only to a screen reader.
 */

export type DateFieldProps = {
  type?: "date" | "time" | "month";
  label: string;
  value: string;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  onValueChange: (value: string) => void;
};

function formatFieldValue(type: DateFieldProps["type"], value: string) {
  if (!value) return "";
  if (type === "time") return value;
  if (type === "month") {
    const [year, month] = value.split("-");
    return year && month ? `${month}/${year}` : value;
  }
  const [year, month, day] = value.split("-");
  // Written the way it is read here, which the native control does not
  // guarantee: its display follows the device locale, not the app's.
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[1.125rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.75v4.7l3.1 1.8" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[1.125rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="4" y="5.5" width="16" height="14" rx="2.25" />
      <path strokeLinecap="round" d="M8 3.75v3.5M16 3.75v3.5M4 9.25h16" />
    </svg>
  );
}

export default function DateField({
  type = "date",
  label,
  value,
  placeholder = "",
  min,
  max,
  disabled,
  className = "",
  onValueChange,
}: DateFieldProps) {
  const id = useId();
  const display = formatFieldValue(type, value);

  return (
    <div className={`date-field min-w-0 ${className}`}>
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
      >
        {label}
      </label>
      <div
        className={`app-field relative flex min-h-11 min-w-0 items-center gap-3 overflow-hidden rounded-lg px-4 py-2.5 ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <span
          aria-hidden="true"
          className={`min-w-0 flex-1 truncate text-sm ${
            value ? "text-[var(--color-field-text)]" : "text-[var(--color-field-placeholder)]"
          }`}
        >
          {display || placeholder}
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none flex shrink-0 text-[var(--color-field-placeholder)]"
        >
          {type === "time" ? <ClockIcon /> : <CalendarIcon />}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
          className="date-field-native absolute inset-0 z-10 h-full w-full cursor-pointer opacity-[0.001] disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}
