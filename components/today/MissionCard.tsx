"use client";

import { useState, type ReactNode } from "react";
import MissionComplete from "@/components/today/MissionComplete";
import type { MissionCompletionCopy } from "@/lib/dashboard/today-mission";

/**
 * The one thing Jami is asking the student to do next, when Jami is leading.
 *
 * It sits at the top of "Jami suggests" as the highlighted first line: what to
 * do, a sentence on why it is worth doing now, and the button. It used to be a
 * full-height card lit like a poster, above a pile of other panels, and read
 * as one more thing on a busy page rather than the answer to it. Today is laid
 * out like a planner now, so the next step is the first entry in the list,
 * marked, rather than a banner over it.
 *
 * "Why this?" is folded away on purpose. The reasoning is what makes the
 * recommendation trustworthy, and putting it on the face makes it homework.
 */

export type MissionCardProps = {
  eyebrow: string;
  headline: string;
  summary?: string;
  /** Short facts about the work, already worded. Rendered as one quiet row. */
  facts?: string[];
  /** Behind "Why this?". No disclosure is offered when this is empty. */
  explanation?: string[];
  /** The subject this belongs to, when the student has more than one on the go. */
  context?: string;
  action: ReactNode;
  secondaryAction?: ReactNode;
  /** A quieter tone for a mission that is a plain next step rather than advice. */
  tone?: "engine" | "plain";
  /**
   * What the student has just finished, on the visit straight after doing it.
   *
   * Present, the card becomes the whole loop in one place: what was done, then
   * what follows from it. The eyebrow changes to match, because "your next
   * move" reads oddly directly beneath "that's done".
   */
  completion?: MissionCompletionCopy;
  /** Re-run the entrance when the recommendation itself changes underneath. */
  bodyKey?: string;
};

export default function MissionCard({
  eyebrow,
  headline,
  summary,
  facts = [],
  explanation = [],
  context,
  action,
  secondaryAction,
  tone = "engine",
  completion,
  bodyKey,
}: MissionCardProps) {
  const [showWhy, setShowWhy] = useState(false);
  const canExplain = explanation.length > 0;

  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 ${
        tone === "engine"
          ? "border-accent/40 bg-[var(--color-accent-muted)]"
          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)]"
      }`}
    >
      {completion ? <MissionComplete copy={completion} /> : null}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-warm-accent">
          {completion ? "Next up" : eyebrow}
        </span>
        {context ? (
          <>
            <span aria-hidden="true" className="text-2xs text-text-muted">
              ·
            </span>
            <span className="min-w-0 truncate text-2xs font-medium uppercase tracking-[0.12em] text-text-muted">
              {context}
            </span>
          </>
        ) : null}
      </div>

      {/*
        Keyed on the recommendation, so when the engine's answer changes
        underneath a student who is looking at it -- which is exactly what
        happens on the way back from finishing something -- the new one arrives
        rather than appearing to have always been there.
      */}
      <div key={bodyKey ?? headline} className="mission-body mt-1.5">
        <h2 className="text-lg font-bold leading-snug tracking-tight text-text-primary sm:text-xl">
          {headline}
        </h2>
        {summary ? <p className="mt-1 max-w-[60ch] text-sm leading-6 text-text-secondary">{summary}</p> : null}
      </div>

      {facts.length > 0 ? (
        <p className="mt-1.5 text-xs tabular-nums text-text-muted">{facts.join(" · ")}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {action}
        {secondaryAction}
        {canExplain ? (
          <button
            type="button"
            onClick={() => setShowWhy((open) => !open)}
            aria-expanded={showWhy}
            className="ml-auto rounded-full px-2 py-1 text-xs font-medium text-text-muted underline-offset-4 transition duration-fast hover:text-text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {showWhy ? "Hide" : "Why this?"}
          </button>
        ) : null}
      </div>

      {canExplain && showWhy ? (
        <div className="mt-3 grid gap-1.5 border-t border-[var(--color-border)] pt-3">
          {explanation.map((line) => (
            <p key={line} className="max-w-[62ch] text-sm leading-6 text-text-secondary">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
