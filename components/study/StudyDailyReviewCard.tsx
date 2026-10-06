"use client";

import { useEffect, useState, type ReactNode } from "react";
import StudyHomeStat from "@/components/study/StudyHomeStat";
import { Button, Card as SurfaceCard } from "@/components/ui";
import { getMsUntilNextStudyBoundary } from "@/lib/study/day";
import { formatResetCountdown } from "@/lib/study/study-feedback";

export type DailyRequiredSessionScope = "all" | "carryover" | "fresh";

type StudyDailyReviewCardProps = {
  /** Unfinished required cards carried over from an earlier day. */
  carryoverCount: number;
  /** Today's required cards not yet done. */
  freshCount: number;
  /** Every required card still to do, carried over or fresh. */
  requiredCount: number;
  /** Easy extras still available. */
  optionalCount: number;
  /** How the cards are asked; absent while study modes are off. */
  modePicker?: ReactNode;
  onStartRequired: (scope: DailyRequiredSessionScope) => void;
  onStartOptional: () => void;
};

/** The Learn home's primary surface: today's Daily Review and how to start it. */
export default function StudyDailyReviewCard({
  carryoverCount,
  freshCount,
  requiredCount,
  optionalCount,
  modePicker,
  onStartRequired,
  onStartOptional,
}: StudyDailyReviewCardProps) {
  const hasCarryover = carryoverCount > 0;

  return (
    <SurfaceCard tone="warm" padding="lg">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Daily Review
          </div>
          <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-text-primary sm:text-3xl">
            {hasCarryover
              ? "Finish yesterday's review first."
              : requiredCount > 0
                ? "Your next review is ready."
                : "You're clear for today."}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-text-secondary sm:text-base">
            {hasCarryover
              ? "Continue the unfinished cards, then move into today's set when you're ready."
              : requiredCount > 0
                ? "Start with the cards most likely to slip from memory."
                : optionalCount > 0
                  ? "Your priority cards are done. Easy extras are available if you want another pass."
                  : "There is nothing you need to review right now."}
          </p>
        </div>
        <ResetCountdown />
      </div>

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-5 border-y border-[var(--color-border)] py-5">
        {hasCarryover ? <StudyHomeStat value={carryoverCount} label="Unfinished" /> : null}
        <StudyHomeStat value={freshCount} label={hasCarryover ? "Today" : "Needs attention"} />
        <StudyHomeStat value={optionalCount} label="Easy extras" />
      </div>

      {modePicker ? <div className="mt-6">{modePicker}</div> : null}

      <div data-tutorial-target="complete-review" className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        {hasCarryover ? (
          <Button
            type="button"
            onClick={() => onStartRequired("carryover")}
            variant="warm"
            size="lg"
            className="w-full sm:w-auto"
          >
            Continue unfinished review
          </Button>
        ) : requiredCount > 0 ? (
          <Button
            type="button"
            onClick={() => onStartRequired("all")}
            data-tutorial-target="start-review"
            variant="warm"
            size="lg"
            className="w-full sm:w-auto"
          >
            Start Daily Review
          </Button>
        ) : optionalCount === 0 ? (
          <span className="app-success inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold">
            All clear
          </span>
        ) : null}

        {hasCarryover && freshCount > 0 ? (
          <Button
            type="button"
            onClick={() => onStartRequired("fresh")}
            variant="secondary"
            size="md"
            className="w-full sm:w-auto"
          >
            Start today&apos;s cards
          </Button>
        ) : null}

        {optionalCount > 0 ? (
          <Button
            type="button"
            onClick={onStartOptional}
            variant={requiredCount === 0 ? "secondary" : "ghost"}
            size="md"
            className="w-full sm:w-auto"
          >
            Review easy extras
          </Button>
        ) : null}
      </div>
    </SurfaceCard>
  );
}

/** Until the study day turns over and the review is rebuilt. */
function ResetCountdown() {
  const [countdownMs, setCountdownMs] = useState(getMsUntilNextStudyBoundary);

  useEffect(() => {
    const interval = window.setInterval(() => setCountdownMs(getMsUntilNextStudyBoundary()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="shrink-0 text-sm text-text-muted sm:text-right">
      <span>Next reset in </span>
      <span className="font-semibold tabular-nums text-text-secondary">
        {formatResetCountdown(countdownMs)}
      </span>
    </div>
  );
}
