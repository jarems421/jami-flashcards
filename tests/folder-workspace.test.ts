import { describe, expect, it } from "vitest";
import { formatEditedLabel, mergeNewestFirst } from "@/lib/workspace/folder-workspace";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 7, 12);

describe("formatEditedLabel", () => {
  it("calls anything within the hour recent", () => {
    expect(formatEditedLabel(NOW - 59 * 60_000, NOW)).toBe("Edited recently");
  });

  it("counts hours, then days", () => {
    expect(formatEditedLabel(NOW - 5 * HOUR, NOW)).toBe("Edited 5h ago");
    expect(formatEditedLabel(NOW - 3 * 24 * HOUR, NOW)).toBe("Edited 3d ago");
  });

  it("gives the date once it is a week old", () => {
    expect(formatEditedLabel(Date.UTC(2026, 8, 1, 12), NOW)).toBe("Edited Sep 1");
  });

  it("treats a time ahead of the clock as now", () => {
    expect(formatEditedLabel(NOW + HOUR, NOW)).toBe("Edited recently");
  });
});

describe("mergeNewestFirst", () => {
  const at = (id: string, time: number) => ({ id, time });

  it("adds a page to what is shown, newest first", () => {
    const merged = mergeNewestFirst([at("a", 3), at("b", 1)], [at("c", 2)], (item) => item.time);
    expect(merged.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("keeps one entry per id, the page's copy winning", () => {
    const merged = mergeNewestFirst([at("a", 1)], [at("a", 5), at("b", 2)], (item) => item.time);
    expect(merged).toEqual([at("a", 5), at("b", 2)]);
  });
});
