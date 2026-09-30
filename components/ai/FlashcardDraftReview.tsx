"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { JamiTutorIcon, StudyText } from "@/components/ui";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import { chooseDraftDestinationDeck, type Deck } from "@/lib/study/decks";
import { createDeck, getDecks } from "@/services/study/decks";
import {
  convertFlashcardDraftToCard,
  updateGeneratedContentDraftStatus,
} from "@/services/study/generated-content";

export type FlashcardDraftState = {
  id: string;
  front: string;
  back: string;
  status: "draft" | "added" | "discarded";
};

/** A stored draft as a row to review, or nothing when it is not a usable card. */
export function toFlashcardDraftState(draft: GeneratedContentDraft): FlashcardDraftState | null {
  if (draft.kind !== "flashcard" || !draft.front || !draft.back) return null;
  return {
    id: draft.id,
    front: draft.front,
    back: draft.back,
    status:
      draft.contentStatus === "approved"
        ? "added"
        : draft.contentStatus === "rejected" || draft.contentStatus === "archived"
          ? "discarded"
          : "draft",
  };
}

type FlashcardDraftReviewProps = {
  userId: string;
  title: string;
  drafts: FlashcardDraftState[] | null;
  onDraftsChange: Dispatch<SetStateAction<FlashcardDraftState[] | null>>;
  /** Where the cards most likely belong, for choosing a deck. */
  folderId?: string;
  deckId?: string;
  /** What a new deck is called when the student has none. */
  suggestedDeckName: string;
  readOnly?: boolean;
};

/**
 * Keeping or discarding drafted flashcards, one at a time or all at once.
 *
 * Used under the Tutor answer that made them and on the Tutor page, so a
 * card drafted in a notebook or flashcard chat -- which has no source whose
 * review drawer could hold it -- can still be reviewed after the chat closes.
 */
export default function FlashcardDraftReview({
  userId,
  title,
  drafts,
  onDraftsChange,
  folderId,
  deckId: studiedDeckId,
  suggestedDeckName,
  readOnly = false,
}: FlashcardDraftReviewProps) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [deckId, setDeckId] = useState("");
  const [newDeckName, setNewDeckName] = useState(suggestedDeckName);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getDecks(userId)
      .then((loaded) => {
        if (!active) return;
        setDecks(loaded);
        setDeckId(chooseDraftDestinationDeck(loaded, { deckId: studiedDeckId, folderId }));
      })
      .catch(() => active && setDecks([]));
    return () => {
      active = false;
    };
  }, [folderId, studiedDeckId, userId]);

  const waiting = useMemo(() => (drafts ?? []).filter((draft) => draft.status === "draft"), [drafts]);
  const added = (drafts ?? []).filter((draft) => draft.status === "added").length;
  const deckName = decks?.find((deck) => deck.id === deckId)?.name;
  const total = drafts?.length ?? 0;

  const setStatusOf = (ids: readonly string[], next: FlashcardDraftState["status"]) =>
    onDraftsChange((current) =>
      (current ?? []).map((draft) => (ids.includes(draft.id) ? { ...draft, status: next } : draft))
    );

  /** The chosen deck, or a new one named for the topic when the student has none. */
  const destinationDeckId = async () => {
    if (deckId) return deckId;
    const name = newDeckName.trim();
    if (!name) throw new Error("Name the new deck first.");
    const created = await createDeck(userId, name, folderId ? { folderIds: [folderId] } : {});
    setDecks((current) => [created, ...(current ?? [])]);
    setDeckId(created.id);
    return created.id;
  };

  const addCards = async (ids: readonly string[]) => {
    if (busyId || ids.length === 0) return;
    setBusyId(ids.length === 1 ? ids[0]! : "all");
    setError("");
    try {
      const target = await destinationDeckId();
      const done: string[] = [];
      for (const draftId of ids) {
        await convertFlashcardDraftToCard(userId, { draftId, deckId: target });
        done.push(draftId);
      }
      setStatusOf(done, "added");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Those cards could not be added.");
    } finally {
      setBusyId(null);
    }
  };

  const discardCards = async (ids: readonly string[]) => {
    if (busyId || ids.length === 0) return;
    setBusyId(ids.length === 1 ? ids[0]! : "discard");
    setError("");
    try {
      await Promise.all(ids.map((draftId) => updateGeneratedContentDraftStatus(userId, draftId, "rejected")));
      setStatusOf(ids, "discarded");
    } catch {
      setError("Those drafts could not be discarded just now.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <ReviewHeading
        title={title}
        detail={
          waiting.length === 0 && drafts
            ? added > 0
              ? `${added} added${deckName ? ` to ${deckName}` : ""}. You will see them in Learn.`
              : "All discarded."
            : "Keep the ones worth revising. Nothing is added until you say."
        }
      />

      {drafts === null ? (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-12 animate-pulse rounded-lg bg-[var(--color-glass-subtle)]" />
          <div className="h-12 animate-pulse rounded-lg bg-[var(--color-glass-subtle)]" />
        </div>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {drafts.map((draft, index) => (
            <li
              key={draft.id}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 transition duration-fast ${
                draft.status === "draft"
                  ? "border-[var(--color-border)] bg-[var(--color-glass-subtle)]"
                  : "border-transparent bg-transparent opacity-60"
              }`}
            >
              <span className="mt-0.5 w-4 shrink-0 text-2xs font-semibold tabular-nums text-text-muted">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 text-xs leading-5">
                <StudyText text={draft.front} className="block font-semibold text-text-primary" />
                <StudyText text={draft.back} className="mt-0.5 block text-text-secondary" />
              </div>
              {draft.status === "draft" && !readOnly ? (
                <div className="flex shrink-0 items-center gap-1">
                  <IconAction
                    label="Add this card"
                    disabled={busyId !== null}
                    onClick={() => void addCards([draft.id])}
                  >
                    <path d="M4 10.5l3.5 3.5L16 5.5" />
                  </IconAction>
                  <IconAction
                    label="Discard this card"
                    disabled={busyId !== null}
                    onClick={() => void discardCards([draft.id])}
                  >
                    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
                  </IconAction>
                </div>
              ) : draft.status !== "draft" ? (
                <span className="shrink-0 pt-0.5 text-2xs font-semibold text-text-muted">
                  {draft.status === "added" ? "Added" : "Discarded"}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {!readOnly && waiting.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
          {decks && decks.length > 0 ? (
            <label className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-xs text-text-muted">
              <span className="shrink-0">Deck</span>
              <select
                value={deckId}
                disabled={busyId !== null}
                onChange={(event) => setDeckId(event.target.value)}
                className="app-field min-w-0 flex-1 rounded-lg py-1.5 pl-2.5 pr-2 text-xs text-text-primary outline-none"
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
          ) : decks ? (
            <label className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-xs text-text-muted">
              <span className="shrink-0">New deck</span>
              <input
                value={newDeckName}
                disabled={busyId !== null}
                maxLength={80}
                onChange={(event) => setNewDeckName(event.target.value)}
                className="app-field min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs text-text-primary outline-none"
              />
            </label>
          ) : null}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={busyId !== null || decks === null}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
              onClick={() => void discardCards(waiting.map((draft) => draft.id))}
            >
              {busyId === "discard" ? "Discarding…" : "Discard rest"}
            </button>
            <button
              type="button"
              disabled={busyId !== null || decks === null}
              className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-on shadow-accent transition duration-fast hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
              onClick={() => void addCards(waiting.map((draft) => draft.id))}
            >
              {busyId === "all" ? "Adding…" : `Add ${waiting.length === total ? "all" : waiting.length}`}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs leading-5 text-[var(--color-error-text)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReviewHeading({ title, detail }: { title: string; detail: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-muted)] text-accent">
        <JamiTutorIcon className="h-[1.1rem] w-[1.1rem]" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-5 text-text-primary">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-text-muted">{detail}</p>
      </div>
    </div>
  );
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
