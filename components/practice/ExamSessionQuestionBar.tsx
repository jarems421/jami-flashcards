"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import ToolbarIconButton from "@/components/workspace/NotebookToolbarIconButton";
import {
  examQuestionPartLabel,
  type ExamSessionQuestionRun,
} from "@/lib/practice/exam-question-groups";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";

type BarPart = {
  id: string;
  provenance?: { questionNumber?: string };
};

type PartState = {
  /** The chip's colours. */
  tone: string;
  /** The same thing in words, for the tooltip and a screen reader. */
  label: string;
};

/**
 * Where one part stands, as a colour and in words.
 *
 * A marked part takes the colour of its mark -- the latest attempt's, so a
 * retry that earned full marks turns green. Every marked pill used to be green,
 * so a question scored zero looked exactly like one answered perfectly.
 *
 * The colours were never explained anywhere, which is half of why the bar read
 * as noise. Each one now carries its meaning in words as well.
 */
function partState(attempts: readonly PublicExamAttempt[]): PartState {
  const marked = [...attempts]
    .filter((item) => item.status === "marked" && item.result)
    .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
  if (marked?.result) {
    const { awardedMarks, maxMarks } = marked.result;
    const label = `marked ${awardedMarks}/${maxMarks}`;
    if (maxMarks > 0 && awardedMarks >= maxMarks) {
      return { tone: "bg-success/20 text-[var(--color-success-mark)]", label };
    }
    if (awardedMarks > 0) {
      return { tone: "bg-warning/20 text-[var(--color-warning-mark)]", label };
    }
    return { tone: "bg-error/15 text-[var(--color-error-mark)]", label };
  }
  if (attempts.some((item) => item.status === "marking_failed")) {
    return { tone: "bg-error/15 text-error", label: "marking failed" };
  }
  if (attempts.some((item) => item.status === "marking")) {
    return {
      tone: "animate-pulse bg-warm-accent/20 text-warm-accent",
      label: "being marked",
    };
  }
  if (attempts.some((item) => item.status === "draft" && Boolean(item.answerText))) {
    return {
      tone: "bg-[var(--color-glass-strong)] text-text-primary",
      label: "answered, not marked yet",
    };
  }
  return {
    tone: "bg-[var(--color-glass-subtle)] text-text-secondary hover:text-text-primary",
    label: "not started",
  };
}

/*
 * The glow is painted inside the chip. An outer shadow spilled past it, and
 * the strip, which scrolls sideways and so clips vertically, cut it off in a
 * flat line along the bottom.
 */
const CURRENT_TONE =
  "bg-accent bg-[radial-gradient(closest-side,transparent_55%,rgb(255_255_255/0.32))] text-[var(--color-text-inverse)]";

/**
 * The strip along the top of a practice session: where you are, how to move,
 * and how far through you are.
 *
 * It used to say "Question 1 of 3" in words while its chips were numbered by
 * the paper -- 7, 3, 12 -- so the bar disagreed with itself, and with the
 * answer sheet below it, which also uses the paper's number. A question with
 * one part was a bare dot beside a number that could not be pressed. There was
 * no way to step forward or back without finding the next dot.
 *
 * Now every question is one chip carrying the number the sheet below shows;
 * a question with parts carries its letters inside the same chip, the way the
 * paper sets them out; and the arrows either side step through them in order.
 */
export default function ExamSessionQuestionBar({
  runs,
  parts,
  attempts,
  index,
  markedCount,
  canFinish,
  finishing,
  onGoTo,
  onFinish,
}: {
  runs: readonly ExamSessionQuestionRun[];
  parts: readonly BarPart[];
  attempts: readonly PublicExamAttempt[];
  /** The part on screen, as an index into `parts`. */
  index: number;
  markedCount: number;
  canFinish: boolean;
  finishing: boolean;
  onGoTo(index: number): void;
  onFinish(): void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  /*
   * Keeps the chip being answered in view.
   *
   * A long session scrolls sideways on a phone, and stepping with the arrows
   * would otherwise walk the current chip off the edge of the strip. Only the
   * strip scrolls: `scrollIntoView` would also move the page.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const current = scroller?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!scroller || !current) return;
    const start = current.offsetLeft - scroller.offsetLeft;
    const end = start + current.offsetWidth;
    const margin = 24;
    const scrollTo = (left: number) => {
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ left, behavior: "smooth" });
      } else {
        scroller.scrollLeft = left;
      }
    };
    if (start < scroller.scrollLeft + margin) {
      scrollTo(Math.max(0, start - margin));
    } else if (end > scroller.scrollLeft + scroller.clientWidth - margin) {
      scrollTo(end - scroller.clientWidth + margin);
    }
  }, [index]);

  const statesFor = (partId: string) =>
    partState(attempts.filter((attempt) => attempt.questionId === partId));

  return (
    <nav
      aria-label="Questions"
      /*
       * Solid rather than frosted. A backdrop blur has to be recomputed
       * whenever what is beneath it changes, and while a student scrolls
       * and writes that is a page of fresh ink every frame.
       */
      className="sticky top-[4.5rem] z-30 flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--app-background)] p-1.5 shadow-shell"
    >
      <ToolbarIconButton
        label="Previous"
        icon="back"
        disabled={index <= 0}
        onClick={() => onGoTo(index - 1)}
      />

      <div
        ref={scrollerRef}
        className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* Centred when it fits, scrollable from its first chip when it does not. */}
        <ol className="mx-auto flex w-max items-center gap-1.5 px-1 py-0.5">
          {runs.map((run, runIndex) => {
            const number = run.number || String(runIndex + 1);
            const runParts = parts.slice(run.from, run.from + run.count);
            const holdsCurrent = index >= run.from && index < run.from + run.count;

            if (run.count <= 1) {
              const part = runParts[0];
              if (!part) return null;
              const state = statesFor(part.id);
              const current = run.from === index;
              const label = `Question ${number}, ${state.label}`;
              return (
                <li key={run.key}>
                  <button
                    type="button"
                    aria-current={current ? "step" : undefined}
                    aria-label={label}
                    title={label}
                    onClick={() => onGoTo(run.from)}
                    className={`grid h-9 min-w-9 place-items-center rounded-full px-2.5 text-sm font-semibold tabular-nums transition duration-fast ${
                      current ? CURRENT_TONE : state.tone
                    }`}
                  >
                    {number}
                  </button>
                </li>
              );
            }

            return (
              <li
                key={run.key}
                className={`flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-0.5 ${
                  holdsCurrent
                    ? "border-accent/50 bg-[var(--color-glass-subtle)]"
                    : "border-[var(--color-border)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pr-0.5 text-sm font-semibold tabular-nums ${
                    holdsCurrent ? "text-text-primary" : "text-text-muted"
                  }`}
                >
                  {number}
                </span>
                {runParts.map((part, offset) => {
                  const partIndex = run.from + offset;
                  const letter =
                    examQuestionPartLabel(part.provenance?.questionNumber ?? "").replace(
                      /[().]/g,
                      ""
                    ) || String(offset + 1);
                  const state = statesFor(part.id);
                  const current = partIndex === index;
                  const label = `Question ${number}(${letter}), ${state.label}`;
                  return (
                    <button
                      key={part.id}
                      type="button"
                      aria-current={current ? "step" : undefined}
                      aria-label={label}
                      title={label}
                      onClick={() => onGoTo(partIndex)}
                      className={`grid h-8 min-w-8 place-items-center rounded-full px-2 text-xs font-semibold transition duration-fast ${
                        current ? CURRENT_TONE : state.tone
                      }`}
                    >
                      {letter}
                    </button>
                  );
                })}
              </li>
            );
          })}
        </ol>
      </div>

      <ToolbarIconButton
        label="Next"
        icon="forward"
        disabled={index >= parts.length - 1}
        onClick={() => onGoTo(index + 1)}
      />

      <span
        aria-hidden="true"
        className="mx-1 hidden h-6 w-px shrink-0 bg-[var(--color-border)] sm:block"
      />
      <p className="hidden shrink-0 px-1 text-xs font-medium tabular-nums text-text-muted sm:block">
        {markedCount} of {runs.length} marked
      </p>
      {canFinish ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={finishing}
          onClick={onFinish}
          className="shrink-0"
        >
          {finishing ? "Finishing…" : "Finish"}
        </Button>
      ) : null}
    </nav>
  );
}
