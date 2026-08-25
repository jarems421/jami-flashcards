import { describe, expect, it } from "vitest";
import { canonicalizeGeneratedMarkSchemeItems } from "@/lib/ai/practice-paper-generation";

describe("practice-paper generation provider normalization", () => {
  it("canonicalizes MiMo mark-scheme aliases without weakening validation", () => {
    expect(canonicalizeGeneratedMarkSchemeItems([{
      id: "q1",
      markingModel: "additive",
      maxMarks: 2,
      answer: "4",
      points: [{
        id: "q1.a1",
        marks: 1,
        code: "A",
        text: "Correct answer",
        dep: "q1.m1",
        ft: null,
        essentialTerms: null,
        allow: "4",
        reject: null,
      }],
    }])).toEqual([expect.objectContaining({
      questionId: "q1",
      marking: "additive",
      points: [expect.objectContaining({
        dep: ["q1.m1"],
        ft: false,
        essentialTerms: [],
        allow: ["4"],
        reject: [],
      })],
    })]);
  });
});
