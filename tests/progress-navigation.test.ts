import { describe, expect, it } from "vitest";
import {
  buildProgressSectionSearch,
  getProgressSectionFromSearch,
} from "@/lib/study/progress-navigation";

describe("progress section URL state", () => {
  it("reads supported sections and falls back to overview", () => {
    expect(getProgressSectionFromSearch("?section=decks")).toBe("decks");
    expect(getProgressSectionFromSearch("?section=workspace")).toBe("workspace");
    expect(getProgressSectionFromSearch("?section=unknown")).toBe("overview");
  });

  it("omits the default and preserves unrelated parameters", () => {
    expect(buildProgressSectionSearch("?agent=1", "decks")).toBe(
      "?agent=1&section=decks"
    );
    expect(
      buildProgressSectionSearch("?agent=1&section=workspace", "overview")
    ).toBe("?agent=1");
  });
});
