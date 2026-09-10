import { describe, expect, it } from "vitest";
import { checkMarkConsistency } from "@/lib/practice/mark-consistency";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import type { PracticePaperCriterionResult } from "@/lib/practice/practice-papers";

/**
 * A mark has to agree with the reasons printed beside it.
 *
 * A marker returns a question total and a set of criterion decisions, and
 * nothing reconciled them: a result saying "1 mark" above criteria awarding 2
 * went through the parser untouched and reached the student as a score its own
 * feedback argued against. Neither number is obviously the wrong one, which is
 * what makes it worse than a plain error.
 *
 * Summing is the right arithmetic for exactly one regime. Adding a banded
 * question's descriptors together produces a number the scheme never
 * contemplated, and a pool has a cap that summing ignores.
 */
const common = { questionId: "q1", answer: "", acceptableAlternatives: [], commonMistakes: [] };

function point(id: string, marks: number) {
  return { id, marks, code: "B" as const, text: id, dep: [], ft: false, essentialTerms: [], allow: [], reject: [] };
}

function criterion(id: string, awardedMarks: number, awarded = awardedMarks > 0) {
  return { criterionId: id, criterion: id, awarded, awardedMarks, evidence: "seen" } as PracticePaperCriterionResult;
}

describe("additive marking", () => {
  const item = {
    ...common,
    maxMarks: 3,
    marking: "additive",
    points: [point("m1", 1), point("m2", 2)],
  } as PracticePaperMarkSchemeItem;

  it("accepts a total that equals its criterion awards", () => {
    expect(
      checkMarkConsistency({ item, reportedMarks: 3, criteria: [criterion("C1", 1), criterion("C2", 2)] })
    ).toMatchObject({ status: "consistent" });
  });

  it("refuses a total its criteria do not add up to", () => {
    const result = checkMarkConsistency({
      item,
      reportedMarks: 1,
      criteria: [criterion("C1", 1), criterion("C2", 2)],
    });
    expect(result.status).toBe("inconsistent");
    expect(result).toMatchObject({ expected: 3 });
  });

  /** A boolean is exact on a one-mark criterion and silent on a larger one. */
  it("reads a one-mark criterion from its verdict alone", () => {
    const single = { ...common, maxMarks: 1, marking: "additive", points: [point("m1", 1)] } as PracticePaperMarkSchemeItem;
    const verdictOnly = { criterionId: "C1", criterion: "C1", awarded: true, evidence: "x" } as PracticePaperCriterionResult;
    expect(checkMarkConsistency({ item: single, reportedMarks: 1, criteria: [verdictOnly] })).toMatchObject({
      status: "consistent",
    });
  });

  it("cannot verify a multi-mark criterion credited by verdict alone", () => {
    const verdictOnly = { criterionId: "C2", criterion: "C2", awarded: true, evidence: "x" } as PracticePaperCriterionResult;
    expect(
      checkMarkConsistency({ item, reportedMarks: 3, criteria: [criterion("C1", 1), verdictOnly] }).status
    ).toBe("unverifiable");
  });

  /*
   * Silence is not agreement. A report with no criteria to reconcile is the
   * one showing its working least, and passing it as consistent would bless
   * exactly that.
   */
  it("cannot verify a report that names no criteria", () => {
    expect(checkMarkConsistency({ item, reportedMarks: 3, criteria: [] }).status).toBe("unverifiable");
  });

  it("cannot verify when a scheme criterion is missing from the report", () => {
    expect(
      checkMarkConsistency({ item, reportedMarks: 1, criteria: [criterion("C1", 1)] }).status
    ).toBe("unverifiable");
  });
});

describe("point pools", () => {
  const item = {
    ...common,
    maxMarks: 2,
    marking: "pointPool",
    awardable: 2,
    points: [point("p1", 1), point("p2", 1), point("p3", 1), point("p4", 1)],
  } as PracticePaperMarkSchemeItem;

  it("accepts awards within the pool's cap", () => {
    expect(
      checkMarkConsistency({
        item,
        reportedMarks: 2,
        criteria: [criterion("C1", 1), criterion("C2", 1), criterion("C3", 0), criterion("C4", 0)],
      })
    ).toMatchObject({ status: "consistent" });
  });

  /*
   * The case summing gets wrong. Four points ticked on a pool that credits two
   * is two marks, not four, and reporting four is the pool's cap ignored.
   */
  it("applies the cap rather than summing every tick", () => {
    const result = checkMarkConsistency({
      item,
      reportedMarks: 4,
      criteria: [criterion("C1", 1), criterion("C2", 1), criterion("C3", 1), criterion("C4", 1)],
    });
    expect(result).toMatchObject({ status: "inconsistent", expected: 2 });
  });
});

describe("banded marking", () => {
  const item = {
    ...common,
    maxMarks: 6,
    marking: "banded",
    bands: [
      { id: "L0", label: "Level 0", minMarks: 0, maxMarks: 0, descriptor: "No relevant content." },
      { id: "L1", label: "Level 1", minMarks: 1, maxMarks: 3, descriptor: "Simple." },
      { id: "L2", label: "Level 2", minMarks: 4, maxMarks: 6, descriptor: "Detailed." },
    ],
  } as PracticePaperMarkSchemeItem;

  it("accepts a mark inside a band the scheme defines", () => {
    expect(checkMarkConsistency({ item, reportedMarks: 5, criteria: [] })).toMatchObject({
      status: "consistent",
    });
  });

  it("refuses a mark that falls in no band", () => {
    expect(checkMarkConsistency({ item, reportedMarks: 7, criteria: [] }).status).toBe("inconsistent");
  });

  /** Descriptors are not marks, so they are never added together. */
  it("does not sum the bands", () => {
    const result = checkMarkConsistency({ item, reportedMarks: 6, criteria: [] });
    expect(result).toMatchObject({ status: "consistent", expected: 6 });
  });

  /*
   * The limit of this check, recorded so no report can overstate it. Passing
   * means the mark sits in a band the scheme defines. Whether it is the right
   * band is a judgement about the response, and no arithmetic reaches it: a
   * one-mark answer placed in Level 1 and a three-mark answer placed in Level 1
   * are indistinguishable here.
   */
  it("checks bounds only, and says so rather than claiming validation", () => {
    const result = checkMarkConsistency({ item, reportedMarks: 1, criteria: [] });
    expect(result).toMatchObject({ status: "consistent", checked: "bounds" });
    expect(checkMarkConsistency({ item, reportedMarks: 3, criteria: [] })).toMatchObject({
      checked: "bounds",
    });
  });
});

describe("weighted traits", () => {
  const item = {
    ...common,
    maxMarks: 20,
    marking: "weightedTraits",
    traits: [
      { id: "t1", label: "Knowledge", maxMarks: 12, bands: [] },
      { id: "t2", label: "Evaluation", maxMarks: 8, bands: [] },
    ],
  } as PracticePaperMarkSchemeItem;

  it("combines the traits by their own maxima", () => {
    expect(
      checkMarkConsistency({ item, reportedMarks: 14, criteria: [criterion("C1", 9), criterion("C2", 5)] })
    ).toMatchObject({ status: "consistent", expected: 14 });
  });

  it("refuses a total the traits do not combine to", () => {
    expect(
      checkMarkConsistency({ item, reportedMarks: 20, criteria: [criterion("C1", 9), criterion("C2", 5)] })
    ).toMatchObject({ status: "inconsistent", expected: 14 });
  });
});

describe("competency schemes", () => {
  const item = {
    ...common,
    maxMarks: 3,
    marking: "competency",
    competencies: [{ id: "c1", text: "Met the standard", level: "pass" as const }],
  } as PracticePaperMarkSchemeItem;

  it("has no arithmetic to check, and says so", () => {
    expect(checkMarkConsistency({ item, reportedMarks: 2, criteria: [] }).status).toBe("unverifiable");
  });

  it("still refuses a mark beyond the tariff", () => {
    expect(checkMarkConsistency({ item, reportedMarks: 4, criteria: [] }).status).toBe("inconsistent");
  });

  /*
   * Within the tariff it is unverifiable, not consistent. Whether the
   * competency rules were applied correctly is untouched by any check here,
   * and reporting a pass would say otherwise.
   */
  it("never reports a competency mark as consistent", () => {
    for (const reportedMarks of [0, 1, 2, 3]) {
      expect(checkMarkConsistency({ item, reportedMarks, criteria: [] }).status).toBe("unverifiable");
    }
  });
});
