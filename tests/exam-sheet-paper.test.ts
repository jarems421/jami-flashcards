import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXAM_SHEET_PAPER_DEFAULT,
  examSheetPageGround,
  isExamSheetPaper,
  readExamSheetPaperPreference,
  saveExamSheetPaperPreference,
} from "@/lib/practice/exam-sheet-paper";
import { getNotebookPaperPalette } from "@/lib/workspace/notebook-paper-palette";

function withStorage(store: Record<string, string>, options: { throws?: boolean } = {}) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => {
        if (options.throws) throw new Error("blocked");
        return store[key] ?? null;
      },
      setItem: (key: string, value: string) => {
        if (options.throws) throw new Error("blocked");
        store[key] = value;
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("the paper a student's own sheets are made of", () => {
  it("starts as the ruled white sheet every pad already was", () => {
    withStorage({});
    expect(readExamSheetPaperPreference()).toEqual(EXAM_SHEET_PAPER_DEFAULT);
    expect(EXAM_SHEET_PAPER_DEFAULT).toEqual({ pageColor: "white", pageStyle: "lined" });
  });

  it("remembers a choice across sheets", () => {
    const store: Record<string, string> = {};
    withStorage(store);
    saveExamSheetPaperPreference({ pageColor: "cream", pageStyle: "grid" });
    expect(readExamSheetPaperPreference()).toEqual({ pageColor: "cream", pageStyle: "grid" });
  });

  it.each([
    ["nonsense", "not json at all"],
    ["a colour that is not paper", JSON.stringify({ pageColor: "tartan", pageStyle: "grid" })],
    ["a ruling that does not exist", JSON.stringify({ pageColor: "white", pageStyle: "hatched" })],
    ["half a preference", JSON.stringify({ pageColor: "cream" })],
  ])("falls back to the default on %s", (_name, stored) => {
    withStorage({ "jami.practice.sheetPaper": stored });
    expect(readExamSheetPaperPreference()).toEqual(EXAM_SHEET_PAPER_DEFAULT);
  });

  /** Private browsing refuses storage; a sheet still has to open. */
  it("survives storage being unavailable", () => {
    withStorage({}, { throws: true });
    expect(readExamSheetPaperPreference()).toEqual(EXAM_SHEET_PAPER_DEFAULT);
    expect(() => saveExamSheetPaperPreference({ pageColor: "black", pageStyle: "dot" })).not.toThrow();
  });

  it("rejects a value that is not a paper at all", () => {
    expect(isExamSheetPaper(null)).toBe(false);
    expect(isExamSheetPaper("white")).toBe(false);
    expect(isExamSheetPaper({ pageColor: "white", pageStyle: "lined" })).toBe(true);
  });
});

/**
 * The reason a dark page can be offered at all. Ink is drawn in the colour the
 * student picked and nothing adjusts it to the paper, so flattening a light pen
 * onto white would submit a blank sheet as their answer.
 */
describe("what each page is flattened onto for the marker", () => {
  it("submits a student's sheet on the paper they wrote it on", () => {
    expect(examSheetPageGround({ kind: "continuation" }, { pageColor: "black", pageStyle: "plain" }))
      .toBe(getNotebookPaperPalette("black").paper);
    expect(examSheetPageGround({ kind: "continuation" }, { pageColor: "cream", pageStyle: "lined" }))
      .toBe(getNotebookPaperPalette("cream").paper);
  });

  /** The board's paper is white however the student has set their own. */
  it("keeps a printed page white whatever the student chose", () => {
    expect(examSheetPageGround({ kind: "printed" }, { pageColor: "black", pageStyle: "dot" }))
      .toBe("#ffffff");
  });
});
