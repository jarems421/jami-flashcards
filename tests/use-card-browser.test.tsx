// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCardBrowser,
  type CardBrowserController,
} from "@/hooks/useCardBrowser";
import type { Topic } from "@/lib/material/topics";
import type { Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";

function card(id: string, front: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    front,
    back: `${front} answer`,
    deckId: "deck-1",
    userId: "user-1",
    createdAt: Number(id.replace(/\D/g, "")) || 1,
    tags: [],
    ...overrides,
  };
}

const decks = [
  {
    id: "deck-1",
    name: "Biology",
    folderIds: ["folder-1"],
  },
  {
    id: "deck-2",
    name: "History",
    folderIds: ["folder-2"],
  },
] as Deck[];

const topics = [
  { id: "topic-1", name: "Cell Biology" },
  { id: "topic-2", name: "Cold War" },
] as Topic[];

let container: HTMLDivElement;
let root: Root;
let browser: CardBrowserController;

function Harness({ cards }: { cards: Card[] }) {
  const value = useCardBrowser({ cards, decks, topics });
  useEffect(() => {
    browser = value;
  });
  return null;
}

function render(cards: Card[]) {
  act(() => {
    root.render(<Harness cards={cards} />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
  window.history.replaceState({}, "", "/dashboard/cards");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useCardBrowser", () => {
  it("hydrates URL filters and applies deck, folder, Topic, and status together", () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/cards?deck=deck-1&folder=folder-1&topic=topic-1&status=new"
    );
    render([
      card("card-1", "Mitosis", { topicIds: ["topic-1"], reps: 0 }),
      card("card-2", "Meiosis", { topicIds: ["topic-2"], reps: 0 }),
      card("card-3", "Cell cycle", {
        deckId: "deck-2",
        topicIds: ["topic-1"],
        reps: 0,
      }),
      card("card-4", "Reviewed", { topicIds: ["topic-1"], reps: 2 }),
    ]);

    expect(browser.filters.activeCount).toBe(4);
    expect(browser.results.matchingCards.map((item) => item.id)).toEqual([
      "card-1",
    ]);
  });

  it("debounces front search and preserves unrelated query parameters", () => {
    window.history.replaceState({}, "", "/dashboard/cards?agent=1");
    render([card("card-1", "Mitosis"), card("card-2", "Photosynthesis")]);

    act(() => browser.search.setValue("Mit"));
    expect(browser.results.showingFilteredResults).toBe(false);
    expect(window.location.search).toContain("agent=1");
    expect(window.location.search).toContain("q=Mit");

    act(() => vi.advanceTimersByTime(300));
    expect(browser.results.showingFilteredResults).toBe(true);
    expect(browser.results.matchingCards.map((item) => item.id)).toEqual([
      "card-1",
    ]);
  });

  it("canonicalizes a legacy tag to its Topic filter", () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/cards?tag=Cell+Biology"
    );
    render([
      card("card-1", "Mitosis", { topicIds: ["topic-1"] }),
      card("card-2", "Cold War", { topicIds: ["topic-2"] }),
    ]);

    expect(browser.filters.topicId).toBe("topic-1");
    expect(browser.results.matchingCards.map((item) => item.id)).toEqual([
      "card-1",
    ]);
    expect(window.location.search).toBe("?topic=topic-1");
  });

  it("keeps recent browsing concise, pages by 50, and resets after data changes", () => {
    const cards = Array.from({ length: 120 }, (_, index) =>
      card(`card-${index + 1}`, `Card ${index + 1}`)
    );
    render(cards);

    expect(browser.results.visibleCards).toHaveLength(4);
    act(() => browser.results.toggleAllRecent());
    expect(browser.results.visibleCards).toHaveLength(50);
    act(() => browser.results.showMore());
    expect(browser.results.visibleCards).toHaveLength(100);

    render(cards.slice(0, 119));
    expect(browser.results.visibleCards).toHaveLength(50);
  });
});
