import { describe, expect, it } from "vitest";
import {
  meetsExpectedValue,
  normalizeMarkSchemeItem,
  schemeMarkTotal,
  validateMarkSchemeItem,
  type PracticePaperMarkSchemeItem,
} from "@/lib/practice/mark-schemes";

function parse(value: unknown, marks = 3) {
  return normalizeMarkSchemeItem(value, { id: "q1", marks });
}

function codes(item: PracticePaperMarkSchemeItem | null) {
  return validateMarkSchemeItem(item!).map((issue) => issue.code);
}

function point(overrides: Record<string, unknown> = {}) {
  return { id: "q1.m1", marks: 1, code: "M", text: "Correct method", ...overrides };
}

describe("reading a scheme item", () => {
  it("refuses an item that does not say how it is marked", () => {
    expect(parse({ answer: "42", points: [point()] })).toBeNull();
    expect(parse({ marking: "vibes", points: [point()] })).toBeNull();
  });

  /**
   * Null rather than a coerced shell. A scheme item that cannot be read is a
   * generation failure, and the count check downstream turns that into a repair
   * pass; guessing a shape here would launder bad output into a stored paper.
   */
  it("refuses a non-object rather than inventing an empty scheme", () => {
    expect(parse("additive")).toBeNull();
    expect(parse(null)).toBeNull();
  });

  it("takes the marks from the fixed question, never from the model", () => {
    const item = parse({ marking: "additive", maxMarks: 999, points: [point()] }, 3);
    expect(item?.maxMarks).toBe(3);
  });

  it("drops points with no text and names the ones with no id", () => {
    const item = parse({
      marking: "additive",
      points: [point({ id: "" }), { marks: 1, text: "" }, point({ id: "", text: "Second" })],
    });
    expect(item?.marking).toBe("additive");
    if (item?.marking !== "additive") throw new Error("wrong regime");
    expect(item.points.map((p) => p.text)).toEqual(["Correct method", "Second"]);
    expect(item.points.every((p) => p.id)).toBe(true);
  });

  it("keeps the boards' own modifiers", () => {
    const item = parse({
      marking: "additive",
      points: [
        point({ id: "q1.m1" }),
        point({
          id: "q1.a1",
          code: "a",
          text: "Correct value",
          dep: ["q1.m1"],
          ft: true,
          essentialTerms: ["9.9"],
          allow: ["9.90"],
          reject: ["9"],
        }),
      ],
    });
    if (item?.marking !== "additive") throw new Error("wrong regime");
    expect(item.points[1]).toMatchObject({
      code: "A",
      dep: ["q1.m1"],
      ft: true,
      essentialTerms: ["9.9"],
      allow: ["9.90"],
      reject: ["9"],
    });
  });

  it("orders bands by where they start, however they arrive", () => {
    const item = parse({
      marking: "banded",
      bands: [
        { id: "b3", label: "Level 3", minMarks: 3, maxMarks: 3, descriptor: "Strong" },
        { id: "b1", label: "Level 1", minMarks: 0, maxMarks: 1, descriptor: "Limited" },
        { id: "b2", label: "Level 2", minMarks: 2, maxMarks: 2, descriptor: "Sound" },
      ],
    });
    if (item?.marking !== "banded") throw new Error("wrong regime");
    expect(item.bands.map((band) => band.label)).toEqual(["Level 1", "Level 2", "Level 3"]);
  });
});

describe("additive marking", () => {
  it("accepts points that sum to the question", () => {
    const item = parse({
      marking: "additive",
      points: [point({ id: "a" }), point({ id: "b" }), point({ id: "c" })],
    });
    expect(codes(item)).toEqual([]);
  });

  it("rejects points that do not sum to the question", () => {
    const item = parse({ marking: "additive", points: [point({ id: "a" }), point({ id: "b" })] });
    expect(codes(item)).toContain("marks_do_not_sum");
  });

  it("rejects a dependency on a point in another question", () => {
    const item = parse({
      marking: "additive",
      points: [point({ id: "a" }), point({ id: "b" }), point({ id: "c", dep: ["q7.m1"] })],
    });
    expect(codes(item)).toContain("dangling_dependency");
  });

  /** A method mark cannot rest on the accuracy that follows from it. */
  it("rejects a method mark depending on an accuracy mark", () => {
    const item = parse({
      marking: "additive",
      points: [
        point({ id: "a", code: "M", dep: ["b"] }),
        point({ id: "b", code: "A" }),
        point({ id: "c" }),
      ],
    });
    expect(codes(item)).toContain("inverted_dependency");
  });

  it("rejects a dependency cycle", () => {
    const item = parse({
      marking: "additive",
      points: [
        point({ id: "a", dep: ["b"] }),
        point({ id: "b", dep: ["a"] }),
        point({ id: "c" }),
      ],
    });
    expect(codes(item)).toContain("dependency_cycle");
  });
});

describe("point pool marking", () => {
  const pool = (count: number, awardable: number, marks = 1) => ({
    marking: "pointPool",
    awardable,
    points: Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      marks,
      code: "P",
      text: `Creditworthy point ${index}`,
    })),
  });

  it("accepts any three from a pool of six", () => {
    expect(codes(parse(pool(6, 3)))).toEqual([]);
  });

  /**
   * A pool with nothing to choose between is additive marking wearing a hat,
   * so it is stored as what it is. Real schemes arrive this way constantly --
   * "any one from" written as one point -- and rejecting them held back a
   * quarter of a real paper over a label rather than over its marking.
   */
  it("stores a pool offering everything it holds as additive", () => {
    expect(parse(pool(3, 3))?.marking).toBe("additive");
    expect(codes(parse(pool(3, 3)))).toEqual([]);
  });

  /** The rule still stands for an item that reaches the validator unnormalised. */
  it("rejects a pool offering everything it holds", () => {
    const item = { ...parse(pool(6, 3))!, awardable: 6 } as PracticePaperMarkSchemeItem;
    expect(validateMarkSchemeItem(item).map((issue) => issue.code)).toContain("not_a_pool");
  });

  it("rejects a pool whose points are worth different amounts", () => {
    const uneven = pool(6, 3);
    uneven.points[0].marks = 2;
    expect(codes(parse(uneven))).toContain("uneven_pool");
  });

  it("rejects a pool that cannot reach the question's marks", () => {
    expect(codes(parse(pool(6, 2)))).toContain("pool_does_not_sum");
  });
});

describe("banded marking", () => {
  const banded = (bands: [number, number][]) => ({
    marking: "banded",
    bands: bands.map(([minMarks, maxMarks], index) => ({
      id: `b${index}`,
      label: `Level ${index + 1}`,
      minMarks,
      maxMarks,
      descriptor: "A descriptor.",
    })),
  });

  it("accepts contiguous bands covering the whole scale", () => {
    expect(codes(parse(banded([[0, 1], [2, 3]])))).toEqual([]);
  });

  /**
   * The correction that matters most: a banded question is never subjected to
   * the additive sum gate, because levels marking is not a sum of ticks.
   */
  it("is never asked to sum anything", () => {
    expect(codes(parse(banded([[0, 1], [2, 3]])))).not.toContain("marks_do_not_sum");
  });

  it("rejects a gap between bands", () => {
    expect(codes(parse(banded([[0, 1], [3, 3]])))).toContain("bands_do_not_cover");
  });

  it("rejects overlapping bands", () => {
    expect(codes(parse(banded([[0, 2], [2, 3]])))).toContain("bands_do_not_cover");
  });

  it("rejects bands that stop short of full marks", () => {
    expect(codes(parse(banded([[0, 1], [2, 2]])))).toContain("bands_do_not_cover");
  });

  it("rejects a single band, which decides nothing", () => {
    expect(codes(parse(banded([[0, 3]])))).toContain("bands_do_not_cover");
  });
});

describe("weighted trait marking", () => {
  const trait = (id: string, maxMarks: number) => ({
    id,
    label: id,
    maxMarks,
    bands: [
      { id: `${id}-1`, label: "Lower", minMarks: 0, maxMarks: Math.floor(maxMarks / 2), descriptor: "Limited." },
      {
        id: `${id}-2`,
        label: "Upper",
        minMarks: Math.floor(maxMarks / 2) + 1,
        maxMarks,
        descriptor: "Strong.",
      },
    ],
  });

  it("accepts traits whose marks make up the question", () => {
    const item = parse({ marking: "weightedTraits", traits: [trait("a", 4), trait("b", 6)] }, 10);
    expect(codes(item)).toEqual([]);
  });

  it("rejects traits that do not make up the question", () => {
    const item = parse({ marking: "weightedTraits", traits: [trait("a", 4), trait("b", 4)] }, 10);
    expect(codes(item)).toContain("traits_do_not_sum");
  });

  it("rejects a single trait, which is really a banded question", () => {
    const item = parse({ marking: "weightedTraits", traits: [trait("a", 10)] }, 10);
    expect(codes(item)).toContain("single_trait");
  });

  it("holds each trait's own bands to its own scale", () => {
    const broken = trait("b", 6);
    broken.bands[1].maxMarks = 5;
    const item = parse({ marking: "weightedTraits", traits: [trait("a", 4), broken] }, 10);
    expect(codes(item)).toContain("trait_bands_do_not_cover");
  });
});

describe("competency marking", () => {
  it("accepts criterion-referenced work", () => {
    const item = parse({
      marking: "competency",
      competencies: [
        { id: "c1", text: "Records readings correctly", level: "pass" },
        { id: "c2", text: "Evaluates uncertainty", level: "distinction" },
      ],
    });
    expect(codes(item)).toEqual([]);
  });

  it("rejects an assessment with no criteria", () => {
    expect(codes(parse({ marking: "competency", competencies: [] }))).toContain("no_competencies");
  });

  it("treats an unrecognised level as a pass rather than inventing a grade", () => {
    const item = parse({
      marking: "competency",
      competencies: [{ id: "c1", text: "Does the thing", level: "outstanding" }],
    });
    if (item?.marking !== "competency") throw new Error("wrong regime");
    expect(item.competencies[0].level).toBe("pass");
  });
});

describe("across every regime", () => {
  /** Closes the hole where a scheme passed on a model answer and no criteria. */
  it("rejects a question worth marks that never says how they are earned", () => {
    expect(codes(parse({ marking: "additive", answer: "42", points: [] }))).toContain(
      "no_credit_units"
    );
  });

  it("lets a one-mark question stand on its answer alone", () => {
    const item = normalizeMarkSchemeItem(
      { marking: "additive", answer: "42", points: [] },
      { id: "q1", marks: 1 }
    );
    expect(codes(item)).not.toContain("no_credit_units");
  });
});

describe("expected values", () => {
  const expected = { value: 9.9, tolerance: 0.1 };

  it("accepts a value inside tolerance", () => {
    expect(meetsExpectedValue(expected, 9.85)).toBe(true);
    expect(meetsExpectedValue(expected, 10)).toBe(true);
  });

  it("rejects a value outside tolerance", () => {
    expect(meetsExpectedValue(expected, 9.4)).toBe(false);
  });

  it("rejects a value that is not a number at all", () => {
    expect(meetsExpectedValue(expected, Number.NaN)).toBe(false);
  });

  it("survives an exact-match scheme", () => {
    expect(meetsExpectedValue({ value: 5, tolerance: 0 }, 5)).toBe(true);
    expect(meetsExpectedValue({ value: 5, tolerance: 0 }, 5.01)).toBe(false);
  });

  it("is carried through from the scheme", () => {
    const item = parse({
      marking: "additive",
      points: [
        point({ id: "a", expected: { value: 9.9, tolerance: 0.1, unit: "m/s", significantFigures: 2 } }),
        point({ id: "b" }),
        point({ id: "c" }),
      ],
    });
    if (item?.marking !== "additive") throw new Error("wrong regime");
    expect(item.points[0].expected).toEqual({
      value: 9.9,
      tolerance: 0.1,
      unit: "m/s",
      significantFigures: 2,
    });
  });
});

/*
 * Everything here comes from one real AQA paper, where 15 of 46 questions were
 * held back by schemes that read the page correctly. The model writes what the
 * scheme prints; these fill in what a printed scheme leaves unsaid.
 */
describe("what a printed scheme leaves unsaid", () => {
  const pooled = (marks: number, count: number) => ({
    marking: "pointPool",
    points: Array.from({ length: count }, (_unused, index) => ({
      id: `p${index + 1}`,
      marks: 1,
      code: "P",
      text: `Point ${index + 1}`,
    })),
    ...(marks ? {} : {}),
  });

  it("works out how many of a pool's points may be awarded", () => {
    const item = parse(pooled(2, 3), 2);
    expect(item?.marking).toBe("pointPool");
    expect(item?.marking === "pointPool" ? item.awardable : 0).toBe(2);
    expect(codes(item)).toEqual([]);
  });

  it("keeps a stated count over the inferred one", () => {
    const item = parse({ ...pooled(2, 4), awardable: 3 }, 3);
    expect(item?.marking === "pointPool" ? item.awardable : 0).toBe(3);
  });

  /*
   * "Any one from A / B / C" arrives as a single point holding the
   * alternatives. Stored as a pool it is one that offers everything it has,
   * which is exactly the shape the validator rejects.
   */
  it("stores a one-point pool as the additive question it is", () => {
    const item = parse(pooled(1, 1), 1);
    expect(item?.marking).toBe("additive");
    expect(codes(item)).toEqual([]);
  });

  it("restores the zero band a levels scheme states in prose", () => {
    const item = parse(
      {
        marking: "banded",
        bands: [
          { id: "L1", label: "Level 1", minMarks: 1, maxMarks: 3, descriptor: "Simple statements." },
          { id: "L2", label: "Level 2", minMarks: 4, maxMarks: 6, descriptor: "A detailed account." },
        ],
      },
      6
    );
    expect(item?.marking === "banded" ? item.bands.map((band) => band.minMarks) : []).toEqual([0, 1, 4]);
    expect(codes(item)).toEqual([]);
  });

  it("leaves bands alone when the scheme prints its own zero band", () => {
    const item = parse(
      {
        marking: "banded",
        bands: [
          { id: "L0", label: "Level 0", minMarks: 0, maxMarks: 0, descriptor: "No relevant content." },
          { id: "L1", label: "Level 1", minMarks: 1, maxMarks: 6, descriptor: "An account." },
        ],
      },
      6
    );
    expect(item?.marking === "banded" ? item.bands.length : 0).toBe(2);
  });
});

/*
 * Summing every part of a scheme is right for one regime out of five. It read
 * "the scheme awards 0 marks against a 6-mark question" for every level-marked
 * question on a real paper, and 3 against 2 for every pool.
 */
describe("the marks a scheme awards", () => {
  it("adds up an additive question", () => {
    expect(schemeMarkTotal(parse({ marking: "additive", points: [point(), point({ id: "q1.m2", marks: 2 })] }, 3)!)).toBe(3);
  });

  it("counts a pool by what it offers, not by what it holds", () => {
    const item = parse(
      {
        marking: "pointPool",
        awardable: 2,
        points: [
          { id: "p1", marks: 1, code: "P", text: "One" },
          { id: "p2", marks: 1, code: "P", text: "Two" },
          { id: "p3", marks: 1, code: "P", text: "Three" },
        ],
      },
      2
    );
    expect(schemeMarkTotal(item!)).toBe(2);
  });

  it("counts a banded question by its top band, not by every band added up", () => {
    const item = parse(
      {
        marking: "banded",
        bands: [
          { id: "L1", label: "Level 1", minMarks: 1, maxMarks: 3, descriptor: "Simple." },
          { id: "L2", label: "Level 2", minMarks: 4, maxMarks: 6, descriptor: "Detailed." },
        ],
      },
      6
    );
    expect(schemeMarkTotal(item!)).toBe(6);
  });
});
