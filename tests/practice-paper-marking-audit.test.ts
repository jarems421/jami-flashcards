import { describe, expect, it } from "vitest";
import {
  comparePracticePaperMarkings,
  selectThirdViewQuestionIds,
} from "@/services/ai/practice-paper-marking.server";
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

/**
 * Escalation to the independent third view.
 *
 * The old trigger was the marker's own `confidence`, which models emit in a
 * narrow generous band and almost never set to "low" — a safety net that could
 * not fire. These cover the observable replacements.
 */
describe("third-view escalation", () => {
  const escalate = (
    primary: PracticePaperResult,
    verifier: PracticePaperResult,
    adjudicated = primary
  ) =>
    selectThirdViewQuestionIds({
      adjudicated,
      primary,
      verifier,
      disputedQuestionIds: ["q1", "q2"],
    });

  it("escalates a question the blind markers were two or more marks apart on", () => {
    expect(escalate(result([4, 3]), result([4, 1]))).toEqual(["q2"]);
  });

  it("leaves a single mark of daylight to the adjudicator", () => {
    expect(escalate(result([4, 3]), result([4, 2]))).toEqual([]);
  });

  it("escalates when reading the work was flagged as ambiguous", () => {
    const adjudicated = result([4, 3]);
    adjudicated.questionResults[0].transcriptionNote = "Digit unclear";
    expect(escalate(result([4, 3]), result([4, 3]), adjudicated)).toEqual(["q1"]);
  });

  it("does not escalate on self-reported low confidence alone", () => {
    const adjudicated = result([4, 3]);
    adjudicated.questionResults.forEach((question) => {
      question.confidence = "low";
    });
    expect(escalate(result([4, 3]), result([4, 3]), adjudicated)).toEqual([]);
  });

  it("ignores questions that were never disputed", () => {
    expect(
      selectThirdViewQuestionIds({
        adjudicated: result([4, 3]),
        primary: result([4, 3]),
        verifier: result([1, 0]),
        disputedQuestionIds: [],
      })
    ).toEqual([]);
  });
});
