import { describe, expect, it } from "vitest";
import {
  countedAnswers,
  practiceMissionCompletion,
} from "@/lib/learning/interventions/practice-completion";

/**
 * Reading a marked paper as "the work Jami asked for got done".
 *
 * The two failures worth guarding are opposite and both bad. Counting rows
 * would tell a student who answered two of five that they answered five, and
 * would rest advice they still need. Counting nothing would leave the loop
 * open on the branch this exists to close.
 */

function answer(overrides: Record<string, unknown> = {}) {
  return { questionId: "q1", maxMarks: 3, awardedMarks: 2, ...overrides };
}

function paper(overrides: Record<string, unknown> = {}) {
  return {
    createdByInterventionId: "folder:f1|low_mastery|topic:spec:quad-complete",
    coverage: "Completing the square",
    title: "Completing the square",
    questions: [{}, {}, {}],
    result: { questionResults: [answer(), answer({ questionId: "q2" })] },
    ...overrides,
  };
}

describe("counting what a sitting actually answered", () => {
  it("counts a question that produced a mark", () => {
    expect(countedAnswers({ questionResults: [answer(), answer()] })).toBe(2);
  });

  it("does not count a question the student never attempted", () => {
    expect(
      countedAnswers({
        questionResults: [answer(), answer({ attempted: false }), answer({ counted: false })],
      })
    ).toBe(1);
  });

  it("does not count a result with nothing markable in it", () => {
    expect(
      countedAnswers({
        questionResults: [answer({ maxMarks: 0 }), answer({ awardedMarks: "two" })],
      })
    ).toBe(0);
  });

  it("reads a paper that has not been marked as nothing answered", () => {
    expect(countedAnswers(undefined)).toBe(0);
    expect(countedAnswers({})).toBe(0);
  });
});

describe("whether a marked paper completes a recommendation", () => {
  it("reports the concept, what was answered, and what was asked", () => {
    expect(practiceMissionCompletion(paper())).toEqual({
      interventionId: "folder:f1|low_mastery|topic:spec:quad-complete",
      conceptLabel: "Completing the square",
      answered: 2,
      targetItems: 3,
    });
  });

  it("says nothing about a paper the student made themselves", () => {
    // No provenance means this was not Jami's idea, however similar it looks
    // once marked -- and completing an unrelated recommendation from it would
    // rest advice on work that was never asked for.
    expect(practiceMissionCompletion(paper({ createdByInterventionId: undefined }))).toBeNull();
    expect(practiceMissionCompletion(paper({ createdByInterventionId: "   " }))).toBeNull();
  });

  it("says nothing about a sitting that answered nothing", () => {
    const blank = paper({
      result: { questionResults: [answer({ attempted: false }), answer({ attempted: false })] },
    });
    expect(practiceMissionCompletion(blank)).toBeNull();
  });

  it("says nothing about a paper that has not been marked yet", () => {
    expect(practiceMissionCompletion(paper({ result: undefined }))).toBeNull();
  });

  it("falls back to the paper's title when it records no coverage", () => {
    const result = practiceMissionCompletion(paper({ coverage: "" }));
    expect(result?.conceptLabel).toBe("Completing the square");
  });

  it("handles nothing at all", () => {
    expect(practiceMissionCompletion(null)).toBeNull();
    expect(practiceMissionCompletion(undefined)).toBeNull();
  });
});
