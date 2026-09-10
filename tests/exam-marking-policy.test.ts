import { describe, expect, it } from "vitest";
import { examMarkingNeedsVerification } from "@/lib/practice/exam-marking-policy";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";

/**
 * The rule that decides whether a student's answer is marked once or twice.
 *
 * It lives apart from the route so an evaluation can apply the same rule. The
 * corpus evaluator ran the whole-paper ensemble -- two blind markers on every
 * question plus a juror -- while describing itself as the path a student's
 * submission takes, which stopped being true when single-question marking
 * became adaptive. A quality figure measured that way flatters the product by
 * an ensemble the student is never given.
 */
function scheme(overrides: Partial<PracticePaperMarkSchemeItem> = {}): PracticePaperMarkSchemeItem {
  return {
    questionId: "q1",
    maxMarks: 3,
    marking: "additive",
    answer: "",
    acceptableAlternatives: [],
    commonMistakes: [],
    points: [
      { id: "m1", marks: 1, code: "M", text: "Method", dep: [], ft: false, essentialTerms: [], allow: [], reject: [] },
    ],
    ...overrides,
  } as PracticePaperMarkSchemeItem;
}

describe("when one marker is not enough", () => {
  it("marks a small recall question once", () => {
    expect(examMarkingNeedsVerification(scheme(), 2, false)).toBe(false);
  });

  it("buys a second marker for a high tariff", () => {
    expect(examMarkingNeedsVerification(scheme(), 6, false)).toBe(true);
  });

  it("buys a second marker for every judgement-based regime", () => {
    for (const marking of ["banded", "weightedTraits", "competency"] as const) {
      expect(examMarkingNeedsVerification(scheme({ marking } as never), 2, false)).toBe(true);
    }
  });

  /** Handwriting is the other thing a second reader is genuinely good at. */
  it("buys a second marker for handwriting once the tariff is worth it", () => {
    expect(examMarkingNeedsVerification(scheme(), 4, true)).toBe(true);
    expect(examMarkingNeedsVerification(scheme(), 3, true)).toBe(false);
  });

  it("buys a second marker when marks depend on each other or follow through", () => {
    const dependent = scheme({
      points: [
        { id: "m1", marks: 1, code: "M", text: "Method", dep: [], ft: false, essentialTerms: [], allow: [], reject: [] },
        { id: "a1", marks: 1, code: "A", text: "Accuracy", dep: ["m1"], ft: false, essentialTerms: [], allow: [], reject: [] },
      ],
    } as never);
    expect(examMarkingNeedsVerification(dependent, 2, false)).toBe(true);

    const followThrough = scheme({
      points: [
        { id: "m1", marks: 1, code: "M", text: "Method", dep: [], ft: true, essentialTerms: [], allow: [], reject: [] },
      ],
    } as never);
    expect(examMarkingNeedsVerification(followThrough, 2, false)).toBe(true);
  });
});
