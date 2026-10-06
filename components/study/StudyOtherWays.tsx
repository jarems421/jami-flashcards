"use client";

import type { ReactNode } from "react";
import { Button, Card as SurfaceCard } from "@/components/ui";

type FocusedReviewSummary = {
  open: boolean;
  onToggleOpen: () => void;
  hasFilters: boolean;
  /** Decks and Topics picked so far. */
  selectedCount: number;
  /** Cards the current selection would study. */
  previewCount: number;
  /** The deck and Topic picker, shown while the card is open. */
  builder: ReactNode;
  onStart: () => void;
};

type SimpleStudySummary = {
  newCount: number;
  wrongCount: number;
  /** Cards a pass would go through; none means it is clear. */
  cardCount: number;
  modePicker?: ReactNode;
  onStart: () => void;
};

/** The Learn home's secondary choices: a targeted session or a quick pass. */
export default function StudyOtherWays({
  focused,
  simple,
}: {
  focused: FocusedReviewSummary;
  simple: SimpleStudySummary;
}) {
  return (
    <section aria-labelledby="other-study-heading" className="space-y-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          Your choice
        </div>
        <h2
          id="other-study-heading"
          className="mt-1 text-xl font-semibold tracking-tight text-text-primary"
        >
          Other ways to study
        </h2>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FocusedReviewCard {...focused} />
        <SimpleStudyCard {...simple} />
      </div>
    </section>
  );
}

function FocusedReviewCard({
  open,
  onToggleOpen,
  hasFilters,
  selectedCount,
  previewCount,
  builder,
  onStart,
}: FocusedReviewSummary) {
  return (
    <SurfaceCard
      padding="md"
      className={`flex h-full flex-col ${open ? "xl:col-span-2" : ""}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Focused Review
          </div>
          <h3 className="mt-2 text-lg font-semibold text-text-primary">
            Choose exactly what to practice
          </h3>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Pick decks or Topics for a targeted session.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={open}
          aria-controls="focused-review-builder"
          onClick={onToggleOpen}
          className="w-full shrink-0 sm:w-auto"
        >
          {open
            ? "Hide choices"
            : hasFilters
              ? "Edit selection"
              : "Choose decks or Topics"}
        </Button>
      </div>

      {open ? (
        builder
      ) : (
        <>
          <div className="mt-4 text-sm font-medium text-text-muted" aria-live="polite">
            {hasFilters
              ? `${selectedCount} selected · ${previewCount} cards`
              : `${previewCount} cards available`}
          </div>
          <div className="mt-auto pt-5">
            {previewCount > 0 ? (
              <Button type="button" onClick={onStart} className="w-full sm:w-auto">
                Start Focused Review
              </Button>
            ) : null}
          </div>
        </>
      )}
    </SurfaceCard>
  );
}

function SimpleStudyCard({
  newCount,
  wrongCount,
  cardCount,
  modePicker,
  onStart,
}: SimpleStudySummary) {
  return (
    <SurfaceCard padding="md" className="flex h-full flex-col">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
        Simple Study
      </div>
      <h3 className="mt-2 text-lg font-semibold text-text-primary">Make one quick pass</h3>
      <p className="mt-2 text-sm leading-6 text-text-secondary">
        Clear new and missed cards with a simple correct-or-wrong choice.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-muted">
        <span>
          <strong className="font-semibold tabular-nums text-text-primary">{newCount}</strong> new
        </span>
        <span>
          <strong className="font-semibold tabular-nums text-text-primary">{wrongCount}</strong>{" "}
          missed
        </span>
      </div>
      {modePicker ? <div className="mt-5">{modePicker}</div> : null}
      <div className="mt-auto pt-5">
        {cardCount > 0 ? (
          <Button type="button" onClick={onStart} variant="secondary" className="w-full sm:w-auto">
            Start Simple Study
          </Button>
        ) : (
          <span className="app-success inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold">
            All clear
          </span>
        )}
      </div>
    </SurfaceCard>
  );
}
