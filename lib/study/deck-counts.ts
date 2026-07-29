import type { Card } from "@/lib/study/cards";

export type DeckCounts = Record<string, { due: number; total: number }>;

/**
 * Per-deck due/total counts for the deck list. A card with no due date has
 * never been scheduled, so it counts as due; cards pointing at a deck outside
 * `deckIds` (deleted, or another user's) are ignored.
 */
export function getDeckCardCounts(
  deckIds: readonly string[],
  cards: readonly Card[],
  now: number
): DeckCounts {
  const counts: DeckCounts = {};

  for (const deckId of deckIds) {
    counts[deckId] = { due: 0, total: 0 };
  }

  for (const card of cards) {
    const deckCounts = counts[card.deckId];
    if (!deckCounts) {
      continue;
    }

    deckCounts.total += 1;
    if (card.dueDate === undefined || card.dueDate <= now) {
      deckCounts.due += 1;
    }
  }

  return counts;
}
