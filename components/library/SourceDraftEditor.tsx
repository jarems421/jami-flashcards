"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Topic } from "@/lib/practice/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { Deck } from "@/services/study/decks";
import {
  convertFlashcardDraftToCard,
  convertPracticeQuestionDraftToNotebookPage,
  updateGeneratedContentDraftContent,
  updateGeneratedContentDraftStatus,
  type GeneratedContentDraft,
} from "@/services/study/generated-content";
import TopicPicker from "@/components/topics/TopicPicker";
import { Button, Textarea } from "@/components/ui";

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
  const isFlashcard = draft.kind === "flashcard";

  useEffect(() => {
    setFront(draft.front ?? "");
    setBack(draft.back ?? "");
    setQuestionText(draft.questionText ?? "");
    setAnswerText(draft.answerText ?? "");
    setSolutionText(draft.solutionText ?? "");
    setTopicIds(draft.topicIds);
  }, [draft]);

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
            <Textarea label="Front" rows={3} value={front} onChange={(event) => setFront(event.target.value)} />
            <Textarea label="Back" rows={4} value={back} onChange={(event) => setBack(event.target.value)} />
          </>
        ) : (
          <>
            <Textarea
              label="Question"
              rows={3}
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
            />
            <Textarea
              label="Expected answer"
              rows={3}
              value={answerText}
              onChange={(event) => setAnswerText(event.target.value)}
            />
            <Textarea
              label="Solution notes"
              rows={3}
              value={solutionText}
              onChange={(event) => setSolutionText(event.target.value)}
            />
          </>
        )}
        <TopicPicker
          userId={userId}
          topics={topics}
          selectedTopicIds={topicIds}
          onChange={setTopicIds}
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
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
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
                onSaved("Draft edits saved.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save edits
          </Button>
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
          <Button
            type="button"
            variant="secondary"
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
          >
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
