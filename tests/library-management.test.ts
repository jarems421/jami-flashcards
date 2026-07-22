import { describe, expect, it } from "vitest";
import {
  canRemoveSourceFromFilteredFolder,
  focusTutorSourceSelection,
  getAdditionalTutorSources,
  getLinkedSourceFolders,
  reconcileTutorSourceSelection,
  shouldResetTutorConversation,
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

  it("starts Tutor with only the source the student chose", () => {
    expect(
      focusTutorSourceSelection(["source-a", "source-c"], "source-b")
    ).toEqual(["source-b"]);
  });

  it("offers only other sources as optional Tutor context", () => {
    const sources = [
      { id: "source-a", title: "A" },
      { id: "source-b", title: "B" },
      { id: "source-c", title: "C" },
    ];

    expect(getAdditionalTutorSources(sources, "source-b")).toEqual([
      sources[0],
      sources[2],
    ]);
  });

  it("clears Tutor history when hidden context would change", () => {
    expect(
      shouldResetTutorConversation(
        ["source-b", "source-c"],
        "source-b",
        "source-b"
      )
    ).toBe(true);
    expect(
      shouldResetTutorConversation(["source-b"], "source-b", "source-b")
    ).toBe(false);
    expect(
      shouldResetTutorConversation(["source-a"], "source-a", "source-b")
    ).toBe(true);
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
