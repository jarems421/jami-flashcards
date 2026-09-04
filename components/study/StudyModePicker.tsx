"use client";

import { Button } from "@/components/ui";
import type { StudyMode, StudyModePolicy } from "@/lib/study/study-modes";

export type StudyModeReadiness = {
  ready: number;
  unavailable: number;
};

type ModeChoice = {
  key: "smart" | StudyMode;
  label: string;
  detail: string;
};

const CHOICES: ModeChoice[] = [
  {
    key: "smart",
    label: "Smart Mix",
    detail: "Recommended. Varies how each card is asked.",
  },
  { key: "classic", label: "Classic", detail: "Read it, turn it over, rate it." },
  {
    key: "type-answer",
    label: "Type Answer",
    detail: "Write the answer before it is shown.",
  },
  { key: "gap-fill", label: "Gap Fill", detail: "One word hidden in the answer." },
  {
    key: "multiple-choice",
    label: "Multiple Choice",
    detail: "Pick from four.",
  },
];

type StudyModePickerProps = {
  policy: StudyModePolicy;
  onChange: (policy: StudyModePolicy) => void;
  readiness: Partial<Record<StudyMode, StudyModeReadiness>>;
  /** True when the queue about to be studied carries a Daily Review obligation. */
  scheduledQueue: boolean;
  onPrepare: () => void;
  preparing: boolean;
};

/**
 * How this session will ask its cards.
 *
 * One row of pills and one line of detail. An earlier version laid all five out
 * as description cards with counts on each, which turned the calmest screen in
 * the app into a settings panel -- so only the chosen mode explains itself, and
 * the rest wait to be chosen.
 *
 * The line underneath is where readiness lives, because that is the only number
 * that changes what happens next: a fixed mode leaves out the cards it cannot
 * carry, and a student is owed that before they start rather than as a shorter
 * queue than they asked for.
 */
export default function StudyModePicker({
  policy,
  onChange,
  readiness,
  scheduledQueue,
  onPrepare,
  preparing,
}: StudyModePickerProps) {
  const active = policy.kind === "smart" ? "smart" : policy.mode;
  const choice = CHOICES.find((entry) => entry.key === active) ?? CHOICES[0];
  const counts =
    active === "smart" ? undefined : readiness[active as StudyMode];
  const practiceOnly = active === "multiple-choice" && scheduledQueue;
  const needsPreparing =
    active === "multiple-choice" && (counts?.unavailable ?? 0) > 0;

  return (
    <div className="space-y-2.5">
      <div
        role="radiogroup"
        aria-label="How to study"
        // Wraps rather than scrolls. A horizontal scroller hid two of the five
        // modes behind a phone's screen edge with nothing to suggest they were
        // there, and a second row of pills costs less than a hidden choice.
        className="flex flex-wrap gap-1.5"
      >
        {CHOICES.map((entry) => {
          const selected = active === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() =>
                onChange(
                  entry.key === "smart"
                    ? { kind: "smart" }
                    : { kind: "fixed", mode: entry.key as StudyMode }
                )
              }
              className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                selected
                  ? "border-accent/55 bg-accent/10 text-text-primary shadow-e1"
                  : "border-[var(--color-border)] text-text-secondary hover:border-border-strong hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-2xs leading-5 text-text-muted">
        <span className="text-text-secondary">{choice.detail}</span>
        {counts ? (
          <span className="tabular-nums before:mr-2 before:content-['·']">
            {counts.ready} ready
            {counts.unavailable > 0 ? ` · ${counts.unavailable} not suited` : ""}
          </span>
        ) : null}
        {practiceOnly ? (
          <span className="app-warning rounded-full px-2 py-0.5 font-semibold">
            Practice only — will not complete today&apos;s review
          </span>
        ) : null}
        {needsPreparing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={preparing}
            onClick={onPrepare}
          >
            {preparing ? "Preparing…" : "Prepare with Jami"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
