import { describe, expect, it } from "vitest";
import { examReviewScheme } from "@/lib/practice/exam-review-record";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";

const common = {
  questionId: "q1",
  answer: "",
  acceptableAlternatives: [],
  commonMistakes: [],
} as const;

const point = (id: string, text: string, marks = 1) => ({
  id,
  marks,
  code: "B",
  text,
  dep: [],
  ft: false,
  essentialTerms: [],
  allow: [],
  reject: [],
});

describe("examReviewScheme", () => {
  it("compares a point pool by what it awards, not by every answer it lists", () => {
    const scheme = examReviewScheme({
      ...common,
      maxMarks: 1,
      marking: "pointPool",
      awardable: 1,
      points: [point("p1", "easy to pick"), point("p2", "easier to extract"), point("p3", "does not harm the plant")],
    } as unknown as PracticePaperMarkSchemeItem);
    expect(scheme?.schemeAwards).toBe(1);
    expect(scheme?.points).toHaveLength(3);
    expect(scheme?.awardRule).toMatch(/any 1 of the points/i);
  });

  it("describes a levels question by its top level, where it used to have no criteria", () => {
    const scheme = examReviewScheme({
      ...common,
      maxMarks: 6,
      marking: "banded",
      bands: [
        { id: "L0", label: "Level 0", minMarks: 0, maxMarks: 0, descriptor: "No relevant content." },
        { id: "L1", label: "Level 1", minMarks: 1, maxMarks: 2, descriptor: "Some steps." },
        { id: "L2", label: "Level 2", minMarks: 3, maxMarks: 4, descriptor: "Most steps." },
        { id: "L3", label: "Level 3", minMarks: 5, maxMarks: 6, descriptor: "A valid method." },
      ],
    } as unknown as PracticePaperMarkSchemeItem);
    expect(scheme?.schemeAwards).toBe(6);
    expect(scheme?.levels?.map((level) => level.marks)).toEqual(["0", "1-2", "3-4", "5-6"]);
    expect(scheme?.awardRule).toMatch(/never added together/);
  });

  it("adds an additive scheme up", () => {
    const scheme = examReviewScheme({
      ...common,
      maxMarks: 3,
      marking: "additive",
      points: [point("p1", "substitution"), point("p2", "rearrangement"), point("p3", "answer")],
    } as unknown as PracticePaperMarkSchemeItem);
    expect(scheme?.schemeAwards).toBe(3);
  });

  it("has nothing to describe for a scheme with no points or levels", () => {
    expect(examReviewScheme({ ...common, maxMarks: 2, marking: "additive", points: [] } as unknown as PracticePaperMarkSchemeItem)).toBeNull();
    expect(examReviewScheme({ ...common, maxMarks: 6, marking: "banded", bands: [] } as unknown as PracticePaperMarkSchemeItem)).toBeNull();
  });
});
