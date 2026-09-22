"use client";

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import MissionComplete from "@/components/today/MissionComplete";
import type { MissionCompletionCopy } from "@/lib/dashboard/today-mission";

/**
 * The one thing Jami is asking the student to do, as the destination.
 *
 * Deliberately not a card among cards. Everything else on the Study Hub is a
 * door, a count or a link; this is the page's answer, and it is sized, spaced
 * and lit to read that way from across a room. A student who opens Jami and
 * takes nothing else in should still know what to press.
 *
 * The atmosphere is two washes of colour and one hairline arc -- no drawn
 * stars. Jami's sky already sits behind every page for the students who turn
 * it on, and a star drawn here would be a second thing wearing the shape that
 * means "you earned this", which is the one piece of the visual language that
 * has to stay honest.
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

function Atmosphere({ tone }: { tone: "engine" | "plain" }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -right-24 -top-32 h-[28rem] w-[28rem] rounded-full opacity-70 blur-3xl"
        style={{
          background:
            tone === "engine"
              ? "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 26%, transparent) 0%, transparent 68%)"
              : "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 14%, transparent) 0%, transparent 68%)",
        }}
      />
      <div
        className="absolute -bottom-40 -left-20 h-[24rem] w-[24rem] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-warm-accent) 16%, transparent) 0%, transparent 70%)",
        }}
      />
      {/*
        One hairline arc, cropped by the card.
        A horizon rather than a decoration: it gives the panel a sense of scale
        without adding anything that competes with the words.
      */}
      <svg
        viewBox="0 0 600 600"
        className="absolute -right-40 -top-56 h-[44rem] w-[44rem] opacity-[0.16]"
        fill="none"
      >
        <circle cx="300" cy="300" r="290" stroke="var(--color-warm-accent)" strokeWidth="1" />
        <circle cx="300" cy="300" r="216" stroke="var(--color-warm-accent)" strokeWidth="0.75" />
      </svg>
    </div>
  );
}

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
    <Card
      tone="warm"
      padding="none"
      className="relative isolate overflow-hidden"
    >
      <Atmosphere tone={tone} />
      <div className="relative flex min-h-[19rem] flex-col gap-7 p-6 sm:min-h-[21rem] sm:p-9 lg:p-10">
        {completion ? <MissionComplete copy={completion} /> : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-2xs font-semibold uppercase tracking-[0.2em] text-warm-accent">
            {completion ? "Next up" : eyebrow}
          </span>
          {context ? (
            <>
              <span aria-hidden="true" className="text-2xs text-text-muted">
                ·
              </span>
              <span className="min-w-0 truncate text-2xs font-medium uppercase tracking-[0.14em] text-text-muted">
                {context}
              </span>
            </>
          ) : null}
        </div>

        {/*
          Keyed on the recommendation, so when the engine's answer changes
          underneath a student who is looking at the card -- which is exactly
          what happens on the way back from finishing something -- the new one
          arrives rather than appearing to have always been there.
        */}
        <div key={bodyKey ?? headline} className="mission-body flex-1">
          <h2 className="max-w-[18ch] text-balance text-2xl font-medium leading-[1.1] tracking-[-0.02em] text-text-primary sm:text-3xl lg:max-w-[20ch] lg:text-4xl">
            {headline}
          </h2>
          {summary ? (
            <p className="mt-4 max-w-[46ch] text-sm leading-7 text-text-secondary sm:text-base">
              {summary}
            </p>
          ) : null}
        </div>

        {facts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums text-text-muted">
            {facts.map((fact, index) => (
              <span key={fact} className="flex items-center gap-3">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-text-muted">
                    ·
                  </span>
                ) : null}
                {fact}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {action}
            {secondaryAction}
            {canExplain ? (
              <button
                type="button"
                onClick={() => setShowWhy((open) => !open)}
                aria-expanded={showWhy}
                className="ml-auto rounded-full px-3 py-2 text-sm font-medium text-text-muted underline-offset-4 transition duration-fast hover:text-text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                {showWhy ? "Hide" : "Why this?"}
              </button>
            ) : null}
          </div>

          {canExplain && showWhy ? (
            <div className="grid gap-2 border-t border-[var(--color-border)] pt-4">
              {explanation.map((line) => (
                <p key={line} className="max-w-[62ch] text-sm leading-6 text-text-secondary">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
