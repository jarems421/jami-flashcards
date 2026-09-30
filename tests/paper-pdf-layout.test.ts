import { describe, expect, it } from "vitest";
import {
  ANSWER_LINE_SPACING,
  answerLineCount,
  answerSpacePoints,
  inferPaperQuestionKind,
  normalizePracticePaperPdfLayout,
  paperSubjectGroup,
  parseMarkdownTableRows,
  questionIdsForPdfPage,
} from "@/lib/practice/paper-pdf-layout";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";

const question = (prompt: string, marks: number) => ({ prompt, marks });

describe("paperSubjectGroup", () => {
  it("spaces maths, science and everything else like their own papers", () => {
    expect(paperSubjectGroup({ qualificationOrModule: "GCSE Mathematics" })).toBe("maths");
    expect(paperSubjectGroup({ specificationOrCourse: "GCSE Combined Science: Trilogy" })).toBe("science");
    expect(paperSubjectGroup({ qualificationOrModule: "A-level Psychology" })).toBe("writing");
    expect(paperSubjectGroup(undefined, "Physics Paper 1 practice")).toBe("science");
  });
});

describe("inferPaperQuestionKind", () => {
  it("reads what the question asks for from its wording", () => {
    expect(inferPaperQuestionKind(question("Tick one box.", 1))).toBe("choice");
    expect(inferPaperQuestionKind(question("Which of the following best describes identification?", 1))).toBe("choice");
    expect(inferPaperQuestionKind(question("Complete the table.", 2))).toBe("draw");
    expect(inferPaperQuestionKind(question("Calculate the resultant force.", 3))).toBe("calculation");
    expect(inferPaperQuestionKind(question("Evaluate the use of wind turbines.", 6))).toBe("extended");
    expect(inferPaperQuestionKind(question("Name the organelle.", 1))).toBe("short");
  });

  it("treats any six-mark question as extended writing", () => {
    expect(inferPaperQuestionKind(question("Plan an investigation into osmosis.", 6))).toBe("extended");
  });
});

describe("answerSpacePoints", () => {
  it("leaves more room as the marks go up", () => {
    const science = [1, 2, 3, 4].map((marks) => answerSpacePoints(question("Calculate the speed.", marks), "science"));
    expect(science).toEqual([...science].sort((a, b) => a - b));
    expect(new Set(science).size).toBe(4);
  });

  it("sits near the measured science and maths figures", () => {
    expect(answerSpacePoints(question("Calculate the speed.", 3), "science")).toBeGreaterThan(140);
    expect(answerSpacePoints(question("Calculate the speed.", 3), "science")).toBeLessThan(200);
    expect(answerSpacePoints(question("Evaluate the method.", 6), "science")).toBeGreaterThan(360);
    expect(answerSpacePoints(question("Work out the value of x.", 4), "maths")).toBeGreaterThan(300);
  });

  it("leaves almost nothing where the answer goes on the figure or in a box", () => {
    expect(answerSpacePoints(question("Tick one box.", 1), "science")).toBe(ANSWER_LINE_SPACING);
    expect(answerSpacePoints(question("Draw the ray diagram.", 3), "science")).toBeLessThan(80);
  });

  it("rules at least one line", () => {
    expect(answerLineCount(3)).toBe(1);
    expect(answerLineCount(ANSWER_LINE_SPACING * 5)).toBe(5);
  });
});

describe("normalizePracticePaperPdfLayout", () => {
  it("keeps a well-formed layout", () => {
    expect(normalizePracticePaperPdfLayout({
      version: 1,
      fileId: "file-1",
      pageCount: 3,
      pages: [{ pageIndex: 1, questionIds: ["q1", "q2"] }],
    })).toEqual({ version: 1, fileId: "file-1", pageCount: 3, pages: [{ pageIndex: 1, questionIds: ["q1", "q2"] }] });
  });

  it("drops pages outside the document and anything that is not a layout", () => {
    expect(normalizePracticePaperPdfLayout({
      version: 1,
      fileId: "file-1",
      pageCount: 2,
      pages: [{ pageIndex: 5, questionIds: ["q1"] }, { pageIndex: 0, questionIds: ["q2", 7, ""] }],
    })?.pages).toEqual([{ pageIndex: 0, questionIds: ["q2"] }]);
    expect(normalizePracticePaperPdfLayout({ version: 2, fileId: "f", pageCount: 1, pages: [] })).toBeUndefined();
    expect(normalizePracticePaperPdfLayout("layout")).toBeUndefined();
  });
});

describe("questionIdsForPdfPage", () => {
  const layout = normalizePracticePaperPdfLayout({
    version: 1,
    fileId: "file-1",
    pageCount: 4,
    pages: [{ pageIndex: 2, questionIds: ["q3", "q4", "gone"] }],
  });
  const known = new Set(["q3", "q4"]);

  it("names the questions printed on that page of the paper", () => {
    expect(questionIdsForPdfPage(layout, { backgroundFileId: "file-1", pdfPageIndex: 2 }, known)).toEqual(["q3", "q4"]);
  });

  it("claims nothing for a page from another file or with no questions", () => {
    expect(questionIdsForPdfPage(layout, { backgroundFileId: "other", pdfPageIndex: 2 }, known)).toEqual([]);
    expect(questionIdsForPdfPage(layout, { backgroundFileId: "file-1", pdfPageIndex: 0 }, known)).toEqual([]);
    expect(questionIdsForPdfPage(undefined, { backgroundFileId: "file-1", pdfPageIndex: 2 }, known)).toEqual([]);
  });
});

describe("a practice paper's stored layout", () => {
  it("survives being read back from the paper record, and junk does not", () => {
    const layout = { version: 1, fileId: "paper-1-booklet", pageCount: 3, pages: [{ pageIndex: 1, questionIds: ["q1"] }] };
    expect(mapPracticePaperData("paper-1", { pdfLayout: layout }).pdfLayout).toEqual(layout);
    expect(mapPracticePaperData("paper-1", { pdfLayout: { fileId: 3 } }).pdfLayout).toBeUndefined();
    expect(mapPracticePaperData("paper-1", {}).pdfLayout).toBeUndefined();
  });
});

describe("asset content parsing", () => {
  it("reads a Markdown table without its alignment row", () => {
    expect(parseMarkdownTableRows("| Mass | Weight |\n|---|---|\n| 2 | 19.6 |")).toEqual([
      ["Mass", "Weight"],
      ["2", "19.6"],
    ]);
  });

});

describe("space for a long essay", () => {
  it("stops growing at about four pages, however many marks the essay carries", async () => {
    const { answerSpacePoints, EXTENDED_ANSWER_MAX } = await import("@/lib/practice/paper-pdf-layout");
    const essay = (marks: number) => ({ prompt: "Write an article for your school magazine.", marks });
    expect(answerSpacePoints(essay(12), "writing")).toBe(67 * 12);
    expect(answerSpacePoints(essay(87), "writing")).toBe(EXTENDED_ANSWER_MAX);
  });
});
