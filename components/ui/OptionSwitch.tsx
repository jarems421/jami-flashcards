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
 *
 * The row lays itself out by the room it has, not the screen it is on. The
 * same four choices sit on a full page and inside the Tutor's card, which a
 * student can shrink to a sliver of a laptop screen; columns chosen by the
 * screen kept four across there and squeezed each label into a column of
 * single words. `.option-switch` in globals.css holds the widths.
 */
export default function OptionSwitch<Value extends string>({
  label,
  hideLabel = false,
  value,
  options,
  disabled = false,
  onChange,
  className = "",
  columns,
  detail = "always",
}: {
  label: string;
  /**
   * Keep the label for screen readers but do not draw it.
   *
   * For a surface that already asks the question in a heading above the
   * control, where drawing the label again would say the same thing twice. The
   * label stays required either way, because the radiogroup still has to be
   * named for anyone not reading the heading.
   */
  hideLabel?: boolean;
  value: Value;
  options: readonly OptionSwitchOption<Value>[];
  disabled?: boolean;
  onChange: (value: Value) => void;
  className?: string;
  /**
   * How many across when there is room: the default is two for two options and
   * three for three. With less room the row wraps to fewer, down to one.
   */
  columns?: 2 | 3 | 4 | 5;
  /**
   * Where the details go.
   *
   * `always` puts every option's line under its own tile, which is right when
   * there are two or three and the whole decision should be readable at once.
   * `selected` moves them to a single line beneath the row, which is right once
   * there are five: five explanations stacked on a phone is a page of reading
   * in front of somebody who only wanted to start studying.
   */
  detail?: "always" | "selected";
}) {
  const labelId = useId();
  const hasDetail = detail === "always" && options.some((option) => option.detail);
  const selectedDetail =
    detail === "selected"
      ? options.find((option) => option.value === value)?.detail
      : undefined;
  const across = columns ?? (options.length === 3 ? 3 : 2);

  return (
    <div className={`option-switch ${className}`}>
      <span
        id={labelId}
        className={
          hideLabel
            ? "sr-only"
            : "mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
        }
      >
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        data-columns={across}
        className="option-switch-grid grid gap-2"
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
              {hasDetail && option.detail ? (
                <span className="mt-1.5 block pl-6 text-xs leading-5 text-text-muted">
                  {option.detail}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {selectedDetail ? (
        <p
          aria-live="polite"
          className="mt-2 text-xs leading-5 text-text-muted"
        >
          {selectedDetail}
        </p>
      ) : null}
    </div>
  );
}
