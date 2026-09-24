// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTEBOOK_TOOL_PREFERENCES_DEFAULT,
  NOTEBOOK_TOOL_PREFERENCES_STORAGE_KEY,
  clampNotebookToolPreferences,
  readNotebookToolPreferences,
  saveNotebookToolPreferences,
} from "@/lib/workspace/notebook-tool-preferences";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("notebook tool preferences", () => {
  it("hands back the default pen when nothing has been set", () => {
    expect(readNotebookToolPreferences()).toEqual(
      NOTEBOOK_TOOL_PREFERENCES_DEFAULT
    );
  });

  it("hands back the pen that was put down", () => {
    saveNotebookToolPreferences({ penColor: "red", penThicknessPercent: 22 });
    saveNotebookToolPreferences({ eraserMode: "stroke", eraserSize: "large" });

    expect(readNotebookToolPreferences()).toEqual({
      ...NOTEBOOK_TOOL_PREFERENCES_DEFAULT,
      penColor: "red",
      penThicknessPercent: 22,
      eraserMode: "stroke",
      eraserSize: "large",
    });
  });

  it("keeps a custom colour, lower-cased the way the picker stores it", () => {
    saveNotebookToolPreferences({ penColor: "#1D4ED8" });
    expect(readNotebookToolPreferences().penColor).toBe("#1d4ed8");
  });

  it("merges against what is stored, not against a stale caller", () => {
    // Two surfaces each change one tool; neither undoes the other.
    saveNotebookToolPreferences({ penColor: "green" });
    saveNotebookToolPreferences({ highlighterColor: "pink" });

    const stored = readNotebookToolPreferences();
    expect(stored.penColor).toBe("green");
    expect(stored.highlighterColor).toBe("pink");
  });

  it("keeps each tool to colours it can actually draw in", () => {
    // A highlighter restored as black would paint an opaque bar.
    expect(
      clampNotebookToolPreferences({ highlighterColor: "black" }).highlighterColor
    ).toBe("yellow");
    expect(clampNotebookToolPreferences({ penColor: "pink" }).penColor).toBe(
      "black"
    );
  });

  it("loses only the field storage mangled, not the whole pen", () => {
    window.localStorage.setItem(
      NOTEBOOK_TOOL_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        penColor: "red",
        penThicknessPercent: "thick",
        highlighterThicknessPercent: 480,
        eraserMode: "rubber",
        eraserSize: "small",
      })
    );

    expect(readNotebookToolPreferences()).toEqual({
      ...NOTEBOOK_TOOL_PREFERENCES_DEFAULT,
      penColor: "red",
      highlighterThicknessPercent: 100,
      eraserSize: "small",
    });
  });

  it("falls back to the default on unreadable storage", () => {
    window.localStorage.setItem(NOTEBOOK_TOOL_PREFERENCES_STORAGE_KEY, "{not json");
    expect(readNotebookToolPreferences()).toEqual(
      NOTEBOOK_TOOL_PREFERENCES_DEFAULT
    );

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readNotebookToolPreferences()).toEqual(
      NOTEBOOK_TOOL_PREFERENCES_DEFAULT
    );
  });

  it("never throws when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveNotebookToolPreferences({ penColor: "red" })).not.toThrow();
  });
});
