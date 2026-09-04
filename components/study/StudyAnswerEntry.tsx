"use client";

import { useEffect, useRef, useState } from "react";
import { Button, StudyText, SymbolKeyboard } from "@/components/ui";
import type { MarkedAnswer } from "@/lib/study/answer-marking";
import type { ExerciseVerdict } from "@/lib/study/study-modes";

export type AnswerEntryState =
  | { phase: "answering" }
  | { phase: "checking" }
  | { phase: "marked"; result: MarkedAnswer };

type StudyAnswerEntryProps = {
  /** The card's question, or the sentence with a blank in it. */
  promptNode: React.ReactNode;
  label: string;
  placeholder: string;
  /** Multi-line for prose answers, single-line for a gap or a short fact. */
  multiline?: boolean;
  state: AnswerEntryState;
  hint?: string;
  hintUsed: boolean;
  onUseHint?: () => void;
  onSubmit: (response: string) => void;
  onSkip: () => void;
};

const VERDICT_TONE: Record<ExerciseVerdict, { label: string; classes: string }> = {
  correct: { label: "Correct", classes: "app-success" },
  close: { label: "Nearly", classes: "app-warning" },
  partial: { label: "Partly there", classes: "app-warning" },
  incorrect: { label: "Not this time", classes: "app-danger" },
  // Not a failure and not a pass: the marker is saying it cannot tell.
  "needs-self-grade": { label: "Jami is not sure", classes: "app-chip" },
};

/**
 * The typing half of Type Answer and Gap Fill.
 *
 * It collects a response and shows what the marker made of it. It never decides
 * what that means for the schedule -- the verdict goes back up to the page,
 * which asks the marking contract.
 */
export default function StudyAnswerEntry({
  promptNode,
  label,
  placeholder,
  multiline = false,
  state,
  hint,
  hintUsed,
  onUseHint,
  onSubmit,
  onSkip,
}: StudyAnswerEntryProps) {
  const [response, setResponse] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // Focus without scrolling: on a phone the keyboard appearing would
    // otherwise yank the card off screen the moment it mounts. No state reset
    // here -- the stage above is keyed on the card, so each card gets a fresh
    // field rather than a cleared one.
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const marked = state.phase === "marked" ? state.result : null;
  const busy = state.phase === "checking";
  const tone = marked ? VERDICT_TONE[marked.verdict] : null;

  const submit = () => {
    if (busy || marked) return;
    onSubmit(response);
  };

  const fieldClasses =
    "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-base text-text-primary outline-none transition duration-fast placeholder:text-text-muted focus:border-[var(--color-accent)] focus:ring-2 focus:ring-accent/35 disabled:opacity-70";

  return (
    <div className="space-y-4">
      {/*
        The same face treatment the flip card uses, at roughly the same height.
        Without it the question reads as a caption above a form rather than the
        thing being asked, and the session loses the one surface it is built
        around.
      */}
      <div className="study-flashcard-face flex min-h-[12rem] items-center justify-center rounded-2xl p-6 sm:min-h-[15rem] sm:p-10">
        {promptNode}
      </div>

      <div className="space-y-3">
        <label
          htmlFor="study-answer-entry"
          className="block text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted"
        >
          {label}
        </label>
        <div className="relative">
        {multiline ? (
          <textarea
            id="study-answer-entry"
            ref={(node) => {
              inputRef.current = node;
            }}
            rows={3}
            value={response}
            disabled={busy || Boolean(marked)}
            placeholder={placeholder}
            onChange={(event) => setResponse(event.target.value)}
            onKeyDown={(event) => {
              // Enter submits, Shift+Enter keeps a new line available for the
              // rare prose answer that wants one.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className={`${fieldClasses} resize-y pb-11 leading-7`}
          />
        ) : (
          <input
            id="study-answer-entry"
            ref={(node) => {
              inputRef.current = node;
            }}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={response}
            disabled={busy || Boolean(marked)}
            placeholder={placeholder}
            onChange={(event) => setResponse(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className={`${fieldClasses} pr-14`}
          />
        )}
          {/*
            Sits inside the field rather than above it. Typing an answer with a
            degree sign or a subscript in it should not mean leaving the field,
            and on an iPad the alternative is hunting through the system
            keyboard's third page.
          */}
          <SymbolKeyboard
            targetRef={inputRef}
            className={
              multiline
                ? "absolute bottom-3 right-3"
                : "absolute right-3 top-1/2 -translate-y-1/2"
            }
          />
        </div>

        {hint && hintUsed ? (
          <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-2.5 text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">Hint. </span>
            {hint}
          </p>
        ) : null}

        {marked ? (
          <div
            role="status"
            aria-live="polite"
            className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4"
          >
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${tone?.classes ?? ""}`}
            >
              {tone?.label}
            </span>
            {marked.unitMismatch ? (
              <p className="text-sm text-text-secondary">
                The value is right. Check the units.
              </p>
            ) : null}
            {marked.missingItems && marked.missingItems.length > 0 ? (
              <p className="text-sm text-text-secondary">
                Still missing: {marked.missingItems.join(", ")}.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <Button type="button" onClick={submit} disabled={busy} size="md">
              {busy ? "Checking..." : "Check answer"}
            </Button>
            {hint && !hintUsed && onUseHint ? (
              <Button type="button" variant="secondary" size="md" onClick={onUseHint}>
                Give me a hint
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="md" onClick={onSkip}>
              I don&apos;t know
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The question above the field, rendered with maths and Markdown intact. */
export function StudyPromptText({ text }: { text: string }) {
  return (
    <StudyText
      as="p"
      text={text}
      className="whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-text-primary sm:text-2xl"
    />
  );
}
