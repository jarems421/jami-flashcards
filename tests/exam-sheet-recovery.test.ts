import { describe, expect, it } from "vitest";
import { examQuestionContentVersion } from "@/lib/practice/exam-content-version";
import { recoverExamQuestionRegions } from "@/lib/practice/exam-sheet-recovery";
import {
  findQuestionStarts,
  regionsForQuestion,
  type PdfPageText,
} from "@/lib/practice/exam-page-regions";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/practice-papers";

/**
 * A page of an exam paper: question numbers in the left margin, prose beside
 * them. `findQuestionStarts` reads the margin column, so the shape matters more
 * than the words.
 */
function paperPage(
  page: number,
  rows: Array<{ label?: string; text: string; top: number }>
): PdfPageText {
  return {
    page,
    width: 595,
    height: 842,
    items: rows.flatMap((row) => [
      ...(row.label ? [{ text: row.label, x: 60, y: 842 - row.top, height: 11 }] : []),
      { text: row.text, x: 110, y: 842 - row.top, height: 11 },
    ]),
  };
}

const PAGES: PdfPageText[] = [
  paperPage(1, [
    { label: "1", text: "Work out the value of x in the diagram below.", top: 120 },
    { text: "Show each step of your working clearly.", top: 150 },
    { text: "..............................................", top: 220 },
    { label: "2", text: "The table shows the mass of four samples.", top: 400 },
    { text: "Calculate the mean mass of the four samples.", top: 430 },
    { text: "..............................................", top: 500 },
  ]),
  paperPage(2, [
    { label: "3", text: "Explain why the reaction slows down over time.", top: 100 },
    { text: "Refer to collision theory in your answer.", top: 130 },
    { text: "..............................................", top: 200 },
  ]),
];

const STARTS = findQuestionStarts(PAGES);

const SCHEME: PracticePaperMarkSchemeItem = {
  questionId: "q",
  maxMarks: 3,
  regime: "points",
  criteria: [{ description: "Correct method", marks: 2 }, { description: "Correct answer", marks: 1 }],
  acceptableAlternatives: [],
} as unknown as PracticePaperMarkSchemeItem;

const PAPER_SHA = "a".repeat(64);

/** A question exactly as ingestion would have stamped it. */
function storedQuestion(label: string, page: number) {
  const regions = regionsForQuestion({ label, starts: STARTS, pages: PAGES });
  return {
    regions,
    contentVersion: examQuestionContentVersion({
      prompt: `Prompt for ${label}`,
      marks: 3,
      markSchemeItem: SCHEME,
      page,
      regions,
      paperSha256: PAPER_SHA,
    }),
  };
}

function recover(label: string, page: number, overrides: Record<string, unknown> = {}) {
  const stored = storedQuestion(label, page);
  return {
    stored,
    recovered: recoverExamQuestionRegions({
      contentVersion: stored.contentVersion,
      prompt: `Prompt for ${label}`,
      marks: 3,
      markSchemeItem: SCHEME,
      paperSha256: PAPER_SHA,
      label,
      questionNumber: label,
      starts: STARTS,
      pages: PAGES,
      pageCount: PAGES.length,
      ...overrides,
    }),
  };
}

describe("recovering the region a stored question was cut from", () => {
  it("finds the paper read the question started on", () => {
    expect(STARTS.map((start) => start.label)).toEqual(["1", "2", "3"]);
  });

  it.each([
    ["1", 1],
    ["2", 1],
    ["3", 2],
  ])("recovers question %s exactly", (label, page) => {
    const { stored, recovered } = recover(label, page);
    expect(recovered).not.toBeNull();
    expect(recovered!.regions).toEqual(stored.regions);
    expect(recovered!.page).toBe(page);
    expect(recovered!.startLabel).toBe(label);
  });

  /*
   * The whole safety argument. A version that cannot be reproduced means some
   * input to it is not what this thinks it is, and the only safe answer is to
   * render nothing over that question.
   */
  it("refuses a question whose stored version cannot be reproduced", () => {
    const { recovered } = recover("1", 1, { contentVersion: "0".repeat(16) });
    expect(recovered).toBeNull();
  });

  it.each([
    ["the wording", { prompt: "Something else entirely" }],
    ["the tariff", { marks: 5 }],
    ["the source document", { paperSha256: "b".repeat(64) }],
    ["the scheme", { markSchemeItem: { ...SCHEME, maxMarks: 9 } }],
  ])("refuses when %s no longer matches", (_name, override) => {
    const { recovered } = recover("2", 1, override);
    expect(recovered).toBeNull();
  });

  /**
   * A question stored under the board's printed reference rather than the
   * margin label its crop came from. There is no way back from one to the
   * other, so the search tries the paper's other labels -- and the hash is what
   * says which of them was right.
   */
  it("still finds the region when the stored label is not the margin label", () => {
    const { stored, recovered } = recover("3", 2, { label: "Question 3 (03.1)", questionNumber: "03.1" });
    expect(recovered).not.toBeNull();
    expect(recovered!.regions).toEqual(stored.regions);
    expect(recovered!.startLabel).toBe("3");
  });

  it("searches a small space, so a paper is not expensive to walk", () => {
    const { recovered } = recover("2", 1);
    // Its own label first, then only the pages it could have been recorded on.
    expect(recovered!.tried).toBeLessThanOrEqual(PAGES.length);
  });
});
