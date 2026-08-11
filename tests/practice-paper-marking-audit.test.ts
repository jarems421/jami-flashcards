import { describe, expect, it } from "vitest";
import { comparePracticePaperMarkings } from "@/services/ai/practice-paper-marking.server";
import type { PracticePaperResult } from "@/lib/practice/practice-papers";

function result(scores: [number, number], criteria: [boolean, boolean] = [true, true]): PracticePaperResult {
  return {
    awardedMarks: scores[0] + scores[1],
    totalMarks: 10,
    percentage: (scores[0] + scores[1]) * 10,
    summary: "",
    strengths: [],
    priorities: [],
    questionResults: [0, 1].map((index) => ({
      questionId: `q${index + 1}`,
      label: `Question ${index + 1}`,
      awardedMarks: scores[index],
      maxMarks: 5,
      feedback: "",
      criterionResults: [{ criterion: "Correct method", awarded: criteria[index], evidence: "working" }],
      evidence: [],
      correction: "",
      nextStep: "",
      modelAnswer: "",
      strengths: [],
      improvements: [],
      confidence: "high" as const,
      counted: true,
      attempted: true,
    })),
  };
}

describe("independent practice-paper marking", () => {
  it("adjudicates score differences question by question", () => {
    expect(comparePracticePaperMarkings(result([4, 3]), result([4, 2]))).toEqual(["q2"]);
  });

  it("also catches criterion disagreement when totals match", () => {
    expect(comparePracticePaperMarkings(result([4, 3]), result([4, 3], [false, true]))).toEqual(["q1"]);
  });
});
