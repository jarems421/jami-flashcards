"use client";

import { useEffect, useState } from "react";
import { Button, StudyText } from "@/components/ui";
import type { McqQuestion } from "@/lib/study/mcq";

const OPTION_SHORTCUTS = ["1", "2", "3", "4"];

type StudyMultipleChoiceProps = {
  prompt: string;
  question: McqQuestion;
  onAnswered: (correct: boolean) => void;
  onContinue: (correct: boolean) => void;
};

/**
 * Multiple choice, which schedules like every other mode.
 *
 * It used to be practice-only, on the grounds that recognising an answer among
 * four is weaker evidence than producing it. What made that true was the wrong
 * options: assembled from other cards in the deck, they were answerable by
 * elimination, so a right answer meant very little. The options are written for
 * the card now -- by Jami during preparation, or by the student -- and a
 * question nobody can pass without knowing the material is evidence worth
 * scheduling on. A card that cannot get options that good is not asked this
 * way at all.
 */
export default function StudyMultipleChoice({
  prompt,
  question,
  onAnswered,
  onContinue,
}: StudyMultipleChoiceProps) {
  // No reset effect: the stage above is keyed on the card, so a new card
  // arrives as a new component with a fresh selection.
  const [chosenId, setChosenId] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (chosenId) {
        if (event.key === "Enter" || event.code === "Space") {
          event.preventDefault();
          onContinue(chosenId === question.correctOptionId);
        }
        return;
      }
      const position = OPTION_SHORTCUTS.indexOf(event.key);
      const option = position >= 0 ? question.options[position] : undefined;
      if (!option) return;
      event.preventDefault();
      setChosenId(option.id);
      onAnswered(option.id === question.correctOptionId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chosenId, onAnswered, onContinue, question.correctOptionId, question.options]);

  const choose = (optionId: string) => {
    if (chosenId) return;
    setChosenId(optionId);
    onAnswered(optionId === question.correctOptionId);
  };

  return (
    <div className="space-y-4">
      <div className="study-flashcard-face flex min-h-[12rem] items-center justify-center rounded-2xl p-6 sm:min-h-[15rem] sm:p-10">
        <StudyText
          as="p"
          text={prompt}
          className="whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-text-primary sm:text-2xl"
        />
      </div>

      <div
        role="radiogroup"
        aria-label="Answer choices"
        className="grid gap-2.5 sm:grid-cols-2"
      >
        {question.options.map((option, position) => {
          const isCorrect = option.id === question.correctOptionId;
          const isChosen = option.id === chosenId;
          const revealed = Boolean(chosenId);
          const tone = !revealed
            ? "border-[var(--color-border)] bg-[var(--color-glass-subtle)] hover:border-border-strong hover:bg-[var(--color-glass-medium)]"
            : isCorrect
              ? "app-success border-emerald-300/45"
              : isChosen
                ? "app-danger border-rose-300/45"
                : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] opacity-55";

          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={revealed}
              onClick={() => choose(option.id)}
              className={`flex min-h-[3.75rem] items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition duration-fast ease-spring hover:-translate-y-[0.5px] active:scale-[0.99] disabled:cursor-default disabled:hover:translate-y-0 ${tone}`}
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 text-2xs leading-none tabular-nums opacity-75">
                {OPTION_SHORTCUTS[position] ?? position + 1}
              </span>
              <StudyText as="span" text={option.text} className="min-w-0 flex-1" />
            </button>
          );
        })}
      </div>

      {chosenId ? (
        <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
          <p role="status" aria-live="polite" className="text-sm text-text-secondary">
            {question.explanations[chosenId] ??
              (chosenId === question.correctOptionId
                ? "That is the answer on this card."
                : "Not this one.")}
          </p>
          <Button
            type="button"
            onClick={() => onContinue(chosenId === question.correctOptionId)}
            size="md"
          >
            Next card
          </Button>
        </div>
      ) : null}
    </div>
  );
}
