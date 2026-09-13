"use client";

import { useId, type ReactNode } from "react";

type FormSectionProps = {
  title: string;
  description?: ReactNode;
  /** A word or two beside the title, such as "Optional". */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * One titled group of decisions inside a longer form.
 *
 * Forms that grew past a couple of fields were being stacked as one run of
 * inputs, so a colour swatch and an exam board read as the same kind of choice.
 * A quiet panel with a small title gives each decision its own place without
 * turning the form into a settings page.
 */
export default function FormSection({
  title,
  description,
  aside,
  children,
  className = "",
}: FormSectionProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:p-5 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id={headingId}
            className="text-sm font-semibold tracking-tight text-text-primary"
          >
            {title}
          </h3>
          {description ? (
            <p className="mt-1 max-w-xl text-xs leading-5 text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {aside ? (
          <div className="shrink-0 pt-0.5 text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            {aside}
          </div>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
