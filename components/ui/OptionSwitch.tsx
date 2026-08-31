"use client";

import { useId } from "react";

export type OptionSwitchOption<Value extends string> = {
  value: Value;
  label: string;
  /** One line on what choosing this actually does. */
  detail?: string;
};

/**
 * Picks one of two or three ways of doing the same thing.
 *
 * Distinct from `ViewTabs`, which switches between *views* and is built
 * from links so each has its own address. This switches a *value* inside a
 * form, where there is no address to go to and the choice is not made until the
 * form is submitted.
 *
 * Both options stay legible whether or not they are chosen. Fading the
 * unselected one -- which is what hand-rolled versions of this kept doing --
 * hides half the decision from someone who has not made it yet, and this
 * control exists precisely at the moment they are deciding.
 */
export default function OptionSwitch<Value extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
  className = "",
}: {
  label: string;
  value: Value;
  options: readonly OptionSwitchOption<Value>[];
  disabled?: boolean;
  onChange: (value: Value) => void;
  className?: string;
}) {
  const labelId = useId();
  const hasDetail = options.some((option) => option.detail);

  return (
    <div className={className}>
      <span
        id={labelId}
        className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
      >
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={`grid gap-2 ${options.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded-2xl border px-4 text-left transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-60 ${
                hasDetail ? "py-3.5" : "min-h-[3.25rem] py-2"
              } ${
                selected
                  ? "border-accent/55 bg-accent/10 shadow-e1"
                  : "border-[var(--color-border)] bg-[var(--color-surface-panel)] hover:border-[var(--color-border-strong)]"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition duration-fast ${
                    selected
                      ? "border-accent bg-accent"
                      : "border-[var(--color-border-strong)]"
                  }`}
                >
                  {selected ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  ) : null}
                </span>
                <span
                  className={`text-sm font-semibold ${
                    selected ? "text-text-primary" : "text-text-secondary"
                  }`}
                >
                  {option.label}
                </span>
              </span>
              {option.detail ? (
                <span className="mt-1.5 block pl-6 text-xs leading-5 text-text-muted">
                  {option.detail}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
