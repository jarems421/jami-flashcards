import { describe, expect, it } from "vitest";
import { matchesCalculatorChoice, isExamCalculatorChoice } from "@/lib/practice/exam-questions";
import { readCalculatorPolicy } from "@/lib/practice/exam-paper-instructions";
import { examCourseTiers } from "@/lib/practice/exam-course-tiers";
import type { PdfPageText } from "@/lib/practice/exam-page-regions";

function cover(text: string, pageNumber = 1): PdfPageText {
  return {
    page: pageNumber,
    width: 595,
    height: 842,
    items: text.split(" ").map((word, index) => ({ text: word, x: 100 + index, y: 700, height: 10 })),
  };
}

/**
 * Whether a calculator is allowed, read rather than configured.
 *
 * A table of which paper allows what would need maintaining per board, per
 * specification and per year, and would go wrong quietly. The paper says so on
 * its cover, in the board's own words, which is also where a student looks.
 */
describe("reading a paper's calculator policy", () => {
  it("reads AQA's refusal", () => {
    expect(readCalculatorPolicy([cover("GCSE MATHEMATICS Higher Tier Paper 1 You must not use a calculator.")])).toBe(false);
  });

  it("reads AQA's own name for the paper", () => {
    expect(readCalculatorPolicy([cover("GCSE MATHEMATICS Higher Tier Paper 1 Non-Calculator")])).toBe(false);
  });

  /*
   * "Non-Calculator" contains the word the permissive patterns look for, so
   * asking them first turns every non-calculator paper into a calculator one.
   */
  it("lets a refusal win over the word it contains", () => {
    const both = cover("Paper 1 Non-Calculator For this paper you must have: a calculator");
    expect(readCalculatorPolicy([both])).toBe(false);
  });

  it("reads the materials list as permission", () => {
    expect(readCalculatorPolicy([cover("For this paper you must have: a calculator, mathematical instruments and the Formulae Sheet.")])).toBe(true);
  });

  it("reads the paper's own title as permission", () => {
    expect(readCalculatorPolicy([cover("GCSE MATHEMATICS Higher Tier Paper 2 Calculator")])).toBe(true);
  });

  it("says nothing when the cover says nothing", () => {
    expect(readCalculatorPolicy([cover("GCSE ENGLISH LITERATURE Paper 1 Shakespeare")])).toBeUndefined();
  });

  /** A policy is a property of the paper, and the cover is where it is stated. */
  it("does not read a mention from inside the paper", () => {
    const pages = [cover("GCSE MATHEMATICS Paper 2"), cover("you may use a calculator for this question", 4)];
    expect(readCalculatorPolicy(pages)).toBeUndefined();
  });
});

describe("filtering questions by what a student asked for", () => {
  it("offers everything when they did not ask", () => {
    expect(matchesCalculatorChoice({ calculatorAllowed: true }, "any")).toBe(true);
    expect(matchesCalculatorChoice({ calculatorAllowed: false }, undefined)).toBe(true);
    expect(matchesCalculatorChoice({}, "any")).toBe(true);
  });

  it("matches the paper they asked for", () => {
    expect(matchesCalculatorChoice({ calculatorAllowed: false }, "non_calculator")).toBe(true);
    expect(matchesCalculatorChoice({ calculatorAllowed: true }, "non_calculator")).toBe(false);
    expect(matchesCalculatorChoice({ calculatorAllowed: true }, "calculator")).toBe(true);
    expect(matchesCalculatorChoice({ calculatorAllowed: false }, "calculator")).toBe(false);
  });

  /*
   * "We do not know" and "no calculator" are different answers. A question
   * whose paper never said belongs in neither pile, or a student asking for
   * non-calculator practice gets a calculator question that nobody checked.
   */
  it("withholds a question whose paper never said", () => {
    expect(matchesCalculatorChoice({}, "non_calculator")).toBe(false);
    expect(matchesCalculatorChoice({}, "calculator")).toBe(false);
  });

  it("recognises only the three choices it offers", () => {
    expect(isExamCalculatorChoice("calculator")).toBe(true);
    expect(isExamCalculatorChoice("maybe")).toBe(false);
    expect(isExamCalculatorChoice(undefined)).toBe(false);
  });
});

/**
 * A tier that narrows nothing is a question not worth asking.
 *
 * AQA does not record a tier field on its GCSE maths catalogue entries -- it is
 * in the component's name -- so the tier question rendered empty and a Higher
 * student was drawn Foundation questions alongside their own.
 */
describe("reading tiers off component names", () => {
  const components = [
    { code: "1F", title: "Paper 1 Foundation" },
    { code: "1H", title: "Paper 1 Higher" },
    { code: "2F", title: "Paper 2 Foundation" },
    { code: "2H", title: "Paper 2 Higher" },
    { code: "3F", title: "Paper 3 Foundation" },
    { code: "3H", title: "Paper 3 Higher" },
  ];

  it("groups each tier with the papers it covers", () => {
    expect(examCourseTiers(components)).toEqual([
      { name: "Foundation", componentIds: ["1F", "2F", "3F"] },
      { name: "Higher", componentIds: ["1H", "2H", "3H"] },
    ]);
  });

  it("treats 'Higher Tier' and 'Higher' as one tier", () => {
    const mixed = [
      { code: "1H", title: "Paper 1 Higher Tier" },
      { code: "2H", title: "Paper 2 Higher" },
      { code: "1F", title: "Paper 1 Foundation" },
    ];
    const higher = examCourseTiers(mixed).find((tier) => tier.name === "Higher");
    expect(higher?.componentIds).toEqual(["1H", "2H"]);
  });

  /** A course with one tier named in its components is not tiered at all. */
  it("offers no tier when only one is named", () => {
    expect(examCourseTiers([{ code: "1", title: "Paper 1 Higher" }])).toEqual([]);
  });

  it("falls back to a declared tier, which narrows nothing", () => {
    expect(examCourseTiers([{ code: "01", title: "Paper 1" }], ["Higher"])).toEqual([
      { name: "Higher", componentIds: [] },
    ]);
  });

  it("offers nothing for a course with neither", () => {
    expect(examCourseTiers([{ code: "01", title: "Paper 1" }])).toEqual([]);
  });
});
