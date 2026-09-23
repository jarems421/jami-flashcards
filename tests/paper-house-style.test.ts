import { describe, expect, it } from "vitest";
import {
  paperHouseStyle,
  paperHouseStyleById,
  parsePaperQuestionNumber,
  printedDuration,
  printedEndOfPaper,
  printedQuestionNumber,
  printedQuestionTotal,
  printedSectionHeading,
  printedTariff,
  promptWithoutTariff,
} from "@/lib/practice/paper-house-style";

/**
 * Which board a generated paper is dressed as, and how that board prints a
 * question. The booklet and the marking screen must always name the same
 * question, so a label is reformatted only in ways a student would read as
 * the same number.
 */
describe("choosing a board's house style", () => {
  it("reads the board from the awarding body", () => {
    expect(paperHouseStyle({ awardingBodyOrInstitution: "AQA" }).id).toBe("aqa");
    expect(paperHouseStyle({ awardingBodyOrInstitution: "Pearson Edexcel" }).id).toBe("pearson");
    expect(paperHouseStyle({ awardingBodyOrInstitution: "Edexcel" }).id).toBe("pearson");
    expect(paperHouseStyle({ awardingBodyOrInstitution: "OCR" }).id).toBe("ocr");
    expect(paperHouseStyle({ awardingBodyOrInstitution: "Qualifications Scotland" }).id).toBe("sqa");
    expect(paperHouseStyle({ awardingBodyOrInstitution: "SQA" }).id).toBe("sqa");
    expect(paperHouseStyle({ awardingBodyOrInstitution: "WJEC Eduqas" }).id).toBe("wjec");
    expect(paperHouseStyle({ awardingBodyOrInstitution: "Cambridge International" }).id).toBe("cambridge");
  });

  it("lets the awarding body win over a course name that mentions another board", () => {
    expect(
      paperHouseStyle({ awardingBodyOrInstitution: "OCR", specificationOrCourse: "Replacement for the AQA course" }).id
    ).toBe("ocr");
  });

  it("falls back to a plain style for a university or an unknown board", () => {
    expect(paperHouseStyle({ awardingBodyOrInstitution: "University of Loughborough" }).id).toBe("generic");
    expect(paperHouseStyle(undefined).id).toBe("generic");
  });

  it("does not mistake a word that merely contains a board's letters", () => {
    expect(paperHouseStyle({ awardingBodyOrInstitution: "Aquatic Science Institute" }).id).toBe("generic");
  });
});

describe("question numbers", () => {
  it("takes a label apart into its question and its part", () => {
    expect(parsePaperQuestionNumber("01.2")).toMatchObject({ base: "1", part: "2", numericPart: true });
    expect(parsePaperQuestionNumber("Question 3")).toMatchObject({ base: "3", part: "" });
    expect(parsePaperQuestionNumber("1(b)(ii)")).toMatchObject({ base: "1", part: "(b) (ii)" });
    expect(parsePaperQuestionNumber("2a")).toMatchObject({ base: "2", part: "(a)" });
    expect(parsePaperQuestionNumber("Section B essay")).toMatchObject({ base: null, label: "Section B essay" });
  });

  it("boxes AQA's digits, padded to two", () => {
    const aqa = paperHouseStyleById("aqa");
    expect(printedQuestionNumber(aqa, parsePaperQuestionNumber("1.1"), true)).toBe("01.1");
    expect(printedQuestionNumber(aqa, parsePaperQuestionNumber("02"), true)).toBe("02");
  });

  it("prints only the part's letter after a question's first part, as most boards do", () => {
    const pearson = paperHouseStyleById("pearson");
    expect(printedQuestionNumber(pearson, parsePaperQuestionNumber("1(a)"), true)).toBe("1 (a)");
    expect(printedQuestionNumber(pearson, parsePaperQuestionNumber("1(b)"), false)).toBe("(b)");
  });

  it("keeps a numbered part numbered, so the booklet and the marking screen agree", () => {
    const ocr = paperHouseStyleById("ocr");
    expect(printedQuestionNumber(ocr, parsePaperQuestionNumber("01.2"), false)).toBe("1.2");
  });

  it("puts a full stop after an SQA question number", () => {
    const sqa = paperHouseStyleById("sqa");
    expect(printedQuestionNumber(sqa, parsePaperQuestionNumber("2"), true)).toBe("2.");
    expect(printedQuestionNumber(sqa, parsePaperQuestionNumber("2(a)"), true)).toBe("2. (a)");
  });
});

describe("marks, totals and headings", () => {
  it("prints the marks the way each board does", () => {
    expect(printedTariff(paperHouseStyleById("aqa"), 1)).toBe("[1 mark]");
    expect(printedTariff(paperHouseStyleById("aqa"), 4)).toBe("[4 marks]");
    expect(printedTariff(paperHouseStyleById("pearson"), 4)).toBe("(4)");
    expect(printedTariff(paperHouseStyleById("ocr"), 4)).toBe("[4]");
    expect(printedTariff(paperHouseStyleById("sqa"), 4)).toBe("4");
  });

  it("words Pearson's question total as its maths and science papers do", () => {
    expect(printedQuestionTotal("3", 5, false)).toBe("(Total for Question 3 = 5 marks)");
    expect(printedQuestionTotal("3", 5, true)).toBe("(Total for Question 3 is 5 marks)");
  });

  it("ends the paper in the board's words", () => {
    expect(printedEndOfPaper(paperHouseStyleById("pearson"), 80)).toBe("TOTAL FOR PAPER IS 80 MARKS");
    expect(printedEndOfPaper(paperHouseStyleById("aqa"), 80)).toBe("END OF QUESTIONS");
  });

  it("heads sections in title case or capitals, keeping the section's name", () => {
    expect(printedSectionHeading(paperHouseStyleById("aqa"), "A")).toBe("Section A");
    expect(printedSectionHeading(paperHouseStyleById("pearson"), "Section b: Reading")).toBe("SECTION B: Reading");
  });

  it("drops marks the generator wrote into a prompt, so they are not printed twice", () => {
    expect(promptWithoutTariff("Find two pieces of information about the chimneys. (5 marks)", 5)).toBe(
      "Find two pieces of information about the chimneys."
    );
    expect(promptWithoutTariff("Explain why. [2]", 2)).toBe("Explain why.");
    // A bracketed number that is not this question's tariff is part of the question.
    expect(promptWithoutTariff("Work out the value of (3)", 2)).toBe("Work out the value of (3)");
  });

  it("gives the time as a cover does", () => {
    expect(printedDuration(105)).toBe("1 hour 45 minutes");
    expect(printedDuration(120)).toBe("2 hours");
    expect(printedDuration(45)).toBe("45 minutes");
  });
});
