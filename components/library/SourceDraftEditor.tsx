"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { GeneratedContentDraft } from "@/lib/practice/generated-content";
import type { Topic } from "@/lib/practice/topics";
import type { Deck } from "@/lib/study/decks";
import type { Notebook } from "@/lib/workspace/notebooks";
import {
  convertFlashcardDraftToCard,
  convertPracticeQuestionDraftToNotebookPage,
  updateGeneratedContentDraftContent,
  updateGeneratedContentDraftStatus,
} from "@/services/study/generated-content";
import TopicPicker from "@/components/topics/TopicPicker";
import { Button, StudyText, Textarea } from "@/components/ui";

// Long enough that a typed sentence costs one write rather than one per key.
const AUTOSAVE_DELAY_MS = 900;

export default function SourceDraftEditor({
  draft,
  topics,
  decks,
  notebooks,
  selectedDeckId,
  selectedNotebookId,
  onDeckChange,
  onNotebookChange,
  onSaved,
  onTopicsChange,
  userId,
  sourceTitle,
}: {
  draft: GeneratedContentDraft;
  topics: Topic[];
  decks: Deck[];
  notebooks: Notebook[];
  selectedDeckId: string;
  selectedNotebookId: string;
  onDeckChange: (value: string) => void;
  onNotebookChange: (value: string) => void;
  onSaved: (message: string) => void;
  onTopicsChange: (topics: Topic[]) => void;
  userId: string;
  sourceTitle?: string;
}) {
  const [front, setFront] = useState(draft.front ?? "");
  const [back, setBack] = useState(draft.back ?? "");
  const [questionText, setQuestionText] = useState(draft.questionText ?? "");
  const [answerText, setAnswerText] = useState(draft.answerText ?? "");
  const [solutionText, setSolutionText] = useState(draft.solutionText ?? "");
  const [topicIds, setTopicIds] = useState(draft.topicIds);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Set only by a real edit, so loading a draft never writes it straight back.
  const dirtyRef = useRef(false);
  const markDirty = () => {
    dirtyRef.current = true;
  };
  const isFlashcard = draft.kind === "flashcard";

  // Mirrors the fields shown above, so the preview always reflects what is
  // actually being edited rather than a fixed pair.
  const previewFields = (
    isFlashcard
      ? [
          { label: "Front", value: front },
          { label: "Back", value: back },
        ]
      : [
          { label: "Question", value: questionText },
          { label: "Expected answer", value: answerText },
          { label: "Solution notes", value: solutionText },
        ]
  ).filter((field) => field.value.trim());

  useEffect(() => {
    setFront(draft.front ?? "");
    setBack(draft.back ?? "");
    setQuestionText(draft.questionText ?? "");
    setAnswerText(draft.answerText ?? "");
    setSolutionText(draft.solutionText ?? "");
    setTopicIds(draft.topicIds);
    // Loading a different draft is not an edit, so nothing should be written
    // back and the previous draft's status should not carry over.
    dirtyRef.current = false;
    setSaveState("idle");
  }, [draft]);

  /**
   * Edits save themselves.
   *
   * A save button on a draft made no sense: the whole screen is a draft, and
   * leaving without pressing it silently lost work. Writes are debounced so a
   * sentence costs one write rather than one per keystroke, and only run when
   * the student actually changed something, which is what dirtyRef tracks.
   * Nothing is reported upward, because a toast and a reload on every pause
   * would be worse than the button was.
   */
  useEffect(() => {
    if (!dirtyRef.current) return;

    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        await updateGeneratedContentDraftContent(
          userId,
          draft.id,
          isFlashcard
            ? { front, back, topicIds }
            : { questionText, answerText, solutionText, topicIds }
        );
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [
    answerText,
    back,
    draft.id,
    front,
    isFlashcard,
    questionText,
    solutionText,
    topicIds,
    userId,
  ]);

  return (
    <div className="rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {isFlashcard ? "Flashcard draft" : "Notebook question draft"}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            Draft - based on a saved source. Review before it enters Learn or a notebook.
          </div>
        </div>
        <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
          Based on: {sourceTitle ?? "Saved source"}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {isFlashcard ? (
          <>
            <Textarea label="Front" rows={3} value={front} onChange={(event) => { markDirty(); setFront(event.target.value); }} />
            <Textarea label="Back" rows={4} value={back} onChange={(event) => { markDirty(); setBack(event.target.value); }} />
          </>
        ) : (
          <>
            <Textarea
              label="Question"
              rows={3}
              value={questionText}
              onChange={(event) => { markDirty(); setQuestionText(event.target.value); }}
            />
            <Textarea
              label="Expected answer"
              rows={3}
              value={answerText}
              onChange={(event) => { markDirty(); setAnswerText(event.target.value); }}
            />
            <Textarea
              label="Solution notes"
              rows={3}
              value={solutionText}
              onChange={(event) => { markDirty(); setSolutionText(event.target.value); }}
            />
          </>
        )}

        {/*
          Drafts arrive written in LaTeX, and a textarea can only show the
          source. Reviewing a batch means judging whether each one is right,
          which is impossible while the maths is still "$\frac{a}{b}$".
        */}
        {previewFields.length > 0 ? (
          <div className="app-subtle-panel rounded-[1.25rem] p-4">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
              Preview
            </div>
            <div className="mt-3 space-y-3">
              {previewFields.map((field) => (
                <div key={field.label}>
                  <div className="text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">
                    {field.label}
                  </div>
                  <StudyText
                    as="div"
                    text={field.value}
                    className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-primary"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <TopicPicker
          userId={userId}
          topics={topics}
          selectedTopicIds={topicIds}
          onChange={(next) => { markDirty(); setTopicIds(next); }}
          onTopicsChange={onTopicsChange}
          disabled={busy}
        />
        {isFlashcard ? (
          decks.length > 0 ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                Destination deck
              </span>
              <select
                value={selectedDeckId}
                onChange={(event) => onDeckChange(event.target.value)}
                className="mt-2 min-h-[2.8rem] w-full rounded-2xl border border-[var(--color-border)] bg-surface-panel-strong px-3 text-sm text-text-primary outline-none focus:border-warm-accent"
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-[1.15rem] border border-warm-border bg-warm-glow p-3 text-sm leading-6 text-text-secondary">
              <div className="font-semibold text-text-primary">
                Create a deck before adding this flashcard.
              </div>
              <p className="mt-1">
                Drafts can stay here, but flashcards need a deck before they join Learn.
              </p>
              <Link
                href="/dashboard/decks"
                className="mt-3 inline-flex min-h-[2.4rem] items-center justify-center rounded-full border border-warm-border bg-[var(--color-glass-subtle)] px-3 text-xs font-semibold text-warm-accent transition hover:bg-[var(--color-glass-strong,var(--color-glass-subtle))]"
              >
                Create deck
              </Link>
            </div>
          )
        ) : notebooks.length > 0 ? (
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
              Destination notebook
            </span>
            <select
              value={selectedNotebookId}
              onChange={(event) => onNotebookChange(event.target.value)}
              className="mt-2 min-h-[2.8rem] w-full rounded-2xl border border-[var(--color-border)] bg-surface-panel-strong px-3 text-sm text-text-primary outline-none focus:border-warm-accent"
            >
              {notebooks.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-[1.15rem] border border-warm-border bg-warm-glow p-3 text-sm leading-6 text-text-secondary">
            <div className="font-semibold text-text-primary">
              Create a notebook before approving this question draft.
            </div>
            <p className="mt-1">
              Question drafts become notebook pages so students can work naturally.
            </p>
            <Link
              href="/dashboard/folders"
              className="mt-3 inline-flex min-h-[2.4rem] items-center justify-center rounded-full border border-warm-border bg-[var(--color-glass-subtle)] px-3 text-xs font-semibold text-warm-accent transition hover:bg-[var(--color-glass-strong,var(--color-glass-subtle))]"
            >
              Open folders
            </Link>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-live="polite"
            className="mr-auto text-xs font-medium text-text-muted"
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "error"
                ? "Could not save. Your edits are still here."
                : saveState === "saved"
                  ? "Saved"
                  : ""}
          </span>
          <Button
            type="button"
            disabled={busy || (isFlashcard ? !selectedDeckId : !selectedNotebookId)}
            onClick={async () => {
              setBusy(true);
              try {
                await updateGeneratedContentDraftContent(
                  userId,
                  draft.id,
                  isFlashcard
                    ? { front, back, topicIds }
                    : { questionText, answerText, solutionText, topicIds }
                );
                if (isFlashcard) {
                  await convertFlashcardDraftToCard(userId, { draftId: draft.id, deckId: selectedDeckId });
                  onSaved("Card added to your deck. You can review it in Learn.");
                } else {
                  await convertPracticeQuestionDraftToNotebookPage(userId, { draftId: draft.id, notebookId: selectedNotebookId });
                  onSaved("Question page added to your notebook. Open it from Practice when you are ready.");
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {isFlashcard ? "Add to deck" : "Add to notebook"}
          </Button>
          <button
            type="button"
            aria-label="Reject this draft"
            title="Reject this draft"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateGeneratedContentDraftStatus(userId, draft.id, "rejected");
                onSaved("Draft rejected.");
              } finally {
                setBusy(false);
              }
            }}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-error-muted hover:text-[var(--color-error-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M4 6h12M8.5 6V4.8c0-.44.36-.8.8-.8h1.4c.44 0 .8.36.8.8V6m-6.2 0 .6 8.6c.03.42.38.75.8.75h4.6c.42 0 .77-.33.8-.75L15.1 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
