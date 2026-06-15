import { describe, expect, it } from "vitest";
import {
  buildFolderTabSearch,
  getFolderTabFromSearch,
} from "@/lib/workspace/folder-navigation";

describe("folder tab URL state", () => {
  it("reads supported tabs and falls back to notebooks", () => {
    expect(getFolderTabFromSearch("?tab=decks")).toBe("decks");
    expect(getFolderTabFromSearch("?tab=progress")).toBe("notebooks");
    expect(getFolderTabFromSearch("?tab=unknown")).toBe("notebooks");
  });

  it("preserves unrelated query parameters", () => {
    expect(buildFolderTabSearch("?agent=1", "sources")).toBe(
      "?agent=1&tab=sources"
    );
    expect(buildFolderTabSearch("?agent=1&tab=decks", "notebooks")).toBe(
      "?agent=1"
    );
  });
});
