"use client";

import Link from "next/link";
import { Button, Card as SurfaceCard, Input } from "@/components/ui";

export type FocusedFilterKind = "decks" | "topics";

/** Decks and Topics are both just a named thing that can be picked. */
export type FocusedReviewOption = { id: string; name: string };

export type FocusedReviewColumn = {
  search: string;
  onSearchChange: (value: string) => void;
  /** Empty while the search box is, rather than showing everything. */
  searchResults: FocusedReviewOption[];
  recents: FocusedReviewOption[];
  selectedIds: string[];
  namesById: Record<string, string>;
  cardCounts: Map<string, number>;
  onToggle: (id: string) => void;
};

const COPY: Record<
  FocusedFilterKind,
  {
    tab: string;
    searchLabel: string;
    searchPlaceholder: string;
    noMatches: string;
    recentsHeading: string;
    recentsEmpty: string;
    removePrefix: string;
    fallbackName: string;
  }
> = {
  decks: {
    tab: "Decks",
    searchLabel: "Search decks",
    searchPlaceholder: "Type a deck name",
    noMatches: "No decks match that search.",
    recentsHeading: "Recent decks",
    recentsEmpty: "Search for a deck to build your first focused session.",
    removePrefix: "Remove deck",
    fallbackName: "Deck",
  },
  topics: {
    tab: "Topics",
    searchLabel: "Search Topics",
    searchPlaceholder: "Type a Topic name",
    noMatches: "No Topics match that search.",
    recentsHeading: "Recent Topics",
    recentsEmpty: "Search for a Topic to narrow this session.",
    removePrefix: "Remove Topic",
    fallbackName: "Topic",
  },
};

function SelectedChips({
  ids,
  column,
  kind,
}: {
  ids: string[];
  column: FocusedReviewColumn;
  kind: FocusedFilterKind;
}) {
  return (
    <>
      {ids.map((id) => {
        const name = column.namesById[id] ?? COPY[kind].fallbackName;
        return (
          <button
            key={id}
            type="button"
            aria-label={`${COPY[kind].removePrefix} ${name}`}
            onClick={() => column.onToggle(id)}
            className="app-selected inline-flex min-h-10 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition duration-fast hover:border-border-strong"
          >
            <span>{name}</span>
            <span aria-hidden="true">×</span>
          </button>
        );
      })}
    </>
  );
}

/** Search results and recents look different, so they render separately. */
function ColumnOptions({
  column,
  kind,
}: {
  column: FocusedReviewColumn;
  kind: FocusedFilterKind;
}) {
  const copy = COPY[kind];

  if (column.search.trim()) {
    if (column.searchResults.length === 0) {
      return <p className="text-sm text-text-muted">{copy.noMatches}</p>;
    }
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {column.searchResults.map((option) => {
          const selected = column.selectedIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => column.onToggle(option.id)}
              className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition duration-fast ${selected ? "app-selected" : "app-chip hover:border-border-strong"}`}
            >
              <span className="min-w-0">
                <span className="block truncate">{option.name}</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {column.cardCounts.get(option.id) ?? 0} cards
                </span>
              </span>
              <span className="shrink-0 text-xs text-text-muted">
                {selected ? "Selected" : "Add"}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div className="text-sm font-medium text-text-primary">
        {copy.recentsHeading}
      </div>
      {column.recents.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {column.recents.map((option) => {
            const selected = column.selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => column.onToggle(option.id)}
                className={`min-h-10 rounded-full px-3.5 py-2 text-sm font-medium transition duration-fast ${selected ? "app-selected" : "app-chip hover:border-border-strong"}`}
              >
                {option.name} · {column.cardCounts.get(option.id) ?? 0}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-text-muted">
          {copy.recentsEmpty}
        </p>
      )}
    </div>
  );
}

type FocusedReviewBuilderProps = {
  filterKind: FocusedFilterKind;
  onFilterKindChange: (kind: FocusedFilterKind) => void;
  decks: FocusedReviewColumn;
  topics: FocusedReviewColumn;
  /** How many cards the current selection would study. */
  previewCount: number;
  /** True when the student has filters on but nothing matches them. */
  selectionEmpty: boolean;
  onClearFilters: () => void;
  onClose: () => void;
  onStart: () => void;
};

/**
 * Builds a Focused Review session from decks and Topics.
 *
 * The two filter kinds are a tab pair rather than two panels, because a student
 * picks from one list at a time but the selection spans both.
 */
export default function FocusedReviewBuilder({
  filterKind,
  onFilterKindChange,
  decks,
  topics,
  previewCount,
  selectionEmpty,
  onClearFilters,
  onClose,
  onStart,
}: FocusedReviewBuilderProps) {
  const activeColumn = filterKind === "decks" ? decks : topics;
  const hasFilters =
    decks.selectedIds.length > 0 || topics.selectedIds.length > 0;

  return (
    <SurfaceCard
      id="focused-review-builder"
      padding="lg"
      className="relative space-y-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Focused Review setup
          </div>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
            Build a focused session
          </h3>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Choose any combination of decks and Topics. With nothing selected,
            every card is included.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="w-full sm:w-auto"
        >
          Close setup
        </Button>
      </div>

      {hasFilters ? (
        <div className="border-y border-[var(--color-border)] py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                Selected
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <SelectedChips
                  ids={decks.selectedIds}
                  column={decks}
                  kind="decks"
                />
                <SelectedChips
                  ids={topics.selectedIds}
                  column={topics}
                  kind="topics"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="w-full shrink-0 sm:w-auto"
            >
              Clear selection
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <div
          role="group"
          aria-label="Focused Review filter type"
          className="app-subtle-panel inline-flex w-full rounded-full p-1 sm:w-auto"
        >
          {(["decks", "topics"] as FocusedFilterKind[]).map((kind) => {
            const selected = filterKind === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={selected}
                onClick={() => onFilterKindChange(kind)}
                className={`min-h-10 flex-1 rounded-full px-4 text-sm font-semibold transition sm:flex-none ${
                  selected
                    ? "bg-[var(--color-selected-bg)] text-[var(--color-selected-text)] shadow-sm"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {COPY[kind].tab}
              </button>
            );
          })}
        </div>

        <div id="focused-review-options" className="space-y-4">
          <Input
            label={COPY[filterKind].searchLabel}
            placeholder={COPY[filterKind].searchPlaceholder}
            value={activeColumn.search}
            onChange={(event) => activeColumn.onSearchChange(event.target.value)}
          />
          <ColumnOptions column={activeColumn} kind={filterKind} />
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-[var(--color-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div aria-live="polite">
          <div className="text-base font-semibold text-text-primary">
            {selectionEmpty
              ? "No cards match this selection"
              : `${previewCount} ${previewCount === 1 ? "card" : "cards"} ready`}
          </div>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {selectionEmpty
              ? "Clear a filter or choose something different."
              : hasFilters
                ? "Your selected decks and Topics will be mixed into one session."
                : "No filters are selected, so this session will use every card."}
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
          {selectionEmpty ? (
            <Link
              href="/dashboard/cards"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] shadow-button-secondary transition duration-fast hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)]"
            >
              Edit cards
            </Link>
          ) : (
            <Button
              type="button"
              onClick={onStart}
              size="lg"
              className="w-full sm:w-auto"
            >
              Start Focused Review
            </Button>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}
