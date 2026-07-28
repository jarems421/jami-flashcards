import { describe, expect, it } from "vitest";

import { isCardDue } from "@/lib/study/daily-review";
import { buildSpacedRepetitionAnalytics } from "@/lib/study/analytics";
import type { Card } from "@/lib/study/cards";

const now = Date.UTC(2026, 6, 28, 14);
const DAY = 24 * 60 * 60 * 1000;

function createCard(overrides: Partial<Card>): Card {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    deckId: overrides.deckId ?? "deck-1",
    userId: "user-1",
    front: "Front",
    back: "Back",
    createdAt: now - 10 * DAY,
    tags: [],
    ...overrides,
  };
}

/**
 * The Decks page counts due cards straight from Firestore documents rather than
 * through isCardDue, so this pins the two definitions together. Progress used to
 * carry a third copy that required a numeric dueDate, which is what made it
 * report fewer due cards than every other surface.
 */
function decksPageIsDue(card: Pick<Card, "dueDate">, at: number) {
  return typeof card.dueDate !== "number" || card.dueDate <= at;
}

describe("due-card definition", () => {
  const cards = [
    createCard({ id: "new-1" }),
    createCard({ id: "new-2" }),
    createCard({ id: "new-3" }),
    createCard({ id: "overdue-1", dueDate: now - 3 * DAY, reps: 2 }),
    createCard({ id: "overdue-2", dueDate: now - 2 * DAY, reps: 1 }),
    createCard({ id: "overdue-3", dueDate: now - DAY, reps: 4 }),
    createCard({ id: "overdue-4", dueDate: now - 60_000, reps: 1 }),
    createCard({ id: "future-1", dueDate: now + 2 * DAY, reps: 3 }),
  ];

  it("treats a never-reviewed card as due", () => {
    expect(isCardDue({ dueDate: undefined }, now)).toBe(true);
    expect(isCardDue({ dueDate: now - 1 }, now)).toBe(true);
    expect(isCardDue({ dueDate: now }, now)).toBe(true);
    expect(isCardDue({ dueDate: now + 1 }, now)).toBe(false);
  });

  it("agrees with the count the Decks page shows", () => {
    const shared = cards.filter((card) => isCardDue(card, now)).length;
    const decksPage = cards.filter((card) => decksPageIsDue(card, now)).length;

    expect(shared).toBe(7);
    expect(decksPage).toBe(shared);
  });

  it("leaves overdue as a portion of due, not the whole of it", () => {
    const due = cards.filter((card) => isCardDue(card, now)).length;
    const { overdueCards } = buildSpacedRepetitionAnalytics(cards, [], {}, now);

    // A card that was never scheduled cannot be late, so overdue stays a
    // strict subset. Before the fix both numbers were 4 and the "overdue
    // portion" told the student nothing.
    expect(overdueCards).toBeLessThan(due);
    expect(overdueCards).toBeGreaterThan(0);
  });

  it("counts a card as late only once a study day has passed", () => {
    // overdue-4 fell due a minute ago, which is still today's work. Counting it
    // as late would have a card go overdue between opening the app and reading
    // the page, and would disagree with the deck-health figures beside it.
    const { overdueCards } = buildSpacedRepetitionAnalytics(cards, [], {}, now);
    expect(overdueCards).toBe(3);

    const dueEarlierToday = cards.find((card) => card.id === "overdue-4");
    expect(dueEarlierToday?.dueDate).toBeLessThan(now);
    expect(isCardDue(dueEarlierToday!, now)).toBe(true);
  });
});
