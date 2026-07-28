"use client";

import { useState } from "react";
import type { SourceDraftKind } from "@/services/ai/source-drafts";
import { Button } from "@/components/ui";

export type SourceMadeCounts = {
  flashcards: number;
  questions: number;
};

type SourceCreatePanelProps = {
  made: SourceMadeCounts;
  drafting: SourceDraftKind | null;
  conversationFocusAvailable: boolean;
  useConversationFocus: boolean;
  onUseConversationFocusChange: (value: boolean) => void;
  onGenerate: (kind: SourceDraftKind, count: number) => void;
};

const KINDS: Array<{
  kind: SourceDraftKind;
  label: string;
  detail: string;
  destination: string;
  min: number;
  max: number;
  fallback: number;
}> = [
  {
    kind: "flashcard",
    label: "Flashcards",
    detail: "One concept each, for recall practice",
    destination: "Learn",
    min: 1,
    max: 20,
    fallback: 10,
  },
  {
    kind: "practice-question",
    label: "Practice questions",
    detail: "Longer questions with a worked answer",
    destination: "a notebook",
    min: 1,
    max: 5,
    fallback: 3,
  },
];

function Stepper({
  value,
  min,
  max,
  disabled,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  label: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-1">
      <button
        type="button"
        aria-label={`One fewer ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        className="grid h-7 w-7 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        &minus;
      </button>
      <span
        aria-live="polite"
        className="min-w-[1.75rem] text-center text-sm font-semibold tabular-nums text-text-primary"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`One more ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        className="grid h-7 w-7 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        +
      </button>
    </div>
  );
}

/**
 * Making study material out of a source.
 *
 * This used to be two chips inside the Jami drawer, which put a batch job that
 * writes records to the library among prompt shortcuts that return prose, and
 * hid it as soon as the conversation started. Here it is a place: what this
 * source has already produced, what it can produce, and how much.
 */
export default function SourceCreatePanel({
  made,
  drafting,
  conversationFocusAvailable,
  useConversationFocus,
  onUseConversationFocusChange,
  onGenerate,
}: SourceCreatePanelProps) {
  const [counts, setCounts] = useState<Record<SourceDraftKind, number>>({
    flashcard: 10,
    "practice-question": 3,
  });

  const madeTotal = made.flashcards + made.questions;

  return (
    <div className="space-y-4 rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
      <p className="text-sm leading-6 text-text-muted">
        {madeTotal === 0
          ? "Turn this source into things you can actually study. Everything is a draft until you approve it."
          : `Made so far: ${made.flashcards} flashcard${made.flashcards === 1 ? "" : "s"} and ${made.questions} practice question${made.questions === 1 ? "" : "s"}.`}
      </p>

      <div className="space-y-2.5">
        {KINDS.map((option) => {
          const busy = drafting === option.kind;
          const disabled = drafting !== null;

          return (
            <div
              key={option.kind}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[1.15rem] border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">{option.label}</div>
                <div className="mt-0.5 text-xs leading-5 text-text-muted">
                  {option.detail} · goes to {option.destination}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Stepper
                  value={counts[option.kind]}
                  min={option.min}
                  max={option.max}
                  disabled={disabled}
                  label={option.label.toLowerCase()}
                  onChange={(next) =>
                    setCounts((current) => ({ ...current, [option.kind]: next }))
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onGenerate(option.kind, counts[option.kind])}
                >
                  {busy ? "Making…" : "Make"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {conversationFocusAvailable ? (
        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-text-secondary">
          <input
            type="checkbox"
            checked={useConversationFocus}
            disabled={drafting !== null}
            onChange={(event) => onUseConversationFocusChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            Focus on what you have been discussing with Jami about this source,
            rather than covering it evenly.
          </span>
        </label>
      ) : null}
    </div>
  );
}
