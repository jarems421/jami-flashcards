"use client";

import {
  type Dispatch,
  type SetStateAction,
  useMemo,
} from "react";
import Link from "next/link";
import CardBrowserControls from "@/components/cards/CardBrowserControls";
import CardBulkActions from "@/components/cards/CardBulkActions";
import CardGrid from "@/components/cards/CardGrid";
import CardPreviewDialog from "@/components/decks/CardPreviewDialog";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { useCardBrowser } from "@/hooks/useCardBrowser";
import { useCardBulkActions } from "@/hooks/useCardBulkActions";
import { useCardEditing } from "@/hooks/useCardEditing";
import type { Topic } from "@/lib/material/topics";
import type { Source } from "@/lib/material/sources";
import { getCardContentDuplicateCounts } from "@/lib/study/card-quality";
import { getCardContentKey, type Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import type { StudyFolder } from "@/lib/workspace/study-folders";

type CardsBrowserData = {
  cards: Card[];
  decks: Deck[];
  sources: Source[];
  folders: StudyFolder[];
  topics: Topic[];
};

type CardBrowserFeedback = {
  clear: () => void;
  showError: (message: string) => void;
  success: (message: string) => void;
};

type CardBrowserWorkspaceProps = {
  userId: string;
  data: CardsBrowserData;
  setCards: Dispatch<SetStateAction<Card[]>>;
  setTopics: Dispatch<SetStateAction<Topic[]>>;
  selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  bulkTopicResetKey: number;
  feedback: CardBrowserFeedback;
  loading: boolean;
};

/** Composes browsing, bulk actions, row editing, and preview below the route. */
export default function CardBrowserWorkspace({
  userId,
  data,
  setCards,
  setTopics,
  selectedCardIds,
  setSelectedCardIds,
  bulkTopicResetKey,
  feedback,
  loading,
}: CardBrowserWorkspaceProps) {
  const { cards, decks, folders, sources, topics } = data;
  const browser = useCardBrowser({ cards, decks, topics });
  const bulk = useCardBulkActions({
    cards,
    setCards,
    visibleCardIds: browser.results.visibleCardIds,
    selectedCardIds,
    setSelectedCardIds,
    topicSelectionResetKey: bulkTopicResetKey,
    feedback,
  });
  const editing = useCardEditing({
    cards,
    setCards,
    onCardDeleted: bulk.selection.remove,
    feedback,
  });

  const deckNamesById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );
  const sourceNamesById = useMemo(
    () => Object.fromEntries(sources.map((source) => [source.id, source.title])),
    [sources]
  );
  const topicNamesById = useMemo(
    () => Object.fromEntries(topics.map((topic) => [topic.id, topic.name])),
    [topics]
  );
  const duplicateCounts = useMemo(
    () => getCardContentDuplicateCounts(cards),
    [cards]
  );
  const previewCard = editing.preview.card;

  return (
    <>
      <CardBrowserControls
        browser={browser}
        cardsCount={cards.length}
        decks={decks}
        folders={folders}
        topics={topics}
        loading={loading}
      />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          emoji="Cards"
          eyebrow="No cards yet"
          title="No cards yet"
          description="Create a card to start review."
          helperText={decks.length === 0 ? "Create a deck first." : undefined}
          action={
            decks.length === 0 ? (
              <Link
                href="/dashboard/decks"
                className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover"
              >
                Create a deck
              </Link>
            ) : undefined
          }
        />
      ) : browser.results.showingFilteredResults &&
        browser.results.matchingCards.length === 0 ? (
        <EmptyState
          emoji="Search"
          eyebrow="No match"
          title="No cards match"
          description={
            browser.search.debouncedValue
              ? `No cards match "${browser.search.debouncedValue}".`
              : "No cards match the selected filters."
          }
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={browser.filters.clear}
            >
              Clear all filters
            </Button>
          }
          secondaryAction={
            <a
              href="#add-card"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] px-4 text-sm font-medium text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)]"
            >
              Add a card
            </a>
          }
        />
      ) : (
        <>
          <CardBulkActions
            userId={userId}
            visibleCount={browser.results.visibleCards.length}
            decks={decks}
            topics={topics}
            onTopicsChange={setTopics}
            bulk={bulk}
          />
          <CardGrid
            userId={userId}
            cards={browser.results.visibleCards}
            topics={topics}
            onTopicsChange={setTopics}
            deckNamesById={deckNamesById}
            topicNamesById={topicNamesById}
            duplicateCounts={duplicateCounts}
            browser={browser}
            bulk={bulk}
            editing={editing}
          />
        </>
      )}

      <CardPreviewDialog
        card={previewCard}
        deckName={
          previewCard ? deckNamesById[previewCard.deckId] ?? "Deck" : "Deck"
        }
        duplicateCount={
          previewCard
            ? duplicateCounts.get(
                getCardContentKey(previewCard.front, previewCard.back)
              )
            : undefined
        }
        sourceNames={(previewCard?.sourceIds ?? []).flatMap((sourceId) => {
          const sourceName = sourceNamesById[sourceId];
          return sourceName ? [sourceName] : [];
        })}
        topicNames={(previewCard?.topicIds ?? []).map(
          (topicId) => topicNamesById[topicId] ?? "Topic"
        )}
        onClose={editing.preview.close}
        onEdit={editing.preview.edit}
      />
    </>
  );
}
