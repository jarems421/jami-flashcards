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
      criterionResults: [
        { criterionId: "C1", criterion: "Correct method", awarded: criteria[index], evidence: "working" },
      ],
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

  /**
   * Criterion identity comes from the scheme, never from the prose either
   * model wrote. Two markers describing the same criterion differently used to
   * be treated as disagreeing, which disputed every marking ever made -- the
   * union of their labels always contained entries the other side had not
   * used, and a missing entry compared unequal to a present one.
   */
  it("compares criteria by the scheme's id, not by how each marker worded it", () => {
    const left = result([4, 3]);
    const right = result([4, 3]);
    left.questionResults[0].criterionResults = [
      { criterionId: "C1", criterion: "Identifies the writer's use of metaphor", awarded: true, evidence: "" },
    ];
    right.questionResults[0].criterionResults = [
      { criterionId: "C1", criterion: "identifies use of metaphor", awarded: true, evidence: "" },
    ];
    expect(comparePracticePaperMarkings(left, right)).toEqual([]);
  });

  it("ignores a criterion only one marker ruled on", () => {
    const left = result([4, 3]);
    const right = result([4, 3]);
    left.questionResults[0].criterionResults = [
      { criterionId: "C1", criterion: "Method", awarded: true, evidence: "" },
      { criterionId: "C2", criterion: "Accuracy", awarded: false, evidence: "" },
    ];
    right.questionResults[0].criterionResults = [
      { criterionId: "C1", criterion: "Method", awarded: true, evidence: "" },
    ];
    expect(comparePracticePaperMarkings(left, right)).toEqual([]);
  });

  /** Reports made before ids existed must keep loading, and never dispute. */
  it("does not dispute on criteria that carry no id at all", () => {
    const left = result([4, 3]);
    const right = result([4, 3]);
    left.questionResults[0].criterionResults = [
      { criterion: "Method", awarded: true, evidence: "" },
    ];
    right.questionResults[0].criterionResults = [
      { criterion: "Something else entirely", awarded: false, evidence: "" },
    ];
    expect(comparePracticePaperMarkings(left, right)).toEqual([]);
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
