/**
 * How a score looks, in one place.
 *
 * A marked paper says the same thing at four different sizes -- the headline
 * result, each question in the list, each attempt in the history, and the
 * progress card on the practice page. Those were four hand-rolled treatments
 * that disagreed with each other, so a score that was bad in one place was
 * merely accent-coloured in the next. Reading the paper meant relearning the
 * colours at every level.
 *
 * Three bands rather than a gradient, because the reader is sorting rather than
 * measuring: what was earned, what was part earned, and what was not earned at
 * all. A continuous scale has to be read to be understood, which is the job the
 * numbers already do -- and the numbers are always kept beside the colour.
 */

export type ScoreBandName = "full" | "part" | "none" | "uncounted";

export type ScoreBandStyle = {
  band: ScoreBandName;
  /**
   * A solid mark in the band's colour: the stripe, the meter fill, the dot.
   *
   * `--color-*-mark`, which exists for exactly this and nothing else. Neither
   * of the older tokens survives both themes: the bare ones (`--color-success`
   * and friends) are dark-theme pastels that are never redefined, so they all
   * but vanish on white, while the `-text` ones do flip per theme but are three
   * near-identical whites in the dark themes -- visible, and impossible to tell
   * apart, which on a banded list is the worse failure of the two.
   */
  mark: string;
  /** Badge carrying the numbers. Theme-aware border, fill and text together. */
  badge: string;
  /** What the band means, in the student's terms. */
  caption: string;
};

export function scoreBand({
  awardedMarks,
  maxMarks,
  counted = true,
  attempted = true,
}: {
  awardedMarks: number;
  maxMarks: number;
  counted?: boolean;
  attempted?: boolean;
}): ScoreBandStyle {
  if (!counted) {
    return {
      band: "uncounted",
      // Deliberately outside the colour scheme. A dimmed accent read as a low
      // score rather than as no score, which is the opposite of the truth.
      mark: "bg-[var(--color-border-strong)]",
      badge:
        "border border-[var(--color-border)] bg-[var(--color-glass-medium)] text-text-secondary",
      caption: "Not counted",
    };
  }

  const share = maxMarks > 0 ? (awardedMarks / maxMarks) * 100 : 0;

  if (share >= 100) {
    return {
      band: "full",
      mark: "bg-[var(--color-success-mark)]",
      badge: "app-success",
      caption: "Full marks",
    };
  }

  if (share > 0) {
    return {
      band: "part",
      mark: "bg-[var(--color-warning-mark)]",
      badge: "app-warning",
      caption: "Part marks — worth reviewing",
    };
  }

  return {
    band: "none",
    mark: "bg-[var(--color-error-mark)]",
    badge: "app-danger",
    // An unanswered question and a wrong one both score nothing and need
    // completely different things from the student, so they should not read
    // as the same result.
    caption: attempted ? "No marks — start here" : "Not attempted",
  };
}

/** The share of the marks earned, as a length rather than a number. */
export function ScoreMeter({
  awardedMarks,
  maxMarks,
  tone,
  className = "",
}: {
  awardedMarks: number;
  maxMarks: number;
  tone: ScoreBandStyle;
  className?: string;
}) {
  const share =
    maxMarks > 0
      ? Math.max(0, Math.min(100, (awardedMarks / maxMarks) * 100))
      : 0;
  return (
    <span
      aria-hidden="true"
      className={`block h-1.5 overflow-hidden rounded-full bg-[var(--color-glass-medium)] ${className}`}
    >
      <span
        className={`block h-full rounded-full transition-all duration-slow ${tone.mark}`}
        style={{ width: `${share}%` }}
      />
    </span>
  );
}
