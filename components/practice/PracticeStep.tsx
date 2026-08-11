import type { ReactNode } from "react";

/**
 * One stage of building a paper.
 *
 * The form used to be a single card with everything in it at the same weight:
 * a folder picker, a free-text brief, file uploads, a source picker and two
 * sets of choices, stacked one after another with nothing to say which came
 * first or which mattered. It read as a wall, and the idea underneath it -- a
 * paper built from your own folder -- was invisible.
 *
 * Numbering is used here because the stages genuinely are a sequence: the
 * folder decides which sources exist, the sources decide what can be asked, and
 * the timing only means anything once there is a paper to sit. Numbering things
 * that are not a sequence is decoration; numbering this one is information.
 *
 * The rail is drawn to the left on wide screens and collapses above the content
 * on narrow ones, where a fixed gutter would cost more width than it earns.
 */
export default function PracticeStep({
  step,
  title,
  description,
  children,
  aside,
}: {
  step: number;
  title: string;
  description?: string;
  children: ReactNode;
  /** Optional note shown under the heading, before the fields. */
  aside?: ReactNode;
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-5">
      <div className="flex items-center gap-3 sm:block">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] text-xs font-semibold tabular-nums text-text-secondary"
        >
          {step}
        </span>
        <span className="h-px flex-1 bg-[var(--color-border)] sm:hidden" />
      </div>

      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-text-primary">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            {description}
          </p>
        ) : null}
        {aside}
        <div className="mt-4 space-y-4">{children}</div>
      </div>
    </section>
  );
}
