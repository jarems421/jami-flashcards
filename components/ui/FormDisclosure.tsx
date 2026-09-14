"use client";

import { useState, type ReactNode } from "react";

type FormDisclosureProps = {
  title: string;
  /** What is chosen inside, shown beside the title so a closed section still says it. */
  summary?: ReactNode;
  /** Read once, when the section first renders; after that it is the student's to open. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * An optional part of a form, folded away until it is wanted.
 *
 * Creation forms had every setting on screen at once -- a course, a cover, a
 * topic list -- so the one thing a student came to do, naming the thing, sat
 * among a page of choices most of them never make. A closed section keeps its
 * choice visible in the summary, so nothing set inside it is hidden.
 */
export default function FormDisclosure({
  title,
  summary,
  defaultOpen = false,
  children,
  className = "",
}: FormDisclosureProps) {
  const [startsOpen] = useState(defaultOpen);

  return (
    <details
      open={startsOpen || undefined}
      className={`group rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] transition-colors duration-fast ${className}`}
    >
      <summary className="flex min-h-[3.25rem] cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2.5 transition-colors duration-fast hover:bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 text-sm font-semibold text-text-primary">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
          {summary ? <span className="truncate">{summary}</span> : null}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="h-4 w-4 shrink-0 transition-transform duration-fast group-open:rotate-180"
          >
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>
      <div className="border-t border-[var(--color-border)] px-4 pb-4 pt-4">{children}</div>
    </details>
  );
}
