import { describe, expect, it } from "vitest";
import { getDeckCardCounts } from "@/lib/study/deck-counts";
import type { Card } from "@/lib/study/cards";

const NOW = 1_700_000_000_000;

function makeCard(overrides: Partial<Card>): Card {
  return {
    id: "card-1",
    deckId: "deck-1",
    userId: "user-1",
    front: "Front",
    back: "Back",
    tags: [],
    topicIds: [],
    createdAt: NOW - 1000,
    ...overrides,
  } as Card;
}

describe("getDeckCardCounts", () => {
  it("returns zeroed counts for a deck with no cards", () => {
    expect(getDeckCardCounts(["deck-1"], [], NOW)).toEqual({
      "deck-1": { due: 0, total: 0 },
    });
  });

  it("counts a card with no dueDate as due", () => {
    const counts = getDeckCardCounts(
      ["deck-1"],
      [makeCard({ dueDate: undefined })],
      NOW
    );
    expect(counts["deck-1"]).toEqual({ due: 1, total: 1 });
  });

  it("counts a past-due card as due and a future card as not due", () => {
    const counts = getDeckCardCounts(
      ["deck-1"],
      [
        makeCard({ id: "past", dueDate: NOW - 1 }),
        makeCard({ id: "exactly-now", dueDate: NOW }),
        makeCard({ id: "future", dueDate: NOW + 1 }),
      ],
      NOW
    );
    expect(counts["deck-1"]).toEqual({ due: 2, total: 3 });
  });

  it("ignores cards whose deck is not in the list", () => {
    const counts = getDeckCardCounts(
      ["deck-1"],
      [makeCard({ deckId: "deleted-deck" }), makeCard({ deckId: "" })],
      NOW
    );
    expect(counts["deck-1"]).toEqual({ due: 0, total: 0 });
  });

  it("splits counts across decks", () => {
    const counts = getDeckCardCounts(
      ["deck-1", "deck-2"],
      [
        makeCard({ id: "a", deckId: "deck-1", dueDate: NOW + 60_000 }),
        makeCard({ id: "b", deckId: "deck-2" }),
        makeCard({ id: "c", deckId: "deck-2", dueDate: NOW - 60_000 }),
      ],
      NOW
    );
    expect(counts).toEqual({
      "deck-1": { due: 0, total: 1 },
      "deck-2": { due: 2, total: 2 },
    });
  });
});
