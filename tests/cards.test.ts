import { describe, expect, it } from "vitest";
import {
  addCardTag,
  cardMatchesAnyTag,
  getTagSuggestions,
  getCardTagsInputError,
  parseCardTagsInput,
  parseCardTagsParam,
} from "@/lib/study/cards";

describe("card tag helpers", () => {
  it("normalizes and deduplicates comma-separated tags", () => {
    expect(parseCardTagsInput("Biology, cells, biology, Cell Biology")).toEqual([
      "biology",
      "cells",
      "cell biology",
    ]);
  });

  it("rejects tag lists that exceed the per-card limit", () => {
    expect(getCardTagsInputError("a,b,c,d,e,f,g,h,i,j,k")).toBe(
      "Use up to 10 tags per card."
    );
  });

  it("matches cards when any selected tag overlaps", () => {
    expect(
      cardMatchesAnyTag({ tags: ["biology", "cells"] }, ["physics", "cells"])
    ).toBe(true);
    expect(cardMatchesAnyTag({ tags: ["biology", "cells"] }, ["physics"])).toBe(
      false
    );
  });

  it("parses tag query params with the same normalization as card input", () => {
    expect(parseCardTagsParam("Anatomy,  cell biology,anatomy")).toEqual([
      "anatomy",
      "cell biology",
    ]);
  });

  it("adds a normalized pending tag to the current tag list", () => {
    expect(addCardTag(["biology"], " Cell Biology ")).toEqual({
      nextTags: ["biology", "cell biology"],
      added: true,
      error: null,
    });
  });

  it("suggests reusable tags that match the current input", () => {
    expect(
      getTagSuggestions(
        ["biology", "cell biology", "physics", "anatomy"],
        "bio",
        ["physics"]
      )
    ).toEqual(["biology", "cell biology"]);
  });
});
