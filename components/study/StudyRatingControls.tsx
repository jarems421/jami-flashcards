"use client";

import { RATING_LABELS, RATING_STYLES } from "@/lib/study/study-feedback";
import type { CardRating } from "@/lib/study/scheduler";

const FULL_SCALE: CardRating[] = ["again", "hard", "good", "easy"];

const TWO_POINT_SCALE: Array<{
  rating: CardRating;
  label: string;
  hint: string;
  shortcut: string;
  ariaLabel: string;
  classes: string;
}> = [
  {
    rating: "again",
    label: "Missed",
    hint: "Back of queue",
    shortcut: "1",
    ariaLabel: "Missed this card",
    classes:
      "border-rose-300/25 bg-rose-400/[0.08] text-rose-100 hover:border-rose-200/45 hover:bg-rose-400/[0.12]",
  },
  {
    rating: "good",
    label: "Got it",
    hint: "Clear card",
    shortcut: "2",
    ariaLabel: "Got this card right",
    classes:
      "border-emerald-300/25 bg-emerald-400/[0.08] text-emerald-100 hover:border-emerald-200/45 hover:bg-emerald-400/[0.12]",
  },
];

const BUTTON_BASE =
  "flex min-h-[5.2rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-4 text-center text-base font-semibold shadow-e1 transition duration-fast ease-spring hover:-translate-y-[0.5px] active:scale-[0.985] disabled:saturate-[0.82] disabled:brightness-95 sm:min-h-[4.6rem] sm:px-4 sm:py-3.5 sm:text-sm";

type StudyRatingControlsProps = {
  /** Simple Study answers on two points; everything else on the FSRS four. */
  scale: "two-point" | "four-point";
  savingRating: CardRating | null;
  onRate: (rating: CardRating) => void;
};

/**
 * The answer bar, sticky on phones and inline from the small breakpoint up.
 *
 * It emits a rating and nothing else. What that rating then does -- schedule,
 * requeue, or merely count -- belongs to the controller, so a practice-only
 * mode can reuse this bar without acquiring the power to reschedule.
 */
export default function StudyRatingControls({
  scale,
  savingRating,
  onRate,
}: StudyRatingControlsProps) {
  return (
    <div className="sticky bottom-3 z-30 animate-fade-in space-y-3 rounded-xl border border-[var(--color-border)] bg-surface-panel/95 p-2 shadow-e2 backdrop-blur-md sm:static sm:z-auto sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0">
      {savingRating ? (
        <div className="text-center text-sm text-text-muted">Saving...</div>
      ) : null}
      <div className="space-y-3">
        {scale === "two-point" ? (
          <div
            className="grid grid-cols-2 gap-2 sm:gap-3"
            aria-label="Simple Study answer choices"
          >
            {TWO_POINT_SCALE.map((option) => (
              <button
                key={option.rating}
                type="button"
                aria-label={option.ariaLabel}
                disabled={savingRating !== null}
                className={`${BUTTON_BASE} ${option.classes}`}
                onClick={() => onRate(option.rating)}
              >
                <span>{option.label}</span>
                <span className="text-2xs font-normal opacity-75">
                  {option.hint}
                </span>
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 px-2 text-2xs leading-none tabular-nums opacity-75">
                  {option.shortcut}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {FULL_SCALE.map((rating) => {
              const meta = RATING_STYLES[rating];
              return (
                <button
                  key={rating}
                  type="button"
                  disabled={savingRating !== null}
                  className={`${BUTTON_BASE} ${meta.classes}`}
                  onClick={() => onRate(rating)}
                >
                  <span>{RATING_LABELS[rating]}</span>
                  <span className="text-2xs font-normal opacity-75">
                    {meta.hint}
                  </span>
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 px-2 text-2xs leading-none tabular-nums opacity-75">
                    {meta.shortcut}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
