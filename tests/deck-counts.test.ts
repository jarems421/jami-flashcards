import { describe, expect, it } from "vitest";
import { describeDeckCardCount, dueFromCounts } from "@/lib/study/deck-counts";

describe("dueFromCounts", () => {
  it("counts every card not scheduled for later as due, including never-scheduled ones", () => {
    expect(dueFromCounts(10, 4)).toBe(6);
    expect(dueFromCounts(10, 0)).toBe(10);
    expect(dueFromCounts(0, 0)).toBe(0);
  });

  it("never goes below zero when the two counts were taken a moment apart", () => {
    expect(dueFromCounts(3, 5)).toBe(0);
  });
});

describe("describeDeckCardCount", () => {
  it("says the deck is being counted until the count arrives", () => {
    expect(describeDeckCardCount(undefined)).toBe("Counting cards…");
  });

  it("shows the total and how many are due", () => {
    expect(describeDeckCardCount({ total: 12, due: 3 })).toBe("12 cards, 3 due");
    expect(describeDeckCardCount({ total: 1, due: 1 })).toBe("1 card, 1 due");
    expect(describeDeckCardCount({ total: 0, due: 0 })).toBe("0 cards, 0 due");
  });

  it("shows the total alone when only the total could be counted", () => {
    expect(describeDeckCardCount({ total: 40, due: null })).toBe("40 cards");
  });

  it("says nothing rather than a wrong number when the deck could not be counted", () => {
    expect(describeDeckCardCount(null)).toBe("");
  });
});
