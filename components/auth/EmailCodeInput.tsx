"use client";

import { useId, useState } from "react";
import {
  EMAIL_CODE_LENGTH,
  sanitiseEmailCodeInput,
} from "@/lib/auth/email-code";

type EmailCodeInputProps = {
  value: string;
  onChange: (code: string) => void;
  /** The whole code, as soon as the last digit lands. */
  onComplete?: (code: string) => void;
  label?: string;
  size?: "md" | "sm";
  disabled?: boolean;
  /** Put the cursor in it as soon as it appears. */
  focusOnMount?: boolean;
};

const BOX_SIZES = {
  md: "h-14 text-2xl sm:h-16 sm:text-3xl",
  sm: "h-9 w-8 text-base",
} as const;

/**
 * Six boxes for an emailed code, backed by a single real input.
 *
 * One input rather than six is what keeps the things people actually do
 * working: pasting the whole code, iOS and Android offering it from the mail
 * (`one-time-code`), backspacing across boxes, and a screen reader hearing one
 * field instead of six. The boxes are only its picture.
 */
export default function EmailCodeInput({
  value,
  onChange,
  onComplete,
  label = "Six-digit code",
  size = "md",
  disabled = false,
  focusOnMount = false,
}: EmailCodeInputProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const activeIndex = Math.min(value.length, EMAIL_CODE_LENGTH - 1);

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div
        aria-hidden="true"
        className={`grid gap-2 ${size === "md" ? "grid-cols-6" : "auto-cols-max grid-flow-col gap-1.5"}`}
      >
        {Array.from({ length: EMAIL_CODE_LENGTH }, (_, index) => {
          const digit = value[index] ?? "";
          const active = focused && !disabled && index === activeIndex;
          return (
            <span
              key={index}
              className={`grid place-items-center rounded-md border font-semibold tabular-nums text-text-primary transition duration-fast ${BOX_SIZES[size]} ${
                active
                  ? "border-[var(--color-text-primary)] bg-[var(--color-glass-medium)] shadow-ring"
                  : digit
                    ? "border-[var(--color-border-strong)] bg-[var(--color-glass-subtle)]"
                    : "border-[var(--color-field-border)] bg-[var(--color-field-bg)]"
              } ${disabled ? "opacity-60" : ""}`}
            >
              {digit}
            </span>
          );
        })}
      </div>
      <input
        id={id}
        value={value}
        disabled={disabled}
        // A focus-on-mount is what the step exists for: the code is the only
        // thing left to do, and the keyboard should already be up for it.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={focusOnMount}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={EMAIL_CODE_LENGTH}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const next = sanitiseEmailCodeInput(event.target.value);
          onChange(next);
          if (next.length === EMAIL_CODE_LENGTH && value.length < EMAIL_CODE_LENGTH) {
            onComplete?.(next);
          }
        }}
        // Transparent over the boxes, 16px so iOS does not zoom on focus. The
        // app-wide focus ring is turned off here only because the lit box
        // already shows where typing will land.
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent focus-visible:shadow-none focus-visible:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
