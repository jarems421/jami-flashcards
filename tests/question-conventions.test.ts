import { describe, expect, it } from "vitest";
import {
  QUESTION_CONVENTIONS,
  questionConventionFor,
  questionConventionsForCourse,
  questionLevel,
} from "@/lib/practice/question-conventions";

/**
 * Which examiner practice a question is marked and written by. The board's own
 * rule for a tariff and wording must win over practice that holds across
 * boards, and a rule must never reach a question from another board or level.
 */
const profile = (awardingBodyOrInstitution: string, qualificationOrModule: string, studyLevel = "") => ({
  awardingBodyOrInstitution,
  qualificationOrModule,
  studyLevel,
});

const conventionFor = (board: string, course: string, prompt: string, marks: number, level = "") =>
  questionConventionFor({ profile: profile(board, course, level), question: { prompt, marks } })?.id ?? null;

describe("choosing the practice for a question", () => {
  it("gives an AQA Geography 9-marker the board's own rule, not the general one", () => {
    expect(conventionFor("AQA", "GCSE Geography", "To what extent has the management scheme been successful?", 9)).toBe(
      "aqa-gcse-geography-9"
    );
  });

  it("tells the AQA English Language questions apart by what they ask", () => {
    expect(conventionFor("AQA", "GCSE English Language", "How does the writer use language here to describe the storm?", 8)).toBe(
      "aqa-gcse-eng-lang-language"
    );
    expect(
      conventionFor("AQA", "GCSE English Language", "How has the writer structured the text to interest you as a reader?", 8)
    ).toBe("aqa-gcse-eng-lang-structure");
    expect(conventionFor("AQA", "GCSE English Language", "Write a summary of the differences between the two schools.", 8)).toBe(
      "aqa-gcse-eng-lang-summary"
    );
    expect(conventionFor("AQA", "GCSE English Language", "Write a description suggested by this picture.", 40)).toBe(
      "aqa-gcse-eng-lang-writing"
    );
  });

  it("does not carry one board's rule to another board's paper", () => {
    expect(conventionFor("Pearson Edexcel", "GCSE English Language", "How does the writer use language?", 8)).not.toBe(
      "aqa-gcse-eng-lang-language"
    );
    expect(conventionFor("AQA", "GCSE History", "Describe two features of the Tudor navy.", 4)).toBeNull();
    expect(conventionFor("Pearson Edexcel", "GCSE History", "Describe two features of the Tudor navy.", 4)).toBe(
      "pearson-gcse-history-describe-two"
    );
  });

  it("marks an SQA Higher History essay on its grid", () => {
    expect(conventionFor("SQA", "Higher History", "How valid is this view?", 22)).toBe("sqa-history-essay");
    expect(conventionFor("Qualifications Scotland", "Higher History", "How fully does Source B explain the reasons?", 10)).toBe(
      "sqa-history-how-fully"
    );
  });

  it("falls back to the command word's practice where no board rule applies", () => {
    expect(conventionFor("OCR", "A level History", "How far do you agree with this view?", 20)).toBe("any-evaluative-extended");
  });

  it("gives short and unmatched questions nothing", () => {
    expect(conventionFor("AQA", "GCSE Mathematics", "Solve 2x + 3 = 11.", 2)).toBeNull();
    expect(conventionFor("AQA", "GCSE Physics", "State the unit of power.", 1)).toBeNull();
  });
});

describe("reading the level", () => {
  it("reads a GCSE Higher tier as GCSE, not a Scottish Higher", () => {
    expect(questionLevel(profile("AQA", "GCSE Physics", "GCSE"), "GCSE Physics Paper 1 (Higher)")).toBe("gcse");
    expect(questionLevel(profile("SQA", "Higher History"))).toBe("scottish");
    expect(questionLevel(profile("AQA", "A level Economics"))).toBe("alevel");
  });
});

describe("the conventions themselves", () => {
  it("have unique ids and say something in every field", () => {
    const ids = QUESTION_CONVENTIONS.map((convention) => convention.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const convention of QUESTION_CONVENTIONS) {
      expect(convention.answerShape.length).toBeGreaterThan(20);
      expect(convention.examinerRules.length).toBeGreaterThan(0);
      expect(convention.pitfalls.length).toBeGreaterThan(0);
    }
  });

  it("offers the paper designer only the course's own kinds of question", () => {
    const geography = questionConventionsForCourse({ board: "AQA", course: "GCSE Geography", level: "GCSE" }).map((c) => c.id);
    expect(geography).toContain("aqa-gcse-geography-9");
    expect(geography).not.toContain("any-evaluative-extended");
    expect(geography).not.toContain("aqa-gcse-eng-lang-language");
  });
});
