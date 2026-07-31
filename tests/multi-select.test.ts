import { describe, expect, it } from "vitest";
import {
  addIdsToSelection,
  selectIdRange,
  toggleIdSelection,
} from "@/lib/app/multi-select";

describe("card selection helpers", () => {
  it("toggles one card", () => {
    expect(toggleIdSelection(["card-a"], "card-b")).toEqual(["card-a", "card-b"]);
    expect(toggleIdSelection(["card-a", "card-b"], "card-a")).toEqual(["card-b"]);
  });

  it("selects a visible shift-click range", () => {
    expect(
      selectIdRange(["card-a"], ["card-a", "card-b", "card-c", "card-d"], "card-a", "card-c")
    ).toEqual(["card-a", "card-b", "card-c"]);
  });

  it("selects range using the current filtered order", () => {
    expect(
      selectIdRange([], ["card-d", "card-b", "card-a"], "card-d", "card-a")
    ).toEqual(["card-d", "card-b", "card-a"]);
  });

  it("falls back to selecting only the target when there is no anchor", () => {
    expect(selectIdRange(["card-a"], ["card-a", "card-b"], null, "card-b")).toEqual([
      "card-a",
      "card-b",
    ]);
  });

  it("adds visible cards without duplicating already-selected cards", () => {
    expect(addIdsToSelection(["card-a"], ["card-a", "card-b", "card-c"])).toEqual([
      "card-a",
      "card-b",
      "card-c",
    ]);
  });

  it("adds another group without deselecting existing cards", () => {
    const selected = addIdsToSelection(["card-a", "card-c"], ["card-b", "card-c"]);

    expect(selected).toEqual(["card-a", "card-c", "card-b"]);
  });
});
