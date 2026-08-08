"use client";

import Link from "next/link";
import type { Topic } from "@/lib/material/topics";
import {
  getCardContentKey,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  type Card,
} from "@/lib/study/cards";
import { getCardQualityWarnings } from "@/lib/study/card-quality";
import { getDeckHref } from "@/lib/app/routes";
import { featureFlags } from "@/lib/app/feature-flags";
import type { CardBrowserController } from "@/hooks/useCardBrowser";
import type { CardBulkActionsController } from "@/hooks/useCardBulkActions";
import type { CardEditingController } from "@/hooks/useCardEditing";
import CardActionsMenu from "@/components/decks/CardActionsMenu";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardFaceSummary from "@/components/decks/CardFaceSummary";
import CardQualityWarnings from "@/components/decks/CardQualityWarnings";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import TopicPicker from "@/components/topics/TopicPicker";
import { Button, ConfirmDialog, Input } from "@/components/ui";

type CardGridProps = {
  userId: string;
  cards: Card[];
  topics: Topic[];
  onTopicsChange: (topics: Topic[]) => void;
  deckNamesById: Record<string, string>;
  topicNamesById: Record<string, string>;
  duplicateCounts: Map<string, number>;
  browser: CardBrowserController;
  bulk: CardBulkActionsController;
  editing: CardEditingController;
};

export default function CardGrid({
  userId,
  cards,
  topics,
  onTopicsChange,
  deckNamesById,
  topicNamesById,
  duplicateCounts,
  browser,
  bulk,
  editing,
}: CardGridProps) {
  const { draft, rows } = editing;
  const { results } = browser;
  const pendingDeleteId = editing.deletion.pendingCardId;

  return (
    <>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this card?"
        description="This permanently removes the card from its deck and review queue. This cannot be undone."
        confirmLabel="Delete card"
        busy={pendingDeleteId !== null && rows.isDeleting(pendingDeleteId)}
        onClose={editing.deletion.close}
        onConfirm={() => void editing.deletion.confirm()}
      />

      <div
        id={!results.showingFilteredResults ? "recent-cards-grid" : undefined}
        className="grid auto-rows-fr animate-slide-up touch-pan-y gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {cards.map((card) => (
          <section
            key={card.id}
            className={`app-panel min-w-0 overflow-visible p-3 transition duration-fast ease-spring has-[details[open]]:z-40 hover:-translate-y-0.5 hover:shadow-shell ${
              rows.isEditing(card.id) ? "sm:col-span-2" : "min-h-[8.5rem]"
            } ${
              bulk.selection.idSet.has(card.id)
                ? "border-accent/45 ring-2 ring-accent/20"
                : ""
            }`}
          >
            {rows.isEditing(card.id) ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <CardDifficultyBadge card={card} compact />
                  <label
                    className="flex h-10 w-10 cursor-pointer items-center justify-center"
                    title="Select card"
                  >
                    <span className="sr-only">Select card</span>
                    <input
                      type="checkbox"
                      aria-label={`Select card: ${card.front}`}
                      checked={bulk.selection.idSet.has(card.id)}
                      onClick={(event) =>
                        bulk.selection.handleCheckboxClick(card.id, event)
                      }
                      onChange={() => undefined}
                      className="h-[1.1rem] w-[1.1rem] accent-[var(--color-accent)]"
                    />
                  </label>
                </div>
                <CardQualityWarnings
                  warnings={getCardQualityWarnings(
                    {
                      front: draft.front,
                      back: draft.back,
                      topicIds: draft.topicIds,
                    },
                    {
                      duplicateCount: duplicateCounts.get(
                        getCardContentKey(card.front, card.back)
                      ),
                    }
                  )}
                />
                <Input
                  label="Front"
                  value={draft.front}
                  onChange={(event) =>
                    rows.updateDraft({ front: event.target.value })
                  }
                  maxLength={MAX_FRONT_LENGTH}
                />
                <CardBackEditor
                  label="Back"
                  value={draft.back}
                  onChange={(back) => rows.updateDraft({ back })}
                  maxLength={MAX_BACK_LENGTH}
                  rows={6}
                  disabled={rows.isSaving(card.id)}
                  action={
                    featureFlags.enableFlashcardAi ? (
                      <CardBackAutocomplete
                        front={draft.front}
                        currentBack={draft.back}
                        deckId={card.deckId}
                        deckName={deckNamesById[card.deckId]}
                        topics={draft.topicIds
                          .map((topicId) => topicNamesById[topicId])
                          .filter(
                            (name): name is string => Boolean(name)
                          )}
                        topicIds={draft.topicIds}
                        disabled={rows.isSaving(card.id)}
                        onApply={(back) => rows.updateDraft({ back })}
                      />
                    ) : null
                  }
                />
                <TopicPicker
                  userId={userId}
                  topics={topics}
                  selectedTopicIds={draft.topicIds}
                  onChange={(topicIds) => rows.updateDraft({ topicIds })}
                  onTopicsChange={onTopicsChange}
                  disabled={rows.isSaving(card.id)}
                />
                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button
                    type="button"
                    disabled={rows.isSaving(card.id)}
                    onClick={() => void editing.save(card.id)}
                    className="w-full sm:w-auto"
                  >
                    {rows.isSaving(card.id) ? "Saving..." : "Save card"}
                  </Button>
                  <Button
                    type="button"
                    disabled={rows.isSaving(card.id)}
                    onClick={editing.cancel}
                    variant="secondary"
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-w-0 flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <CardFaceSummary
                      front={card.front}
                      back={card.back}
                      onPreview={() => editing.preview.open(card.id)}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <label
                      className="flex h-10 w-8 cursor-pointer items-center justify-center"
                      title="Select card"
                    >
                      <span className="sr-only">Select card</span>
                      <input
                        type="checkbox"
                        aria-label={`Select card: ${card.front}`}
                        checked={bulk.selection.idSet.has(card.id)}
                        onClick={(event) =>
                          bulk.selection.handleCheckboxClick(card.id, event)
                        }
                        onChange={() => undefined}
                        className="h-[1.1rem] w-[1.1rem] accent-[var(--color-accent)]"
                      />
                    </label>
                    <CardActionsMenu
                      deleting={rows.isDeleting(card.id)}
                      disabled={rows.isDeleting(card.id)}
                      onEdit={() => editing.start(card)}
                      onDelete={() => editing.deletion.request(card.id)}
                    />
                  </div>
                </div>

                {deckNamesById[card.deckId] ? (
                  <div className="mt-auto flex flex-wrap items-center gap-1.5">
                    <Link
                      href={getDeckHref(card.deckId)}
                      aria-label={`Open deck ${deckNamesById[card.deckId]}`}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2.5 py-1 text-2xs font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-medium)] hover:text-text-primary"
                    >
                      <span className="min-w-0 truncate">
                        {deckNamesById[card.deckId]}
                      </span>
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3"
                        aria-hidden="true"
                      >
                        <path d="M3.5 8h9" />
                        <path d="m8.5 3 4.5 5-4.5 5" />
                      </svg>
                    </Link>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        ))}
      </div>

      {results.hasMore ? (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={results.showMore}
            className="w-full sm:w-auto"
          >
            Show {Math.min(50, results.remainingCount)} more
          </Button>
        </div>
      ) : null}
    </>
  );
}
