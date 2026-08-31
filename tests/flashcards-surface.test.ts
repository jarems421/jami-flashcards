import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLASHCARDS_TITLE,
  FLASHCARD_VIEWS,
} from "@/lib/app/flashcard-views";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");

const decksPage = read("app/dashboard/decks/page.tsx");
const cardsPage = read("app/dashboard/cards/page.tsx");
const tabBar = read("components/layout/TabBar.tsx");

/**
 * Decks and cards were two sidebar entries for one surface, which asked a
 * student to know that a deck is a container and a card is a thing inside it
 * before they could guess which to press. Worse, each hid the other: somebody
 * looking at their decks had no way of knowing that a search across every card
 * existed at all.
 */
describe("decks and cards are one surface", () => {
  it("carries one sidebar entry, not two", () => {
    const entries = [...tabBar.matchAll(/href: "(\/dashboard\/[^"]*)"/g)].map(
      (match) => match[1]
    );

    expect(entries).toContain("/dashboard/decks");
    expect(entries).not.toContain("/dashboard/cards");
    expect(tabBar).toContain('label: "Flashcards"');
  });

  it("stays lit while the student is in either view", () => {
    // Navigating to a real place and having the sidebar say you are nowhere is
    // worse than the extra entry was.
    expect(tabBar).toContain('owns: ["/dashboard/cards"]');
    expect(tabBar).toMatch(/\[tab\.href, \.\.\.\(tab\.owns \?\? \[\]\)\]/);
  });

  it("keeps both addresses, so nothing already linked breaks", () => {
    // Every deck link, bookmark and in-app href that pointed at either page
    // still lands where it did.
    expect(FLASHCARD_VIEWS.map((view) => view.href)).toEqual([
      "/dashboard/decks",
      "/dashboard/cards",
    ]);
  });

  it("shows each view from the other, under one name", () => {
    for (const page of [decksPage, cardsPage]) {
      expect(page).toContain("views={FLASHCARD_VIEWS}");
      expect(page).toContain("FLASHCARDS_TITLE");
    }
    expect(FLASHCARDS_TITLE).toBe("Flashcards");
  });

  it("says what each view is for, not just what it is called", () => {
    // "Decks" and "Cards" alone are the words that needed explaining.
    for (const view of FLASHCARD_VIEWS) {
      expect(view.detail.length, view.label).toBeGreaterThan(8);
    }
    expect(
      FLASHCARD_VIEWS.find((view) => view.href === "/dashboard/cards")?.detail
    ).toMatch(/search/i);
  });
});

/**
 * Merging the two must not cost a student either of the things they came for.
 */
describe("making and finding cards stay obvious", () => {
  it("still offers a way into each deck's own cards", () => {
    expect(decksPage).toContain("Add card");
    expect(decksPage).toContain("#add-card");
    expect(decksPage).toContain("Study");
  });

  it("still creates a deck from the decks view", () => {
    expect(decksPage).toContain("Create deck");
  });

  it("still creates and searches cards from the all-cards view", () => {
    expect(cardsPage).toContain("<CardCreationPanel");
    expect(cardsPage).toContain("<CardBrowserWorkspace");
  });
});
