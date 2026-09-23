"use client";

import { useState } from "react";
import { Button, StudyText, Textarea } from "@/components/ui";
import type { RevisionTaskView } from "@/lib/revision/view";
import type { RevisionBusy } from "@/hooks/useRevisionSession";
import type { RevisionStepInput } from "@/services/learning/revision-sessions";

/** What each question is called on screen. The internal step names never are. */
const EYEBROW: Record<RevisionTaskView["kind"], string> = {
  guided: "Your turn",
  retry: "Let's look at it another way",
  independent: "On your own",
  apply: "Use it",
  retrieve: "Without looking back",
};

/** Said after a reload, when the marker's own sentence is gone: the verdict, plainly. */
const VERDICT_LINE = {
  correct: "That's right.",
  partial: "Almost.",
  incorrect: "Not quite.",
} as const;

/**
 * One question, answered.
 *
 * The student does the thinking here, so the screen is mostly the question and
 * a place to answer it. Help is there without being in the way: a hint on
 * request, and "I'm not sure" for when a guess would teach nothing. A wrong
 * answer is "Not quite." and a reason -- never a red cross -- and the worked
 * answer follows either way, because seeing it done is part of the lesson.
 */
export default function RevisionTaskStep({
  step,
  feedback,
  selfGrade,
  busy,
  stepError,
  isLast,
  onAct,
}: {
  step: RevisionTaskView;
  feedback: string | null;
  selfGrade: { answer: string; solution: string } | null;
  busy: RevisionBusy;
  stepError: string | null;
  isLast: boolean;
  onAct(input: RevisionStepInput): void;
}) {
  const [answer, setAnswer] = useState("");
  const outcome = step.outcome;
  const working = busy !== null;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-4">
        <span className="text-2xs font-semibold uppercase tracking-[0.2em] text-warm-accent">
          {EYEBROW[step.kind]}
        </span>
        {step.intro ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-5 sm:p-6">
            <StudyText as="p" text={step.intro} className="whitespace-pre-line text-base leading-7 text-text-primary" />
          </div>
        ) : null}
        <StudyText
          as="p"
          text={step.prompt}
          className="whitespace-pre-line text-xl leading-8 text-text-primary sm:text-2xl sm:leading-9"
        />
      </div>

      {outcome ? (
        <Outcome
          outcome={outcome}
          feedback={feedback}
          isLast={isLast}
          busy={busy}
          stepError={stepError}
          onContinue={() => onAct({ type: "continue" })}
        />
      ) : selfGrade ? (
        <div className="flex flex-col gap-5">
          <p className="text-base leading-7 text-text-secondary">
            Jami couldn&apos;t check that one just now. Compare it with this:
          </p>
          <WorkedAnswer answer={selfGrade.answer} solution={selfGrade.solution} />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={working}
              onClick={() => onAct({ type: "self-grade", correct: true })}
            >
              I got it
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={working}
              onClick={() => onAct({ type: "self-grade", correct: false })}
            >
              Not quite
            </Button>
          </div>
          {stepError ? <StepError message={stepError} /> : null}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (answer.trim() && !working) onAct({ type: "answer", answer });
          }}
        >
          <Textarea
            aria-label="Your answer"
            placeholder="Your answer"
            rows={3}
            symbols
            value={answer}
            disabled={working}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              // Enter checks; Shift+Enter is a new line for working over several lines.
              if (event.key === "Enter" && !event.shiftKey && answer.trim() && !working) {
                event.preventDefault();
                onAct({ type: "answer", answer });
              }
            }}
            className="text-lg"
          />

          {step.hint ? (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3">
              <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">Hint</span>
              <StudyText as="p" text={step.hint} className="mt-1 block text-sm leading-6 text-text-secondary" />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {!step.hint ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={working}
                onClick={() => onAct({ type: "hint" })}
              >
                {busy === "hint" ? "…" : "Show a hint"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={working}
              onClick={() => onAct({ type: "skip" })}
            >
              I&apos;m not sure — show me
            </Button>
            <Button
              type="submit"
              className="ml-auto min-w-28"
              disabled={working || !answer.trim()}
            >
              {busy === "answer" ? "Checking…" : "Check"}
            </Button>
          </div>
          {stepError ? <StepError message={stepError} /> : null}
        </form>
      )}
    </div>
  );
}

function Outcome({
  outcome,
  feedback,
  isLast,
  busy,
  stepError,
  onContinue,
}: {
  outcome: NonNullable<RevisionTaskView["outcome"]>;
  feedback: string | null;
  isLast: boolean;
  busy: RevisionBusy;
  stepError: string | null;
  onContinue(): void;
}) {
  const good = outcome.verdict === "correct";
  const line = outcome.skipped
    ? "Here's how it goes."
    : feedback ?? (outcome.verdict ? VERDICT_LINE[outcome.verdict] : "Here's how it goes.");

  return (
    <div className="flex flex-col gap-5">
      <div
        role="status"
        className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 ${
          good
            ? "bg-success/10 text-[var(--color-success-mark)] ring-1 ring-[color-mix(in_srgb,var(--color-success-mark)_22%,transparent)]"
            : "bg-[var(--color-glass-subtle)] text-text-primary"
        }`}
      >
        {good ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0">
            <path d="m5 12.5 4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
        <StudyText as="p" text={line} className="text-base leading-7" />
      </div>

      <WorkedAnswer answer={outcome.answer} solution={outcome.solution} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" className="min-w-36" disabled={busy !== null} onClick={onContinue}>
          {busy === "continue" ? "One moment…" : isLast ? "Finish" : "Continue"}
        </Button>
        {stepError ? <StepError message={stepError} /> : null}
      </div>
    </div>
  );
}

function WorkedAnswer({ answer, solution }: { answer: string; solution: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-5">
      <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">Worked answer</span>
      <StudyText as="p" text={answer} className="mt-2 block text-lg font-medium leading-7 text-text-primary" />
      <StudyText as="p" text={solution} className="mt-3 block whitespace-pre-line text-sm leading-6 text-text-secondary" />
    </div>
  );
}

function StepError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-text-secondary">
      {message}
    </p>
  );
}
