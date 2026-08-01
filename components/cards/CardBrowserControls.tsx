"use client";

import { useMemo } from "react";
import { Button, Input } from "@/components/ui";
import type { Topic } from "@/lib/material/topics";
import type { Deck } from "@/lib/study/decks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { CardBrowserController } from "@/hooks/useCardBrowser";
import { RECENT_CARD_COUNT } from "@/hooks/useCardBrowser";

type CardBrowserControlsProps = {
  browser: CardBrowserController;
  cardsCount: number;
  decks: Deck[];
  folders: StudyFolder[];
  topics: Topic[];
  loading: boolean;
};

export default function CardBrowserControls({
  browser,
  cardsCount,
  decks,
  folders,
  topics,
  loading,
}: CardBrowserControlsProps) {
  const deckNamesById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );
  const folderNamesById = useMemo(
    () => Object.fromEntries(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );
  const topicNamesById = useMemo(
    () => Object.fromEntries(topics.map((topic) => [topic.id, topic.name])),
    [topics]
  );
  const { filters, results, search } = browser;

  return (
    <div className="sticky top-0 z-20 -mx-1 space-y-3 rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-surface-base)]/95 p-3 shadow-[0_14px_30px_rgba(4,8,18,0.16)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-text-primary">
            Browse cards
          </div>
          <p className="mt-0.5 text-sm text-text-muted">
            {loading
              ? "Loading cards..."
              : results.showingFilteredResults
                ? `${results.matchingCards.length} matching card${
                    results.matchingCards.length === 1 ? "" : "s"
                  }`
                : `${cardsCount} card${cardsCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {!results.showingFilteredResults && cardsCount > RECENT_CARD_COUNT ? (
            <Button
              type="button"
              variant={results.showingAllRecent ? "secondary" : "ghost"}
              size="sm"
              aria-expanded={results.showingAllRecent}
              aria-controls="recent-cards-grid"
              onClick={results.toggleAllRecent}
              className="w-full sm:w-auto"
            >
              {results.showingAllRecent ? "Show less" : "View more"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={filters.controlsVisible ? "secondary" : "ghost"}
            size="sm"
            aria-expanded={filters.controlsVisible}
            onClick={filters.toggleControls}
            className="w-full sm:w-auto"
          >
            {filters.controlsVisible
              ? "Hide filters"
              : `Filters${
                  filters.activeCount > 0 ? ` (${filters.activeCount})` : ""
                }`}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Search card fronts"
          placeholder="Search card fronts"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
          containerClassName="min-w-0 flex-1"
        />
        {search.value ? (
          <Button type="button" size="sm" variant="ghost" onClick={search.clear}>
            Clear search
          </Button>
        ) : null}
      </div>

      {filters.controlsVisible ? (
        <div className="grid gap-3 rounded-[1.15rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-muted">
              Deck
            </span>
            <select
              aria-label="Filter cards by deck"
              value={filters.deckId}
              onChange={(event) => filters.setDeckId(event.target.value)}
              className="app-field min-h-10 w-full rounded-full px-3 text-sm"
            >
              <option value="">All decks</option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-muted">
              Folder
            </span>
            <select
              aria-label="Filter cards by folder"
              value={filters.folderId}
              onChange={(event) => filters.setFolderId(event.target.value)}
              className="app-field min-h-10 w-full rounded-full px-3 text-sm"
            >
              <option value="">All folders</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-muted">
              Topic
            </span>
            <select
              aria-label="Filter cards by Topic"
              value={filters.topicId}
              onChange={(event) => filters.setTopicId(event.target.value)}
              className="app-field min-h-10 w-full rounded-full px-3 text-sm"
            >
              <option value="">All Topics</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-muted">
              Status
            </span>
            <select
              aria-label="Filter cards by study status"
              value={filters.status}
              onChange={(event) =>
                filters.setStatus(
                  event.target.value as typeof filters.status
                )
              }
              className="app-field min-h-10 w-full rounded-full px-3 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="due">Due</option>
              <option value="weak">Weak</option>
              <option value="new">New</option>
            </select>
          </label>
        </div>
      ) : null}

      {filters.activeCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {filters.deckId ? (
            <button
              type="button"
              onClick={() => filters.setDeckId("")}
              className="app-selected rounded-full px-3 py-1.5 text-xs font-medium"
            >
              {deckNamesById[filters.deckId] ?? "Deck"} ×
            </button>
          ) : null}
          {filters.folderId ? (
            <button
              type="button"
              onClick={() => filters.setFolderId("")}
              className="app-selected rounded-full px-3 py-1.5 text-xs font-medium"
            >
              {folderNamesById[filters.folderId] ?? "Folder"} ×
            </button>
          ) : null}
          {filters.topicId ? (
            <button
              type="button"
              onClick={() => filters.setTopicId("")}
              className="app-selected rounded-full px-3 py-1.5 text-xs font-medium"
            >
              {topicNamesById[filters.topicId] ?? "Topic"} ×
            </button>
          ) : null}
          {filters.status !== "all" ? (
            <button
              type="button"
              onClick={() => filters.setStatus("all")}
              className="app-selected rounded-full px-3 py-1.5 text-xs font-medium capitalize"
            >
              {filters.status} ×
            </button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={filters.clear}>
            Clear all filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
