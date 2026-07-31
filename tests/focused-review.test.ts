import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/study/cards";
import {
  buildCustomReviewCards,
  EMPTY_FOCUSED_REVIEW_RECENTS,
  FOCUSED_REVIEW_RECENT_LIMIT,
  getFocusedReviewRecentsKey,
  mergeRecentValues,
  normalizeFocusedReviewRecents,
  parseIdsParam,
} from "@/lib/study/focused-review";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "c-1",
    deckId: "deck-1",
    userId: "user-1",
    front: "Front",
    back: "Back",
    topicIds: [],
    due: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Card;
}

describe("parseIdsParam", () => {
  it("reads a comma-separated list", () => {
    expect(parseIdsParam("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("treats a missing parameter as no filter", () => {
    expect(parseIdsParam(null)).toEqual([]);
    expect(parseIdsParam("")).toEqual([]);
  });

  it("drops blanks and repeats from a hand-edited URL", () => {
    expect(parseIdsParam(" a , ,b,a,, b ")).toEqual(["a", "b"]);
  });
});

describe("normalizeFocusedReviewRecents", () => {
  it("falls back to empty for anything that is not an object", () => {
    for (const value of [null, undefined, 7, "recents", []]) {
      expect(normalizeFocusedReviewRecents(value)).toEqual(
        value === undefined || !Array.isArray(value)
          ? EMPTY_FOCUSED_REVIEW_RECENTS
          : { deckIds: [], topicIds: [] }
      );
    }
  });

  it("keeps only string ids", () => {
    const recents = normalizeFocusedReviewRecents({
      deckIds: ["a", 3, null, "  ", "b"],
      topicIds: [{ id: "t" }, "t-1"],
    });
    expect(recents.deckIds).toEqual(["a", "b"]);
    expect(recents.topicIds).toEqual(["t-1"]);
  });

  it("caps each list at the recent limit", () => {
    const recents = normalizeFocusedReviewRecents({
      deckIds: ["a", "b", "c", "d", "e"],
    });
    expect(recents.deckIds).toHaveLength(FOCUSED_REVIEW_RECENT_LIMIT);
  });

  it("carries pre-Topics tags across under their own key", () => {
    const recents = normalizeFocusedReviewRecents({ tags: ["algebra"] });
    expect(recents.legacyTags).toEqual(["algebra"]);
  });

  it("leaves legacyTags off when there were none", () => {
    // An absent key and an empty array mean different things to the reader.
    expect(normalizeFocusedReviewRecents({ deckIds: [] })).not.toHaveProperty(
      "legacyTags"
    );
  });

  it("namespaces the storage key per user", () => {
    expect(getFocusedReviewRecentsKey("user-1")).not.toBe(
      getFocusedReviewRecentsKey("user-2")
    );
    expect(getFocusedReviewRecentsKey("user-1")).toContain("user-1");
  });
});

describe("mergeRecentValues", () => {
  it("puts the just-used value first", () => {
    expect(mergeRecentValues(["a", "b"], ["c"])).toEqual(["c", "a", "b"]);
  });

  it("promotes a repeat rather than duplicating it", () => {
    expect(mergeRecentValues(["a", "b"], ["b"])).toEqual(["b", "a"]);
  });

  it("never grows past the limit", () => {
    expect(mergeRecentValues(["a", "b", "c"], ["d"])).toEqual(["d", "a", "b"]);
  });

  it("ignores blank entries", () => {
    expect(mergeRecentValues(["a"], ["   ", "b"])).toEqual(["b", "a"]);
  });

  it("dedupes on a caller-supplied key", () => {
    const merged = mergeRecentValues(["Algebra"], ["algebra"], (value) =>
      value.toLowerCase()
    );
    expect(merged).toEqual(["algebra"]);
  });
});

describe("buildCustomReviewCards", () => {
  const deckCard = card({ id: "in-deck", deckId: "deck-1" });
  const topicCard = card({ id: "in-topic", deckId: "deck-9", topicIds: ["t-1"] });
  const otherCard = card({ id: "unrelated", deckId: "deck-9" });
  const all = [deckCard, topicCard, otherCard];
  const ids = (cards: Card[]) => cards.map((entry) => entry.id).sort();

  it("uses every card when nothing is selected", () => {
    expect(buildCustomReviewCards(all, [], [])).toHaveLength(3);
  });

  it("takes the union of decks and Topics, not the intersection", () => {
    // "Focus on this deck and this Topic" asks for both sets. An intersection
    // would return nothing here, which is not what the student picked.
    expect(ids(buildCustomReviewCards(all, ["deck-1"], ["t-1"]))).toEqual([
      "in-deck",
      "in-topic",
    ]);
  });

  it("filters by deck alone", () => {
    expect(ids(buildCustomReviewCards(all, ["deck-1"], []))).toEqual(["in-deck"]);
  });

  it("filters by Topic alone", () => {
    expect(ids(buildCustomReviewCards(all, [], ["t-1"]))).toEqual(["in-topic"]);
  });

  it("returns nothing when the selection matches nothing", () => {
    expect(buildCustomReviewCards(all, ["deck-none"], ["t-none"])).toEqual([]);
  });

  it("tolerates a card with no topicIds at all", () => {
    const legacy = card({ id: "legacy", deckId: "deck-2" });
    delete (legacy as { topicIds?: string[] }).topicIds;
    expect(buildCustomReviewCards([legacy], [], ["t-1"])).toEqual([]);
    expect(buildCustomReviewCards([legacy], ["deck-2"], [])).toHaveLength(1);
  });
});
