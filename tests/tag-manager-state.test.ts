import { describe, expect, it } from "vitest";
import {
  getTagFilterAfterRename,
  shouldClearTagFilterAfterRemoval,
} from "@/lib/study/tag-manager-state";

describe("tag manager browser sync", () => {
  it("uses the normalized renamed tag as the browser filter", () => {
    expect(getTagFilterAfterRename("  Biology revision  ")).toBe("Biology revision");
  });

  it("clears the browser tag filter when removing the selected tag", () => {
    expect(shouldClearTagFilterAfterRemoval("Biology", " biology ")).toBe(true);
    expect(shouldClearTagFilterAfterRemoval("Chemistry", "Biology")).toBe(false);
    expect(shouldClearTagFilterAfterRemoval("", "Biology")).toBe(false);
  });
});
