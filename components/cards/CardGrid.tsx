"use client";

import Link from "next/link";
import type { Card } from "@/lib/study/cards";
import { getDeckHref } from "@/lib/app/routes";
import type { CardBrowserController } from "@/hooks/useCardBrowser";
import type { CardBulkActionsController } from "@/hooks/useCardBulkActions";
import type { CardEditingController } from "@/hooks/useCardEditing";
import CardActionsMenu from "@/components/decks/CardActionsMenu";
import CardFaceSummary from "@/components/decks/CardFaceSummary";
import { Button, ConfirmDialog } from "@/components/ui";

type CardGridProps = {
  cards: Card[];
  deckNamesById: Record<string, string>;
  browser: CardBrowserController;
  bulk: CardBulkActionsController;
  editing: CardEditingController;
};

export default function CardGrid({
  cards,
  deckNamesById,
  browser,
  bulk,
  editing,
}: CardGridProps) {
  const { rows } = editing;
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
            className={`app-panel min-h-[8.5rem] min-w-0 overflow-visible p-3 transition duration-fast ease-spring has-[details[open]]:z-40 hover:-translate-y-0.5 hover:shadow-shell ${
              bulk.selection.idSet.has(card.id)
                ? "border-accent/45 ring-2 ring-accent/20"
                : ""
            }`}
          >
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
