"use client";

import { Button, ProgressBar } from "@/components/ui";

type StudySessionPreparingProps = {
  /** Cards Jami has finished, out of the few being waited for. */
  prepared: number;
  total: number;
  onSkip: () => void;
};

/**
 * The wait between pressing Start and the first card, when there is one.
 *
 * Only new or edited cards reach a model -- everything else is served from the
 * cache -- so most sessions never render this at all, and the ones that do are
 * usually a deck the student has just written.
 *
 * The number here is deliberately small. Preparing a whole queue takes minutes,
 * not seconds, so this waits for the first few cards only and the rest are
 * prepared while the student works through them. Saying "your first cards"
 * rather than a count of the queue is not softening: it is what is actually
 * happening, and a student who read it as the whole deck would wonder why a
 * fifty-card session was ready so quickly.
 *
 * Two rules it must not break. The bar tracks real completions rather than
 * animating on a timer, because a bar that lies about progress is worse than no
 * bar. And Start now is there from the first frame: the session behind this is
 * already playable, so skipping costs a few better questions, not the session.
 */
export default function StudySessionPreparing({
  prepared,
  total,
  onSkip,
}: StudySessionPreparingProps) {
  const safeTotal = Math.max(1, total);
  const done = Math.min(prepared, safeTotal);
  const percent = Math.round((done / safeTotal) * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      data-study-preparing="true"
      className="mx-auto flex w-full max-w-[34rem] flex-col items-center gap-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-6 py-10 text-center shadow-e1 sm:px-10"
    >
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold tracking-[0.01em] text-text-primary sm:text-lg">
          Jami is preparing your study session
        </h2>
        <p className="text-sm leading-6 text-text-secondary">
          Reading your first cards so it can ask them properly — better gaps, and
          wrong answers worth choosing between. The rest are prepared while you
          study.
        </p>
      </div>

      <div className="w-full space-y-2">
        <ProgressBar progress={percent} size="sm" />
        <p className="text-2xs tabular-nums text-text-muted">
          {done} of {total} ready
        </p>
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
        Start now
      </Button>
    </div>
  );
}
