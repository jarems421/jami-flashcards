import { describe, expect, it } from "vitest";
import {
  findQuestionStarts,
  readPrintedTariff,
  readPrintedTariffs,
  regionsForQuestion,
  schemeCoversQuestion,
  type PdfPageText,
} from "@/lib/practice/exam-page-regions";

/** PDF y grows upward from the bottom, which is why `top` is height - y. */
function page(number: number, items: Array<[string, number, number]>): PdfPageText {
  return {
    page: number,
    width: 600,
    height: 800,
    items: items.map(([text, x, y]) => ({ text, x, y, height: 10 })),
  };
}

describe("finding where questions start", () => {
  const pages = [
    page(1, [
      ["1", 50, 750],
      ["Work out 3 + 4.", 90, 750],
      ["2", 50, 500],
      ["Simplify the expression.", 90, 500],
    ]),
    page(2, [
      ["3", 50, 700],
      ["Solve for x.", 90, 700],
    ]),
  ];

  it("reads the numbers printed in the left margin, in order", () => {
    expect(findQuestionStarts(pages)).toEqual([
      { label: "1", page: 1, top: 50 },
      { label: "2", page: 1, top: 300 },
      { label: "3", page: 2, top: 100 },
    ]);
  });

  it("ignores numbers in the body of the page", () => {
    // An answer line or a figure caption is not a question start.
    const withBodyNumbers = [
      page(1, [["1", 50, 750], ["Work out 3 + 4.", 90, 750], ["7", 400, 600], ["12", 300, 400]]),
    ];
    expect(findQuestionStarts(withBodyNumbers).map((s) => s.label)).toEqual(["1"]);
  });

  it("ignores part labels, which belong to the question above them", () => {
    const withParts = [
      page(1, [
        ["1", 50, 750], ["Work out 3 + 4.", 90, 750],
        ["(a)", 60, 700], ["Simplify.", 100, 700],
        ["(b)", 60, 600], ["Factorise.", 100, 600],
      ]),
    ];
    expect(findQuestionStarts(withParts).map((s) => s.label)).toEqual(["1"]);
  });
});

describe("the slice of paper a question occupies", () => {
  const pages = [
    page(1, [["1", 50, 750], ["Work it out.", 90, 750], ["2", 50, 400], ["Simplify.", 90, 400]]),
    page(2, [["3", 50, 600], ["Solve for x.", 90, 600]]),
  ];
  const starts = findQuestionStarts(pages);

  it("runs from its own label to the next question on the same page", () => {
    const [region] = regionsForQuestion({ label: "1", starts, pages, headroom: 0 });
    expect(region).toEqual({ page: 1, fromRatio: 50 / 800, toRatio: 400 / 800 });
  });

  /*
   * This is the case the whole-page render silently dropped: a question whose
   * continuation is on the following page kept only its first half.
   */
  it("carries on to the next page when the question does", () => {
    const regions = regionsForQuestion({ label: "2", starts, pages, headroom: 0 });
    expect(regions).toEqual([
      { page: 1, fromRatio: 400 / 800, toRatio: 1 },
      { page: 2, fromRatio: 0, toRatio: 200 / 800 },
    ]);
  });

  it("runs to the foot of the page when nothing follows", () => {
    expect(regionsForQuestion({ label: "3", starts, pages, headroom: 0 })).toEqual([
      { page: 2, fromRatio: 200 / 800, toRatio: 1 },
    ]);
  });

  it("returns nothing for a label the paper does not have", () => {
    expect(regionsForQuestion({ label: "9", starts, pages })).toEqual([]);
  });
});

describe("reading the printed tariff", () => {
  // Verbatim from Edexcel 1MA1/1H, June 2023, as pdfjs reads it.
  const edexcel =
    "1 Work out 8.46 ÷ 0.15 ...... (Total for Question 1 is 3 marks) " +
    "2 Work out 7 3 8 2 1 2 − Give your answer as a mixed number. ...... (Total for Question 2 is 3 marks) " +
    "3 Solve ...... (Total for Question 3 is 4 marks)";

  it("maps each question to the tariff the paper prints for it", () => {
    const tariffs = readPrintedTariffs(edexcel);
    expect(tariffs.get("1")).toBe(3);
    expect(tariffs.get("2")).toBe(3);
    expect(tariffs.get("3")).toBe(4);
  });

  /*
   * "(Total for Question 12 is 3 marks)" holds two numbers, and the question
   * number is the larger one. Scanning a region for the biggest number in a
   * bracket would have read the tariff as twelve.
   */
  it("does not mistake the question number for the tariff", () => {
    expect(readPrintedTariffs("(Total for Question 12 is 3 marks)").get("12")).toBe(3);
  });

  it("says nothing about a paper whose format it cannot read", () => {
    expect(readPrintedTariffs("Work out the answer.").size).toBe(0);
  });

  it("falls back to a bare bracketed tariff inside one question's region", () => {
    expect(readPrintedTariff("Work out the answer. (3)")).toBe(3);
    expect(readPrintedTariff("Explain your reasoning. [4 marks]")).toBe(4);
    expect(readPrintedTariff("Work out the answer.")).toBeNull();
  });
});

describe("whether the scheme covers a question", () => {
  // The real shape: boilerplate, then a table whose rows start with the number.
  const scheme =
    "Mark Scheme (Results) Summer 2023 Pearson Edexcel GCSE In Mathematics (1MA1) " +
    "Edexcel and BTEC qualifications are awarded by Pearson ... " +
    "Question Answer Mark Mark scheme Additional guidance " +
    "1 56.4 M1 for a start to a method, eg 846 ÷ 15 " +
    "2 4 7 8 M2 for a complete method";

  it("finds a question that has a row in the table", () => {
    expect(schemeCoversQuestion(scheme, "1")).toBe(true);
    expect(schemeCoversQuestion(scheme, "2")).toBe(true);
  });

  it("refuses a question the table does not carry", () => {
    expect(schemeCoversQuestion(scheme, "9")).toBe(false);
    expect(schemeCoversQuestion(scheme, "")).toBe(false);
  });

  /*
   * "56.4" and "846" are an answer and a working step. Searching the whole
   * document for the digits would have matched them and called every question
   * covered.
   */
  it("does not count numbers that appear before the table", () => {
    expect(schemeCoversQuestion("Pearson Edexcel 2023 GCSE 1MA1 Higher Paper 1H", "1")).toBe(false);
  });
});
