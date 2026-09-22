"use client";

import { type ReactNode } from "react";
import { usePersistentDisclosure } from "@/lib/app/disclosure-preference";

/**
 * Everything Today knows that is not the next thing to do.
 *
 * Folded, and folded by default. The page has one job -- make the student's
 * next decision effortless -- and every extra panel visible at rest is another
 * thing to weigh before starting. What is behind this is worth having and none
 * of it is worth the first viewport.
 *
 * The state is remembered per student, so somebody who likes it open keeps it
 * open. It is a preference about their own home page and does not need asking
 * for twice.
 */

const STORAGE_KEY = "jami:today-more-open";

export default function MoreForToday({
  count,
  children,
}: {
  /** How many things are behind it, so the label is honest before it is opened. */
  count: number;
  children: ReactNode;
}) {
  const [open, toggleOpen] = usePersistentDisclosure(STORAGE_KEY, false);
  if (count === 0) return null;

  return (
    <section className="border-t border-[var(--color-border)] pt-5">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="group flex w-full items-center justify-between gap-3 rounded-lg py-2 text-left transition duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold text-text-primary">More for today</span>
          <span className="text-xs tabular-nums text-text-muted">
            {count} {count === 1 ? "thing" : "things"}
          </span>
        </span>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-normal group-hover:text-text-primary ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open ? <div className="app-rise mt-4 grid items-start gap-4">{children}</div> : null}
    </section>
  );
}
