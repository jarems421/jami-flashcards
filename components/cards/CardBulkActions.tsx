"use client";

import type { Topic } from "@/lib/material/topics";
import type { Deck } from "@/lib/study/decks";
import type { CardBulkActionsController } from "@/hooks/useCardBulkActions";
import BulkTopicToolbar from "@/components/topics/BulkTopicToolbar";
import { Button, ConfirmDialog } from "@/components/ui";

type CardBulkActionsProps = {
  userId: string;
  visibleCount: number;
  decks: Deck[];
  topics: Topic[];
  onTopicsChange: (topics: Topic[]) => void;
  bulk: CardBulkActionsController;
};

export default function CardBulkActions({
  userId,
  visibleCount,
  decks,
  topics,
  onTopicsChange,
  bulk,
}: CardBulkActionsProps) {
  const selectedCount = bulk.selection.ids.length;

  return (
    <>
      <BulkTopicToolbar
        userId={userId}
        selectedCount={selectedCount}
        visibleCount={visibleCount}
        topicIds={bulk.topics.ids}
        topics={topics}
        maxTopicsToAdd={bulk.topics.capacity}
        disabled={bulk.topics.applying}
        onSelectAll={bulk.selection.selectVisible}
        onTopicIdsChange={bulk.topics.setIds}
        onTopicsChange={onTopicsChange}
        onApply={() => void bulk.topics.apply()}
        onClearSelection={bulk.selection.clear}
      />

      {selectedCount > 0 ? (
        <div className="grid gap-3 rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
              Move selected cards
            </span>
            <select
              value={bulk.move.deckId}
              onChange={(event) => bulk.move.setDeckId(event.target.value)}
              disabled={bulk.actionInFlight}
              className="app-field min-h-10 w-full rounded-full px-3 text-sm"
            >
              <option value="">Choose destination deck</option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!bulk.move.deckId || bulk.actionInFlight}
            onClick={() => void bulk.move.apply()}
          >
            {bulk.move.applying ? "Moving..." : "Move"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={bulk.actionInFlight}
            onClick={() => bulk.deletion.setPending(true)}
          >
            {bulk.deletion.applying ? "Deleting..." : "Delete selected"}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={bulk.deletion.pending}
        title={`Delete ${selectedCount} selected card${
          selectedCount === 1 ? "" : "s"
        }?`}
        description="The selected cards will be permanently removed from their decks and review queues. This cannot be undone."
        confirmLabel="Delete selected"
        busy={bulk.deletion.applying}
        onClose={() => bulk.deletion.setPending(false)}
        onConfirm={() => void bulk.deletion.confirm()}
      />
    </>
  );
}
