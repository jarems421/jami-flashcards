import { describe, expect, it } from "vitest";
import {
  frontMatchesCardSearch,
  shouldShowCardBrowserResults,
} from "@/lib/study/card-search";

describe("card front smart search", () => {
  it("matches the beginning of the front while a word is still being typed", () => {
    expect(frontMatchesCardSearch("Ownership in economics", "o")).toBe(true);
    expect(frontMatchesCardSearch("The origin of ownership", "o")).toBe(false);
  });

  it("matches completed words anywhere in the front after a trailing space", () => {
    expect(frontMatchesCardSearch("The origin of own resources", "own ")).toBe(true);
    expect(frontMatchesCardSearch("Ownership in economics", "own ")).toBe(false);
  });

  it("does not treat partial word fragments as completed word matches", () => {
    expect(frontMatchesCardSearch("The clown car example", "own ")).toBe(false);
  });

  it("only matches the card front provided by the caller", () => {
    expect(frontMatchesCardSearch("Photosynthesis definition", "mitosis")).toBe(false);
    expect(frontMatchesCardSearch("Biology keyword", "deck")).toBe(false);
  });

  it("keeps the browser empty until there is a query or active filter", () => {
    expect(shouldShowCardBrowserResults("", false)).toBe(false);
    expect(shouldShowCardBrowserResults("   ", false)).toBe(false);
    expect(shouldShowCardBrowserResults("", true)).toBe(true);
    expect(shouldShowCardBrowserResults("o", false)).toBe(true);
  });
});
