import { describe, expect, it } from "vitest";
import { readSeparateAwardMarks } from "@/lib/practice/exam-page-regions";
import { isAiInlineDataPart } from "@/lib/ai/content-parts";
import { buildSingleQuestionAnswerParts } from "@/lib/practice/single-question-paper";

/**
 * AQA English Literature prints "[30 marks] AO4 [4 marks]" under its Section A
 * questions. Thirty is the tariff for answering; the four are for technical
 * accuracy, scored across the section from a grid of their own.
 */
describe("marks the paper awards for something other than the answer", () => {
  it("reads the award printed beside a Section A question", () => {
    expect(
      readSeparateAwardMarks(
        "how far Shakespeare presents Macbeth as a character who changes. [30 marks] AO4 [4 marks]"
      )
    ).toBe(4);
  });

  it("does not mistake the question's own tariff for one", () => {
    expect(readSeparateAwardMarks("Explain why the reaction slows down. [6 marks]")).toBeNull();
    expect(readSeparateAwardMarks("(Total for Question 3 is 4 marks)")).toBeNull();
  });

  /** Section B carries no AO4, and neither does any maths paper. */
  it("reads nothing from a question that prints no such award", () => {
    expect(readSeparateAwardMarks("Starting with this extract, explore… [30 marks]")).toBeNull();
    expect(readSeparateAwardMarks("")).toBeNull();
  });

  it("refuses a number too large to be a technical-accuracy award", () => {
    expect(readSeparateAwardMarks("AO4 [40 marks]")).toBeNull();
  });

  it("reads it however the board brackets it", () => {
    expect(readSeparateAwardMarks("AO4 (4 marks)")).toBe(4);
    expect(readSeparateAwardMarks("AO4 [5 mark]")).toBe(5);
  });
});

describe("what the marker is told about it", () => {
  const parts = (separateAwardMarks?: number) => {
    const first = buildSingleQuestionAnswerParts({
      questionId: "q1",
      answerText: "An essay about Macbeth.",
      ...(separateAwardMarks ? { separateAwardMarks } : {}),
    })[0];
    return isAiInlineDataPart(first) ? "" : first.text;
  };

  it("says nothing at all when the paper offers no such award", () => {
    expect(parts()).not.toMatch(/technical accuracy/i);
  });

  /*
   * The marker reads handwriting through a transcription it produced itself,
   * so it is in no position to judge spelling. Being told the marks exist
   * without being told to leave them alone is the worst of both.
   */
  it("names the award and refuses it in the same breath", () => {
    const text = parts(4);
    expect(text).toMatch(/4 marks for technical accuracy/i);
    expect(text).toMatch(/not yours to award/i);
    expect(text).toMatch(/do not deduct for technical accuracy/i);
  });
});
