import { describe, expect, it } from "vitest";
import { checkMarkConsistency } from "@/lib/practice/mark-consistency";
import {
  normalizeMarkSchemeItem,
  validateMarkSchemeItem,
  type PracticePaperMarkSchemeItem,
} from "@/lib/practice/mark-schemes";
import type { PracticePaperCriterionResult } from "@/lib/practice/practice-papers";

/**
 * A two-mark question that accepts three answers, and what it costs to forget
 * the third.
 *
 * 8300/1H question 9 asks for two different criticisms of a sketch and is
 * worth two marks; AQA prints three criticisms it will accept. Extraction was
 * told "for additive marking the points must add up to the question tariff",
 * and the only way to obey that is to drop one. It did, and the result passed
 * every check below it: two points, summing to two, arithmetically perfect and
 * quietly wrong. A student giving the third criticism would have been marked
 * down for an answer the scheme accepts.
 *
 * The criticisms below are paraphrased rather than AQA's printed wording,
 * which is not reproduced here. What the fixture reproduces is the shape that
 * broke -- three equal, independent, creditworthy points against a two-mark
 * tariff -- because the shape is what the extraction lost, and the shape is
 * what every check downstream has to survive.
 */
const CRITICISMS = [
  "The sketch does not pass through the origin.",
  "The sketch is the wrong shape for the given function.",
  "The sketch does not show the curve levelling off.",
];

function point(id: string, text: string, marks = 1, dep: string[] = []) {
  return { id, marks, code: "B", text, dep, allow: [], reject: [] };
}

/** The scheme as printed: every criticism AQA accepts, none dropped to fit. */
function q9Scheme() {
  return normalizeMarkSchemeItem(
    {
      marking: "additive",
      answer: "Any two different valid criticisms of the sketch.",
      points: CRITICISMS.map((text, index) => point(`p${index + 1}`, text)),
    },
    { id: "q9", marks: 2 }
  );
}

function award(criterionId: string, awarded: boolean): PracticePaperCriterionResult {
  return { criterionId, criterion: criterionId, awarded, evidence: "" };
}

/** What the marker reports when the student earned `credited` of the three. */
function report(credited: readonly string[]) {
  return ["C1", "C2", "C3"].map((id) => award(id, credited.includes(id)));
}

function score(item: PracticePaperMarkSchemeItem, credited: readonly string[], reportedMarks: number) {
  return checkMarkConsistency({ item, reportedMarks, criteria: report(credited) });
}

describe("extracting question 9 without losing an answer", () => {
  it("keeps all three criticisms rather than trimming to the tariff", () => {
    const item = q9Scheme();
    expect(item?.marking).toBe("pointPool");
    expect(item && "points" in item ? item.points.map((p) => p.text) : []).toEqual(CRITICISMS);
  });

  it("awards two of them, which is what the question is worth", () => {
    const item = q9Scheme();
    expect(item && "awardable" in item ? item.awardable : 0).toBe(2);
  });

  it("is a scheme the validator has nothing to say about", () => {
    expect(validateMarkSchemeItem(q9Scheme()!)).toEqual([]);
  });
});

describe("marking question 9 against the complete scheme", () => {
  const item = q9Scheme()!;

  it.each([
    ["the first criticism", "C1"],
    ["the second criticism", "C2"],
    ["the third criticism", "C3"],
  ])("credits %s on its own", (_label, id) => {
    expect(score(item, [id], 1)).toMatchObject({ status: "consistent", expected: 1 });
  });

  it.each([
    ["the first and second", ["C1", "C2"]],
    ["the first and third", ["C1", "C3"]],
    ["the second and third", ["C2", "C3"]],
  ])("gives both marks for %s", (_label, ids) => {
    expect(score(item, ids as string[], 2)).toMatchObject({ status: "consistent", expected: 2 });
  });

  /*
   * The case the trimmed scheme could never have marked correctly. Three valid
   * criticisms are worth the cap, not three marks -- the pool is what applies
   * the cap, and a scheme that had already dropped one had nothing to cap.
   */
  it("caps all three criticisms at the two marks published", () => {
    expect(score(item, ["C1", "C2", "C3"], 2)).toMatchObject({ status: "consistent", expected: 2 });
  });

  it("refuses to report three marks for a two-mark question", () => {
    expect(score(item, ["C1", "C2", "C3"], 3)).toMatchObject({
      status: "inconsistent",
      expected: 2,
    });
  });

  it("gives one mark for one valid criticism beside an invalid one", () => {
    expect(score(item, ["C2"], 1)).toMatchObject({ status: "consistent", expected: 1 });
  });

  it("gives nothing for a criticism the scheme does not support", () => {
    expect(score(item, [], 0)).toMatchObject({ status: "consistent", expected: 0 });
  });

  /*
   * The same criticism in different words is one criticism. Identity comes
   * from the scheme, so a marker crediting it twice reports C1 twice -- which
   * cannot be reconciled and must not be quietly added up.
   */
  it("will not add the same criticism up twice because it was reworded", () => {
    const criteria = [award("C1", true), award("C1", true), award("C2", false), award("C3", false)];
    expect(checkMarkConsistency({ item, reportedMarks: 2, criteria })).toMatchObject({
      status: "unverifiable",
    });
  });
});

describe("a mismatch that is not a pool", () => {
  /*
   * Three points that build on one another cannot be picked from, so the
   * mismatch stands rather than being resolved into a pool -- and a standing
   * mismatch is what holds the question back. Publication requires no scheme
   * issues at all, so this is the refusal path for an extraction that is
   * incomplete in a way nothing can repair.
   */
  it("holds the question for review rather than inventing a pool", () => {
    const item = normalizeMarkSchemeItem(
      {
        marking: "additive",
        answer: "",
        points: [point("p1", "Method"), point("p2", "Accuracy", 1, ["p1"]), point("p3", "Conclusion", 1, ["p2"])],
      },
      { id: "q", marks: 2 }
    );
    expect(item?.marking).toBe("additive");
    expect(validateMarkSchemeItem(item!).map((issue) => issue.code)).toContain("marks_do_not_sum");
  });
});
