import { describe, expect, it } from "vitest";
import {
  canRemoveSourceFromFilteredFolder,
  getLinkedSourceFolders,
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
});
