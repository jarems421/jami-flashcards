"use client";

import { useRef, useState } from "react";
import FlashcardDraftReview, {
  toFlashcardDraftState,
  type FlashcardDraftState,
} from "@/components/ai/FlashcardDraftReview";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  StudyText,
} from "@/components/ui";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import { updateGeneratedContentDraftStatus } from "@/services/study/generated-content";

type TutorDraftReviewDialogProps = {
  userId: string;
  title: string;
  drafts: GeneratedContentDraft[];
  onClose: () => void;
};

/**
 * Drafts with nowhere else to be reviewed.
 *
 * Every other draft belongs to a source and is reviewed in that source's
 * drawer. Flashcards Tutor makes in a notebook or flashcard chat have no
 * source, and a removed source leaves its drafts behind -- so they are
 * reviewed here, with the same controls as under the answer that made them.
 *
 * Opened with a key per group, so its state starts from the drafts it is given.
 */
export default function TutorDraftReviewDialog({
  userId,
  title,
  drafts,
  onClose,
}: TutorDraftReviewDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [cards, setCards] = useState<FlashcardDraftState[] | null>(() =>
    drafts.flatMap((draft) => {
      const state = toFlashcardDraftState(draft);
      return state ? [state] : [];
    })
  );
  const hint = drafts.find((draft) => draft.folderId || draft.deckId);
  const questions = drafts.filter((draft) => draft.kind === "practice-question");
  const [discardedQuestions, setDiscardedQuestions] = useState<Set<string>>(() => new Set());
  const [questionError, setQuestionError] = useState("");

  const discardQuestion = async (draftId: string) => {
    setQuestionError("");
    try {
      await updateGeneratedContentDraftStatus(userId, draftId, "rejected");
      setDiscardedQuestions((current) => new Set(current).add(draftId));
    } catch {
      setQuestionError("That question could not be discarded just now.");
    }
  };

  return (
    <Dialog
      open
      initialFocusRef={closeRef}
      className="fixed inset-0 flex items-end justify-center p-3 sm:items-center sm:p-4"
      onDismiss={onClose}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative flex max-h-[min(44rem,calc(100dvh-1.5rem))] w-full max-w-xl flex-col overflow-hidden rounded-xl shadow-e3">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold text-text-primary">Review drafts</DialogTitle>
            <DialogDescription className="mt-1 truncate text-sm text-text-muted">{title}</DialogDescription>
          </div>
          <Button ref={closeRef} type="button" variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {cards && cards.length > 0 ? (
            <FlashcardDraftReview
              userId={userId}
              title={`${cards.length} flashcard${cards.length === 1 ? "" : "s"}`}
              drafts={cards}
              onDraftsChange={setCards}
              folderId={hint?.folderId}
              deckId={hint?.deckId}
              suggestedDeckName="Tutor flashcards"
            />
          ) : null}

          {questions.length > 0 ? (
            <section>
              <p className="text-sm font-semibold text-text-primary">
                {questions.length} practice question{questions.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-text-muted">
                Drafted before practice questions became marked sets in Practice. Ask Tutor for a
                practice set on the same topic to answer them properly.
              </p>
              <ol className="mt-3 space-y-1.5">
                {questions.map((draft) => {
                  const discarded = discardedQuestions.has(draft.id);
                  return (
                    <li
                      key={draft.id}
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${
                        discarded
                          ? "border-transparent opacity-60"
                          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)]"
                      }`}
                    >
                      <StudyText
                        text={draft.questionText ?? draft.title}
                        className="min-w-0 flex-1 text-xs leading-5 text-text-primary"
                      />
                      {discarded ? (
                        <span className="shrink-0 pt-0.5 text-2xs font-semibold text-text-muted">Discarded</span>
                      ) : (
                        <button
                          type="button"
                          className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-text-muted transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                          onClick={() => void discardQuestion(draft.id)}
                        >
                          Discard
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
              {questionError ? (
                <p className="mt-2 text-xs leading-5 text-[var(--color-error-text)]" role="alert">
                  {questionError}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </DialogPanel>
    </Dialog>
  );
}
