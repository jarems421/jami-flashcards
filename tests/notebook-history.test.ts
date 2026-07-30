import { describe, expect, it } from "vitest";
import {
  chooseNotebookHistorySource,
  MAX_NOTEBOOK_HISTORY_ENTRIES,
  pushNotebookHistoryEntry,
  syncInkHistoryTimestamps,
} from "@/lib/workspace/notebook-history";

describe("syncInkHistoryTimestamps", () => {
  it("stamps a newly landed ink command", () => {
    expect(syncInkHistoryTimestamps([], 1, 100)).toEqual([100]);
    expect(syncInkHistoryTimestamps([100], 2, 200)).toEqual([100, 200]);
  });

  it("keeps the same array when the depth has not moved", () => {
    const stamps = [100, 200];
    expect(syncInkHistoryTimestamps(stamps, 2, 300)).toBe(stamps);
  });

  it("drops timestamps for commands that were undone", () => {
    expect(syncInkHistoryTimestamps([100, 200, 300], 1, 400)).toEqual([100]);
    expect(syncInkHistoryTimestamps([100, 200], 0, 400)).toEqual([]);
  });

  it("stamps every command when the depth jumps by more than one", () => {
    expect(syncInkHistoryTimestamps([100], 3, 500)).toEqual([100, 500, 500]);
  });

  it("treats a negative depth as an empty history", () => {
    expect(syncInkHistoryTimestamps([100, 200], -1, 300)).toEqual([]);
  });
});

describe("chooseNotebookHistorySource", () => {
  it("undoes whichever action happened last", () => {
    // Draw a stroke, then move a text box: the text move reverts first.
    expect(
      chooseNotebookHistorySource({ inkTimestamp: 100, textTimestamp: 200 })
    ).toBe("text");
    // Move a text box, then draw: the stroke reverts first.
    expect(
      chooseNotebookHistorySource({ inkTimestamp: 300, textTimestamp: 200 })
    ).toBe("ink");
  });

  it("falls back to whichever history has anything in it", () => {
    expect(
      chooseNotebookHistorySource({ inkTimestamp: 100, textTimestamp: null })
    ).toBe("ink");
    expect(
      chooseNotebookHistorySource({ inkTimestamp: null, textTimestamp: 100 })
    ).toBe("text");
  });

  it("reports nothing to undo when both histories are empty", () => {
    expect(
      chooseNotebookHistorySource({ inkTimestamp: null, textTimestamp: null })
    ).toBeNull();
  });

  it("breaks a tie towards ink", () => {
    expect(
      chooseNotebookHistorySource({ inkTimestamp: 200, textTimestamp: 200 })
    ).toBe("ink");
  });
});

describe("pushNotebookHistoryEntry", () => {
  it("appends without mutating the original stack", () => {
    const stack = [1, 2];
    expect(pushNotebookHistoryEntry(stack, 3)).toEqual([1, 2, 3]);
    expect(stack).toEqual([1, 2]);
  });

  it("caps the stack by discarding the oldest entry", () => {
    const full = Array.from(
      { length: MAX_NOTEBOOK_HISTORY_ENTRIES },
      (_, index) => index
    );
    const next = pushNotebookHistoryEntry(full, 999);
    expect(next).toHaveLength(MAX_NOTEBOOK_HISTORY_ENTRIES);
    expect(next.at(-1)).toBe(999);
    expect(next[0]).toBe(1);
  });
});
