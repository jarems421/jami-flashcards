import { describe, expect, it } from "vitest";
import {
  detectExamAnswerParts,
  examAnswerPartLabelsIn,
  examAnswerPartMaxLength,
  joinExamAnswerParts,
  nextExamAnswerPartLabel,
  splitExamAnswerParts,
} from "@/lib/practice/exam-answer-parts";
import { EXAM_ANSWER_MAX_LENGTH } from "@/lib/practice/exam-questions";

describe("detectExamAnswerParts", () => {
  it("finds the parts a question asks for, on their own lines or after a sentence", () => {
    expect(detectExamAnswerParts("A ball is thrown.\n(a) Find its speed.\n(b) Find its height.\n(c) Explain why.")).toEqual([
      "(a)",
      "(b)",
      "(c)",
    ]);
    expect(detectExamAnswerParts("Solve the equation. (i) Factorise it. (ii) Hence solve it.")).toEqual(["(i)", "(ii)"]);
  });

  it("ignores a single part, a gap in the letters, and a label quoted mid-sentence", () => {
    expect(detectExamAnswerParts("(a) Work out 3 x 4.")).toEqual([]);
    expect(detectExamAnswerParts("(b) One thing.\n(c) Another.")).toEqual([]);
    expect(detectExamAnswerParts("Use your answer to part (a) and part (b) here.")).toEqual([]);
  });
});

describe("answers written by part", () => {
  const labels = ["(a)", "(b)", "(c)"];

  it("saves the parts as one labelled answer and reopens it in the same boxes", () => {
    const joined = joinExamAnswerParts(labels, ["x = 4 ", "", "Because the\ngradient is 2"]);
    expect(joined).toBe("(a) x = 4\n\n(c) Because the\ngradient is 2");
    expect(splitExamAnswerParts(joined, labels)).toEqual(["x = 4", "", "Because the\ngradient is 2"]);
    expect(examAnswerPartLabelsIn("(a) one\n\n(b) two")).toEqual(["(a)", "(b)"]);
  });

  it("does not split an answer that was not written by part", () => {
    expect(splitExamAnswerParts("x = 4 from part (a)", labels)).toBeNull();
    expect(splitExamAnswerParts("", labels)).toEqual(["", "", ""]);
    expect(examAnswerPartLabelsIn("x = 4")).toEqual([]);
  });

  it("offers the next part, and keeps the parts inside one answer's length", () => {
    expect(nextExamAnswerPartLabel([])).toBe("(a)");
    expect(nextExamAnswerPartLabel(["(a)", "(b)"])).toBe("(c)");
    expect(nextExamAnswerPartLabel(["(i)", "(ii)"])).toBe("(iii)");
    expect(nextExamAnswerPartLabel(["(g)", "(h)"])).toBeNull();
    const parts = 3;
    expect(examAnswerPartMaxLength(parts) * parts + 8 * parts).toBeLessThanOrEqual(EXAM_ANSWER_MAX_LENGTH);
  });
});
