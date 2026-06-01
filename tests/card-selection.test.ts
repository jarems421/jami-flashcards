import { describe, expect, it } from "vitest";
import {
  addCardIdsToSelection,
  selectCardRange,
  toggleCardIdSelection,
} from "@/lib/study/card-selection";

describe("card selection helpers", () => {
  it("toggles one card", () => {
    expect(toggleCardIdSelection(["card-a"], "card-b")).toEqual(["card-a", "card-b"]);
    expect(toggleCardIdSelection(["card-a", "card-b"], "card-a")).toEqual(["card-b"]);
  });

  it("selects a visible shift-click range", () => {
    expect(
      selectCardRange(["card-a"], ["card-a", "card-b", "card-c", "card-d"], "card-a", "card-c")
    ).toEqual(["card-a", "card-b", "card-c"]);
  });

  it("selects range using the current filtered order", () => {
    expect(
      selectCardRange([], ["card-d", "card-b", "card-a"], "card-d", "card-a")
    ).toEqual(["card-d", "card-b", "card-a"]);
  });

  it("falls back to selecting only the target when there is no anchor", () => {
    expect(selectCardRange(["card-a"], ["card-a", "card-b"], null, "card-b")).toEqual([
      "card-a",
      "card-b",
    ]);
  });

  it("adds visible cards without duplicating already-selected cards", () => {
    expect(addCardIdsToSelection(["card-a"], ["card-a", "card-b", "card-c"])).toEqual([
      "card-a",
      "card-b",
      "card-c",
    ]);
  });

  it("keeps swipe selection add-only for already-selected cards", () => {
    const selected = addCardIdsToSelection(["card-a", "card-c"], ["card-b", "card-c"]);

    expect(selected).toEqual(["card-a", "card-c", "card-b"]);
  });
});
