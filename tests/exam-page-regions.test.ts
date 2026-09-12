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
      ["Work out 3 + 4.", 120, 750],
      ["2", 50, 500],
      ["Simplify the expression.", 120, 500],
    ]),
    page(2, [
      ["3", 50, 700],
      ["Solve for x.", 120, 700],
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
      page(1, [["1", 50, 750], ["Work out 3 + 4.", 120, 750], ["7", 400, 600], ["12", 300, 400]]),
    ];
    expect(findQuestionStarts(withBodyNumbers).map((s) => s.label)).toEqual(["1"]);
  });

  it("ignores part labels, which belong to the question above them", () => {
    const withParts = [
      page(1, [
        ["1", 50, 750], ["Work out 3 + 4.", 120, 750],
        ["(a)", 60, 700], ["Simplify the thing.", 120, 700],
        ["(b)", 60, 600], ["Factorise the thing.", 120, 600],
      ]),
    ];
    expect(findQuestionStarts(withParts).map((s) => s.label)).toEqual(["1"]);
  });
});

describe("the slice of paper a question occupies", () => {
  const pages = [
    page(1, [["1", 50, 750], ["Work it out.", 120, 750], ["2", 50, 400], ["Simplify the thing.", 120, 400]]),
    page(2, [["3", 50, 600], ["Solve for x now.", 120, 600]]),
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

/**
 * AQA maths, which is neither of the two shapes this was built for.
 *
 * Edexcel prints a bare `3`. AQA science prints `01.1` in the margin. AQA
 * maths repeats the question number on every part and puts the letter beside
 * it -- `11` then `(a)` -- so the joined margin line reads `11 (a)`. That
 * matched nothing, and every multi-part question on three real papers was
 * rejected: 42 of 42.
 */
describe("a question numbered like AQA maths", () => {
  const pages = [
    page(1, [
      ["11", 44, 765], ["The Venn diagram represents 100 items.", 100, 765],
      ["11", 44, 540], ["(a)", 62, 540], ["Write down P(A and B)", 99, 540],
      ["[1 mark]", 491, 525],
      ["11", 44, 441], ["(b)", 64, 441], ["Work out P(A')", 99, 441],
      ["[1 mark]", 491, 429],
      ["12", 44, 300], ["(a)", 62, 300], ["A different question entirely.", 99, 300],
    ]),
  ];
  const starts = findQuestionStarts(pages);

  it("reads the number and its letter as one part label", () => {
    expect(starts.map((start) => start.label)).toEqual(["11", "11(a)", "11(b)", "12(a)"]);
  });

  /*
   * Question 12 opens straight onto its first part, so its number never
   * appears alone. Before parts were read at all it therefore had no start of
   * any kind -- which is how questions 1, 12 and 13 of 8300/1H lost their
   * regions as well as their parts.
   */
  it("still finds a question that opens straight onto a part", () => {
    expect(starts.some((start) => start.label === "12(a)")).toBe(true);
  });

  it("crops a part to its own lines, not its whole question", () => {
    const own = regionsForQuestion({ label: "11(a)", starts, pages, headroom: 0 });
    expect(own).toEqual([{ page: 1, fromRatio: (800 - 540) / 800, toRatio: (800 - 441) / 800 }]);
  });

  /*
   * "Write down P(A and B)" is unanswerable without the Venn diagram, which is
   * printed once above `(a)` against the bare `11`. A part cropped to its own
   * lines is a question with its subject removed.
   */
  it("carries the question's stem into the part a student sees", () => {
    const withStem = regionsForQuestion({ label: "11(a)", starts, pages, headroom: 0, withStemOf: "11" });
    expect(withStem).toEqual([
      { page: 1, fromRatio: (800 - 765) / 800, toRatio: (800 - 540) / 800 },
      { page: 1, fromRatio: (800 - 540) / 800, toRatio: (800 - 441) / 800 },
    ]);
  });

  it("adds no stem for a question that has none of its own", () => {
    expect(regionsForQuestion({ label: "12(a)", starts, pages, headroom: 0, withStemOf: "12" }))
      .toEqual(regionsForQuestion({ label: "12(a)", starts, pages, headroom: 0 }));
  });

  /*
   * A label's glyphs sit above its baseline, so a crop ending exactly on the
   * next label's baseline still shows that label -- every question image
   * carried the first line of the one after it.
   */
  it("stops short of the next label rather than on it", () => {
    const [region] = regionsForQuestion({ label: "11(a)", starts, pages, headroom: 12 });
    expect(region.toRatio).toBeLessThan((800 - 441) / 800);
  });
});

/**
 * Which column counts as prose, on a paper whose furniture outnumbers it.
 *
 * AQA's 8300/2H prints its footer at x=475 across 32 pages, which outvoted the
 * 39 lines of actual question text at x=99. "Margin" then meant everything
 * left of 473, so a whole line joined into "5 Jess saves 2p, 5p and 10p
 * coins." and normalised to nothing: four question starts were found on a
 * paper with twenty-five.
 */
describe("telling prose from page furniture", () => {
  it("takes the leftmost busy column, not the busiest", () => {
    const body = (n: number) => page(n, [
      [`${n}`, 50, 750],
      ["A question that is printed in the body column.", 99, 750],
      ["IB/M/Jun23/8300/2H", 475, 18],
      ["Do not write outside", 543, 783],
    ]);
    // Five pages: the footer and header repeat on each and the prose does not
    // repeat any harder, so the busiest column is furniture.
    const pages = [1, 2, 3, 4, 5].map(body);
    expect(findQuestionStarts(pages).map((start) => start.label)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
