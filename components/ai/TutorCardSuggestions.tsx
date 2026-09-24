"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button, JamiTutorIcon, StudyText } from "@/components/ui";
import type { JamiAssistantSuggestedCard } from "@/lib/ai/tutor-card-suggestions";
import { getSourcePanelHref } from "@/lib/app/tutor-views";
import { createFlashcardDraft } from "@/services/study/generated-content";

type CardState = "idle" | "saving" | "saved" | "failed";

/**
 * Flashcards Tutor offered in an answer.
 *
 * Saving one makes a draft in its source's review queue -- the same queue a
 * draft made from the source directly lands in -- so nothing joins a deck
 * until the student has approved it there. The offer is the study action; the
 * review is where it becomes a card.
 */
export default function TutorCardSuggestions({
  userId,
  cards,
}: {
  userId: string;
  cards: readonly JamiAssistantSuggestedCard[];
}) {
  const [states, setStates] = useState<CardState[]>(() => cards.map(() => "idle"));
  const savedSources = useMemo(() => {
    const seen = new Map<string, string>();
    cards.forEach((card, index) => {
      if (states[index] === "saved") seen.set(card.sourceId, card.sourceTitle);
    });
    return [...seen.entries()];
  }, [cards, states]);
  const unsaved = states.filter((state) => state === "idle" || state === "failed").length;
  const busy = states.some((state) => state === "saving");
  const anyFailed = states.some((state) => state === "failed");

  const setState = (index: number, state: CardState) =>
    setStates((current) => current.map((value, at) => (at === index ? state : value)));

  /*
   * Cards being saved or already saved, claimed as the save starts.
   *
   * Save all walks the list from the states it was clicked with, and a card
   * saved by hand while it runs still read as unsaved there -- so it was saved
   * again, and two identical drafts waited in review.
   */
  const claimed = useRef(new Set<number>());

  const save = async (index: number) => {
    const card = cards[index];
    if (!card || claimed.current.has(index)) return;
    claimed.current.add(index);
    setState(index, "saving");
    try {
      await createFlashcardDraft(userId, {
        front: card.front,
        back: card.back,
        topicIds: card.topicIds,
        // Reviewed alongside everything else made from this source.
        sourceType: "source",
        sourceId: card.sourceId,
      });
      setState(index, "saved");
    } catch (error) {
      console.error("Failed to save a suggested flashcard.", error);
      claimed.current.delete(index);
      setState(index, "failed");
    }
  };

  const saveAll = async () => {
    for (let index = 0; index < cards.length; index += 1) await save(index);
  };

  return (
    <section
      aria-label="Suggested flashcards"
      className="app-subtle-panel mt-2 overflow-hidden rounded-2xl"
    >
      <header className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-3.5 py-2.5">
        <JamiTutorIcon className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-primary">
            {cards.length} suggested {cards.length === 1 ? "card" : "cards"}
          </h3>
          <p className="text-2xs leading-4 text-text-muted">
            Saved cards wait in drafts for your approval.
          </p>
        </div>
        {unsaved > 1 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void saveAll()}
          >
            Save all
          </Button>
        ) : null}
      </header>

      <ol className="divide-y divide-[var(--color-border)]">
        {cards.map((card, index) => {
          const state = states[index] ?? "idle";
          return (
            <li key={`${card.sourceId}:${index}`} className="px-3.5 py-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-accent-muted)] text-2xs font-semibold tabular-nums text-text-secondary"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <StudyText
                    as="p"
                    text={card.front}
                    className="block text-sm font-medium leading-6 text-text-primary"
                  />
                  <StudyText
                    as="p"
                    text={card.back}
                    className="mt-1 block text-sm leading-6 text-text-secondary"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="min-w-0 truncate text-2xs text-text-muted">
                      From {card.sourceTitle}
                    </span>
                    {state === "saved" ? (
                      <span className="text-2xs font-semibold text-accent" role="status">
                        Saved to drafts
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={state === "saving"}
                        onClick={() => void save(index)}
                        className="rounded-full border border-accent/25 bg-accent/8 px-2.5 py-1 text-2xs font-semibold text-accent transition hover:border-accent/40 hover:bg-accent/12 disabled:cursor-wait disabled:opacity-60"
                      >
                        {state === "saving"
                          ? "Saving..."
                          : state === "failed"
                            ? "Try saving again"
                            : "Save to drafts"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {savedSources.length > 0 || anyFailed ? (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-border)] px-3.5 py-2.5 text-2xs">
          {anyFailed ? (
            <span className="text-[var(--color-error-text)]" role="alert">
              Some cards could not be saved. Try again.
            </span>
          ) : null}
          {savedSources.map(([sourceId, title]) => (
            <Link
              key={sourceId}
              href={getSourcePanelHref(sourceId, "drafts")}
              className="max-w-full truncate font-semibold text-accent underline-offset-2 hover:underline"
            >
              Review drafts from {title}
            </Link>
          ))}
        </footer>
      ) : null}
    </section>
  );
}
