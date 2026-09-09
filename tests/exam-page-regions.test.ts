import { describe, expect, it } from "vitest";
import {
  findQuestionStarts,
  readPrintedTariff,
  regionsForQuestion,
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
  it("reads the forms boards actually print", () => {
    expect(readPrintedTariff("Work out the answer. (3)")).toBe(3);
    expect(readPrintedTariff("Explain your reasoning. [4 marks]")).toBe(4);
    expect(readPrintedTariff("... (2 marks)")).toBe(2);
  });

  it("takes the total when parts print their own marks", () => {
    expect(readPrintedTariff("(a) ... (2) (b) ... (3) Total (5)")).toBe(5);
  });

  it("returns nothing rather than guessing", () => {
    expect(readPrintedTariff("Work out the answer.")).toBeNull();
    expect(readPrintedTariff("Figure (99)")).toBeNull();
  });
});
