import { describe, expect, it } from "vitest";
import {
  canRemoveSourceFromFilteredFolder,
  getLinkedSourceFolders,
  reconcileTutorSourceSelection,
  toggleTutorSourceSelection,
} from "@/lib/study/library-management";

describe("Library source management", () => {
  const folders = [
    { id: "biology", name: "Biology" },
    { id: "history", name: "History" },
  ];

  it("offers removal only for folders linked to the source", () => {
    expect(getLinkedSourceFolders(["history"], folders)).toEqual([
      folders[1],
    ]);
  });

  it("exposes direct removal only for the active linked filter", () => {
    expect(
      canRemoveSourceFromFilteredFolder("biology", ["biology", "history"])
    ).toBe(true);
    expect(canRemoveSourceFromFilteredFolder("maths", ["biology"])).toBe(false);
    expect(canRemoveSourceFromFilteredFolder("", ["biology"])).toBe(false);
  });

  it("keeps Tutor source selection deliberate when sources load", () => {
    expect(reconcileTutorSourceSelection([], ["source-1", "source-2"])).toEqual(
      []
    );
    expect(
      reconcileTutorSourceSelection(
        ["source-2", "missing", "source-2"],
        ["source-1", "source-2"]
      )
    ).toEqual(["source-2"]);
  });

  it("adds and removes Tutor sources without exceeding five", () => {
    expect(toggleTutorSourceSelection(["source-1"], "source-2")).toEqual({
      sourceIds: ["source-1", "source-2"],
      limitReached: false,
    });
    expect(toggleTutorSourceSelection(["source-1"], "source-1")).toEqual({
      sourceIds: [],
      limitReached: false,
    });

    const fiveSources = ["one", "two", "three", "four", "five"];
    expect(toggleTutorSourceSelection(fiveSources, "six")).toEqual({
      sourceIds: fiveSources,
      limitReached: true,
    });
  });
});
