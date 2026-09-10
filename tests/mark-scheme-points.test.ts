import { describe, expect, it } from "vitest";
import { parsePointsFromScheme } from "@/lib/evaluation/mark-scheme-points";

/**
 * Reading the separate marks a scheme awards, out of its own notation.
 *
 * The corpus adapter used to hand the marker one point worth the whole tariff
 * with every criterion mashed into its text, and that is not a simplification:
 * a two-mark answer with one criterion met can then only be scored 0 or 2, so
 * every partially correct response is wrong by a mark whichever way it goes.
 *
 * It is what the first paid probe measured. Both of its scoring errors were
 * partial-credit answers -- reference 1 of 2, agreed by both examiners -- and
 * the marker returned 0 on one and 2 on the other. Awarding 1 was not
 * available to it.
 */
describe("reading a published scheme's mark points", () => {
  it("splits the two marks of a method-and-accuracy scheme", () => {
    const points = parsePointsFromScheme(
      "M1 for a correct first step in the process, e.g. $-(t^2 - 8t)$.\n\nA1 for $A = 56$ and $B = 4$.",
      2
    );
    expect(points.map((point) => [point.code, point.marks])).toEqual([
      ["M", 1],
      ["A", 1],
    ]);
    expect(points[0]!.text).toContain("correct first step");
  });

  /** A communication mark behaves like an independent one. */
  it("records a communication mark as the independent code the types carry", () => {
    const points = parsePointsFromScheme(
      "C1 for a correct comparison of medians.\n\nC1 for a correct comparison of spread.",
      2
    );
    expect(points.every((point) => point.code === "B")).toBe(true);
    expect(points).toHaveLength(2);
  });

  it("carries a mark worth more than one", () => {
    const points = parsePointsFromScheme("B2 for a fully correct method.\n\nB1 for the answer.", 3);
    expect(points.map((point) => point.marks)).toEqual([2, 1]);
  });

  it("keeps a wrapped line with the mark it belongs to", () => {
    const points = parsePointsFromScheme(
      "M1 for a correct first step,\ne.g. sight of $(t - 4)^2$.\n\nA1 for the answer.",
      2
    );
    expect(points).toHaveLength(2);
    expect(points[0]!.text).toContain("sight of");
  });

  it("reads follow-through from the scheme's own words", () => {
    const points = parsePointsFromScheme(
      "M1 for the method.\n\nA1 ft for the answer, follow through from their value.",
      2
    );
    expect(points[0]!.ft).toBe(false);
    expect(points[1]!.ft).toBe(true);
  });

  /*
   * A structure that does not reconstruct the tariff has been misread, and a
   * misread structure is worse than an honest single point: it would let a
   * marker award marks the question does not have.
   */
  it("refuses a parse that does not add up to the tariff", () => {
    expect(parsePointsFromScheme("M1 for a step.\n\nA1 for the answer.", 5)).toEqual([]);
    expect(parsePointsFromScheme("M1 for a step.\n\nA1 for the answer.", 1)).toEqual([]);
  });

  it("leaves a single-criterion scheme alone", () => {
    expect(parsePointsFromScheme("B1 for 7.", 1)).toEqual([]);
  });

  it("returns nothing for prose with no notation in it", () => {
    expect(parsePointsFromScheme("Award marks for a clear and accurate explanation.", 3)).toEqual([]);
    expect(parsePointsFromScheme("", 3)).toEqual([]);
  });
});
