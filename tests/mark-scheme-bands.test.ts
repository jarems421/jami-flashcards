import { describe, expect, it } from "vitest";
import { bandsForReferenceScale, parseBandsFromScheme } from "@/lib/evaluation/mark-scheme-bands";
import { schemeCriteria } from "@/lib/practice/mark-schemes";

describe("recovering published bands", () => {
  /** Medly and the exam boards write levels with an explicit mark range. */
  const levels = [
    "LEVEL DESCRIPTORS",
    "",
    "Level 4: Detailed, perceptive analysis (7-8 marks)",
    "• Shows detailed and perceptive understanding",
    "• Selects judicious textual detail",
    "",
    "Level 3: Clear, relevant explanation (5-6 marks)",
    "• Shows clear understanding",
    "",
    "Level 2: Some understanding and comment (3-4 marks)",
    "• Attempts to comment on effect",
    "",
    "Level 1: Simple, limited comment (1-2 marks)",
    "• Simple comment only",
  ].join("\n");

  it("reads levels with their mark ranges, lowest first", () => {
    const bands = parseBandsFromScheme(levels, 8);
    expect(bands).toHaveLength(4);
    expect(bands[0]).toMatchObject({ minMarks: 1, maxMarks: 2 });
    expect(bands[3]).toMatchObject({ minMarks: 7, maxMarks: 8 });
  });

  it("keeps the bullet lines beneath a level as its descriptor", () => {
    const bands = parseBandsFromScheme(levels, 8);
    expect(bands[3].descriptor).toContain("judicious textual detail");
    expect(bands[3].label).toContain("Level 4");
  });

  /** ASAP writes one band per mark. */
  it("reads a score-per-mark rubric", () => {
    const rubric = [
      "SCORE OF 6: Clear and consistent mastery.",
      "SCORE OF 5: Reasonably consistent mastery.",
      "SCORE OF 4: Adequate mastery.",
    ].join("\n");
    const bands = parseBandsFromScheme(rubric, 6);
    expect(bands).toHaveLength(3);
    expect(bands[0]).toMatchObject({ minMarks: 4, maxMarks: 4 });
    expect(bands[2].descriptor).toContain("consistent mastery");
  });

  it("returns nothing for a scheme that is just a reference answer", () => {
    expect(parseBandsFromScheme("To simulate the behaviour of portions of the product.", 5)).toEqual([]);
  });

  /**
   * One band is not a scale. Returning a single band is what produced an
   * empty rubric in the first place, so it is treated as no bands at all.
   */
  it("refuses to call a lone band a scale", () => {
    expect(parseBandsFromScheme("Level 1: Everything (0-8 marks)", 8)).toEqual([]);
  });

  it("ignores bands that do not fit the question's tariff", () => {
    const bands = parseBandsFromScheme("Level 1: Low (1-2 marks)\nLevel 2: High (90-99 marks)", 8);
    expect(bands).toEqual([]);
  });
});

describe("deriving a scale from a reference answer", () => {
  it("gives a small scale one band per mark", () => {
    const bands = bandsForReferenceScale(5);
    expect(bands).toHaveLength(6);
    expect(bands[0]).toMatchObject({ minMarks: 0, maxMarks: 0 });
    expect(bands.at(-1)).toMatchObject({ minMarks: 5, maxMarks: 5 });
  });

  it("quarters a large scale rather than listing every mark", () => {
    const bands = bandsForReferenceScale(40);
    expect(bands).toHaveLength(5);
    expect(bands.at(-1)?.maxMarks).toBe(40);
  });

  it("describes correspondence to the reference, not invented quality", () => {
    const bands = bandsForReferenceScale(5);
    expect(bands[0].descriptor).toContain("Nothing in the response");
    expect(bands.at(-1)?.descriptor).toContain("corresponds fully");
  });

  it("always produces more than one band", () => {
    for (const max of [1, 2, 5, 10, 40]) {
      expect(bandsForReferenceScale(max).length).toBeGreaterThan(1);
    }
  });
});

/**
 * Criterion identity has to come from the scheme, because the two markers'
 * prose is written independently and never matches.
 */
describe("criterion ids from the scheme", () => {
  const common = {
    questionId: "q1",
    maxMarks: 2,
    answer: "",
    acceptableAlternatives: [],
    commonMistakes: [],
  };
  const point = (id: string, text: string) => ({
    id,
    marks: 1,
    code: "B" as const,
    text,
    dep: [],
    ft: false,
    essentialTerms: [],
    allow: [],
    reject: [],
  });

  it("numbers the creditable points", () => {
    const criteria = schemeCriteria({
      ...common,
      marking: "additive",
      points: [point("p1", "Correct method"), point("p2", "Accurate answer")],
    });
    expect(criteria.map((entry) => entry.id)).toEqual(["C1", "C2"]);
    expect(criteria[1].text).toBe("Accurate answer");
  });

  it("numbers weighted traits the same way", () => {
    const criteria = schemeCriteria({
      ...common,
      marking: "weightedTraits",
      traits: [{ id: "t1", label: "Evaluation", maxMarks: 8, bands: [] }],
    });
    expect(criteria).toEqual([{ id: "C1", text: "Evaluation", marks: 8 }]);
  });

  /**
   * A band judges the whole response rather than listing separately awardable
   * criteria, so there is nothing for two markers to line up.
   */
  it("offers no criteria for a banded question", () => {
    expect(
      schemeCriteria({
        ...common,
        marking: "banded",
        bands: [{ id: "b1", label: "Band 1", minMarks: 0, maxMarks: 2, descriptor: "" }],
      })
    ).toEqual([]);
  });
});
