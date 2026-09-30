"use client";

import { useState } from "react";
import type {
  SourceDraftDepth,
  SourceDraftKind,
} from "@/lib/ai/source-draft-quality";
import { Button, ButtonLink } from "@/components/ui";
import { getQuestionPracticeSessionHref } from "@/lib/app/routes";
import { featureFlags } from "@/lib/app/feature-flags";
import StudyMaterialFocusChat from "./StudyMaterialFocusChat";

export type SourceMadeCounts = {
  flashcards: number;
  questions: number;
};

/** A practice set this panel just made, to start from here. */
export type SourceMadePracticeSet = {
  sessionId: string;
  title: string;
  questionCount: number;
  totalMarks: number;
};

type SourceCreatePanelProps = {
  sourceId: string | null;
  made: SourceMadeCounts;
  drafting: SourceDraftKind | null;
  conversationFocusAvailable: boolean;
  useConversationFocus: boolean;
  onUseConversationFocusChange: (value: boolean) => void;
  onBriefChange: (brief: string) => void;
  madePracticeSet: SourceMadePracticeSet | null;
  onGenerate: (kind: SourceDraftKind, depth: SourceDraftDepth) => void;
};

const KINDS: Array<{
  kind: SourceDraftKind;
  label: string;
  detail: string;
  busyLabel: string;
}> = [
  {
    kind: "flashcard",
    label: "Flashcards",
    detail: "One concept each, for recall · reviewed here, then go to Learn",
    busyLabel: "Making…",
  },
  {
    kind: "practice-question",
    label: "Practice questions",
    detail: featureFlags.enablePastPaperPractice
      ? "A marked set you answer and Jami marks · saved to Practice"
      : "Longer questions with a worked answer · goes to a notebook",
    busyLabel: "Writing…",
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
  sourceId,
  made,
  drafting,
  conversationFocusAvailable,
  useConversationFocus,
  onUseConversationFocusChange,
  onBriefChange,
  madePracticeSet,
  onGenerate,
}: SourceCreatePanelProps) {
  const [depth, setDepth] = useState<SourceDraftDepth>("medium");

  const madeTotal = made.flashcards + made.questions;

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
      <p className="text-sm leading-6 text-text-muted">
        {madeTotal === 0
          ? "Turn this source into things you can actually study. Flashcards wait for your review; practice sets wait in Practice until you start them."
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

      {sourceId ? (
        <StudyMaterialFocusChat
          key={sourceId}
          sourceId={sourceId}
          disabled={drafting !== null}
          onBriefChange={onBriefChange}
        />
      ) : null}

      <div className="space-y-2.5">
        {KINDS.map((option) => {
          const busy = drafting === option.kind;
          const disabled = drafting !== null;
          const setReady = option.kind === "practice-question" ? madePracticeSet : null;

          return (
            <div
              key={option.kind}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-primary">{option.label}</div>
                  <div className="mt-0.5 text-xs leading-5 text-text-muted">{option.detail}</div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  disabled={disabled}
                  onClick={() => onGenerate(option.kind, depth)}
                >
                  {busy ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
                      {option.busyLabel}
                    </span>
                  ) : (
                    "Make"
                  )}
                </Button>
              </div>
              {busy && option.kind === "practice-question" ? (
                <p className="mt-2 text-xs leading-5 text-text-muted" role="status">
                  Writing questions and their mark schemes. This usually takes under a minute.
                </p>
              ) : null}
              {setReady && !busy ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent/20 bg-[var(--color-accent-muted)] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text-primary">
                      {setReady.title}
                    </div>
                    <div className="mt-0.5 text-xs leading-5 text-text-muted">
                      {setReady.questionCount} question{setReady.questionCount === 1 ? "" : "s"} ·{" "}
                      {setReady.totalMarks} mark{setReady.totalMarks === 1 ? "" : "s"} · waiting in Practice
                    </div>
                  </div>
                  <ButtonLink href={getQuestionPracticeSessionHref(setReady.sessionId)} size="sm" className="shrink-0">
                    Start
                  </ButtonLink>
                </div>
              ) : null}
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
