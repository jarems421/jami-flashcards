import { describe, expect, it } from "vitest";
import {
  examCalculatorChoiceOffered,
  examCoursePapers,
  examPaperKey,
  matchesPaperChoice,
  withPaperCalculatorRules,
} from "@/lib/practice/exam-papers";

/**
 * Choosing a paper, for every subject rather than only maths.
 *
 * The setup screen used to offer calculator and non-calculator on every course,
 * which means nothing to a biology or economics student -- their papers are
 * split by what they examine, and "Paper 2" is how they name it.
 */
describe("telling papers apart", () => {
  it("treats a paper's tiers as one paper", () => {
    expect(examPaperKey("Paper 1 Foundation", "1F")).toBe("paper-1");
    expect(examPaperKey("Paper 1 Higher", "1H")).toBe("paper-1");
  });

  /** The catalogue writes `1H` where an ingested question may carry `8300/1H`. */
  it("agrees across the ways a code is written", () => {
    expect(examPaperKey("Paper 2 Higher", "8300/2H")).toBe(examPaperKey("Paper 2 Higher", "2H"));
    expect(examPaperKey("", "1MA1/3H")).toBe("paper-3");
  });

  it("reads a component numbered with leading zeros", () => {
    expect(examPaperKey("Component 01: Biological processes", "01")).toBe("component-1");
  });

  /*
   * AQA Combined Science numbers each subject's papers from one. Read by number
   * alone, Biology, Chemistry and Physics Paper 1 were one paper.
   */
  it("keeps a combined course's subjects apart, whatever their paper number", () => {
    expect(examPaperKey("Biology Paper 1 Higher", "B/1H")).toBe("biology-paper-1");
    expect(examPaperKey("Chemistry Paper 1 Higher", "C/1H")).toBe("chemistry-paper-1");
    expect(examPaperKey("Biology Paper 1 Foundation", "B/1F")).toBe(examPaperKey("Biology Paper 1 Higher", "B/1H"));
  });
});

describe("listing a combined course's papers", () => {
  it("names each subject's paper for what it is", () => {
    const entries = [
      { componentCode: "C/1H", componentTitle: "Chemistry Paper 1 Higher", tier: "Higher" },
      { componentCode: "B/2H", componentTitle: "Biology Paper 2 Higher", tier: "Higher" },
      { componentCode: "B/1H", componentTitle: "Biology Paper 1 Higher", tier: "Higher" },
      { componentCode: "B/1F", componentTitle: "Biology Paper 1 Foundation", tier: "Foundation" },
    ];
    expect(examCoursePapers(entries, { tier: "Higher" })).toEqual([
      { id: "biology-paper-1", label: "Biology Paper 1" },
      { id: "biology-paper-2", label: "Biology Paper 2" },
      { id: "chemistry-paper-1", label: "Chemistry Paper 1" },
    ]);
  });

  it("matches a question to its own subject's paper only", () => {
    const question = { provenance: { componentTitle: "Chemistry Paper 1 Higher", componentCode: "C/1H" } as never };
    expect(matchesPaperChoice(question, ["chemistry-paper-1"])).toBe(true);
    expect(matchesPaperChoice(question, ["biology-paper-1"])).toBe(false);
  });
});

describe("listing a course's papers", () => {
  it("names each paper once for the student's tier, in order", () => {
    const entries = [
      { componentCode: "2H", componentTitle: "Paper 2 Higher", tier: "Higher" },
      { componentCode: "1F", componentTitle: "Paper 1 Foundation", tier: "Foundation" },
      { componentCode: "1H", componentTitle: "Paper 1 Higher", tier: "Higher" },
      { componentCode: "10H", componentTitle: "Paper 10 Higher", tier: "Higher" },
    ];
    expect(examCoursePapers(entries, { tier: "higher" })).toEqual([
      { id: "paper-1", label: "Paper 1" },
      { id: "paper-2", label: "Paper 2" },
      { id: "paper-10", label: "Paper 10" },
    ]);
  });

  it("keeps what the board's title says the paper is about", () => {
    const entries = [
      { componentCode: "9EC0/01", componentTitle: "Paper 1: Markets and business behaviour" },
      { componentCode: "9EC0/02", componentTitle: "Paper 2: The national and global economy" },
    ];
    expect(examCoursePapers(entries, {})).toEqual([
      { id: "paper-1", label: "Paper 1", detail: "Markets and business behaviour" },
      { id: "paper-2", label: "Paper 2", detail: "The national and global economy" },
    ]);
  });

  it("keeps a calculator rule the title prints, without the tier", () => {
    const entries = [{ componentCode: "1MA1/1H", componentTitle: "Paper 1 (Non-Calculator) Higher" }];
    expect(examCoursePapers(entries, { tier: "Higher" })).toEqual([
      { id: "paper-1", label: "Paper 1", detail: "Non-Calculator" },
    ]);
  });

  it("offers nothing for a catalogue that lists no components", () => {
    expect(examCoursePapers([{ specificationCode: "8461", tier: "foundation" }], { tier: "foundation" })).toEqual([]);
  });
});

describe("filtering questions by paper", () => {
  const question = (componentTitle: string, componentCode: string) => ({
    provenance: { componentTitle, componentCode } as never,
  });

  it("offers every paper when none was chosen", () => {
    expect(matchesPaperChoice(question("Paper 2 Higher", "8461/2H"), [])).toBe(true);
  });

  it("matches the paper chosen and no other", () => {
    expect(matchesPaperChoice(question("Paper 2 Higher", "8461/2H"), ["paper-2"])).toBe(true);
    expect(matchesPaperChoice(question("Paper 1 Higher", "8461/1H"), ["paper-2"])).toBe(false);
  });
});

/**
 * A calculator rule is a property of a paper. Offering the choice beside a
 * chosen paper let a student ask for Paper 3 -- a calculator paper -- without a
 * calculator, which no question can satisfy.
 */
describe("when the calculator question is asked", () => {
  it("is not asked once a paper is chosen, because the paper answers it", () => {
    expect(examCalculatorChoiceOffered({ paperChosen: true, policyKnown: true, calculatorChosen: false })).toBe(false);
    expect(examCalculatorChoiceOffered({ paperChosen: true, policyKnown: true, calculatorChosen: true })).toBe(false);
  });

  it("is asked across all papers on a course whose papers carry a rule", () => {
    expect(examCalculatorChoiceOffered({ paperChosen: false, policyKnown: true, calculatorChosen: false })).toBe(true);
  });

  it("is not asked on a course whose papers have no calculator rule", () => {
    expect(examCalculatorChoiceOffered({ paperChosen: false, policyKnown: false, calculatorChosen: false })).toBe(false);
  });

  it("stays while a choice already made is still narrowing the questions", () => {
    expect(examCalculatorChoiceOffered({ paperChosen: false, policyKnown: false, calculatorChosen: true })).toBe(true);
  });
});

/**
 * Pressing a paper says what it is. AQA titles its maths papers "Paper 1
 * Higher", so the calculator rule comes from the questions ingested from each.
 */
describe("describing a paper by its calculator rule", () => {
  const question = (componentTitle: string, calculatorAllowed?: boolean) => ({
    calculatorAllowed,
    provenance: { componentTitle, componentCode: "" } as never,
  });

  it("says a paper is non-calculator or allows one when its questions agree", () => {
    const papers = [
      { id: "paper-1", label: "Paper 1" },
      { id: "paper-2", label: "Paper 2" },
    ];
    expect(withPaperCalculatorRules(papers, [
      question("Paper 1 Higher", false),
      question("Paper 1 Higher", false),
      question("Paper 2 Higher", true),
    ])).toEqual([
      { id: "paper-1", label: "Paper 1", detail: "Non-calculator" },
      { id: "paper-2", label: "Paper 2", detail: "Calculator allowed" },
    ]);
  });

  it("leaves a title that already states the rule as the board wrote it", () => {
    const papers = [{ id: "paper-2", label: "Paper 2", detail: "Calculator" }];
    expect(withPaperCalculatorRules(papers, [question("Paper 2 Higher", undefined)])).toEqual(papers);
  });

  it("says nothing for a paper whose questions disagree or record no rule", () => {
    const papers = [
      { id: "paper-1", label: "Paper 1" },
      { id: "paper-2", label: "Paper 2" },
      { id: "paper-3", label: "Paper 3" },
    ];
    expect(withPaperCalculatorRules(papers, [
      question("Paper 1", true),
      question("Paper 1", false),
      question("Paper 2", undefined),
    ])).toEqual(papers);
  });

  it("adds the rule after what the board's title says the paper covers", () => {
    const papers = [{ id: "paper-1", label: "Paper 1", detail: "Pure mathematics" }];
    expect(withPaperCalculatorRules(papers, [question("Paper 1: Pure mathematics", true)])).toEqual([
      { id: "paper-1", label: "Paper 1", detail: "Pure mathematics · Calculator allowed" },
    ]);
  });
});
