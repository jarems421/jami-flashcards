"use client";

import { useState } from "react";
import type {
  SourceDraftDepth,
  SourceDraftKind,
} from "@/lib/ai/source-draft-quality";
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
  onGenerate: (kind: SourceDraftKind, depth: SourceDraftDepth) => void;
};

const KINDS: Array<{
  kind: SourceDraftKind;
  label: string;
  detail: string;
  destination: string;
}> = [
  {
    kind: "flashcard",
    label: "Flashcards",
    detail: "One concept each, for recall practice",
    destination: "Learn",
  },
  {
    kind: "practice-question",
    label: "Practice questions",
    detail: "Longer questions with a worked answer",
    destination: "a notebook",
  },
];

const DEPTHS: Array<{ value: SourceDraftDepth; label: string; detail: string }> = [
  { value: "low", label: "Light", detail: "Just the ideas you cannot do without" },
  { value: "medium", label: "Standard", detail: "Main ideas and the detail that matters" },
  { value: "high", label: "Thorough", detail: "Close coverage, including distinctions and exceptions" },
];

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
  const [depth, setDepth] = useState<SourceDraftDepth>("medium");

  const madeTotal = made.flashcards + made.questions;

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
      <p className="text-sm leading-6 text-text-muted">
        {madeTotal === 0
          ? "Turn this source into things you can actually study. Everything is a draft until you approve it."
          : `Made so far: ${made.flashcards} flashcard${made.flashcards === 1 ? "" : "s"} and ${made.questions} practice question${made.questions === 1 ? "" : "s"}.`}
      </p>

      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
          How thorough
        </div>
        <div role="radiogroup" aria-label="How thorough" className="mt-2 grid gap-1.5 sm:grid-cols-3">
          {DEPTHS.map((option) => {
            const active = depth === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={drafting !== null}
                onClick={() => setDepth(option.value)}
                className={`rounded-md border p-2.5 text-left transition duration-fast disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                    : "border-[var(--color-border)] hover:border-border-strong hover:bg-[var(--color-glass-medium)]"
                }`}
              >
                <span className="block text-sm font-semibold text-text-primary">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs leading-4 text-text-muted">
                  {option.detail}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5">
        {KINDS.map((option) => {
          const busy = drafting === option.kind;
          const disabled = drafting !== null;

          return (
            <div
              key={option.kind}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">{option.label}</div>
                <div className="mt-0.5 text-xs leading-5 text-text-muted">
                  {option.detail} · goes to {option.destination}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={disabled}
                onClick={() => onGenerate(option.kind, depth)}
              >
                {busy ? "Making…" : "Make"}
              </Button>
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
