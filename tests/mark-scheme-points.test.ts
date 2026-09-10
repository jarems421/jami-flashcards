import { describe, expect, it } from "vitest";
import {
  parsePointsFromScheme,
  schemeStructureIsReadable,
} from "@/lib/evaluation/mark-scheme-points";

/**
 * Reading the separate marks a scheme awards, out of its own notation.
 *
 * The corpus adapter used to hand the marker one point worth the whole tariff
 * with every criterion mashed into its text, which represents a two-criterion
 * scheme poorly. It does not make a partial award impossible -- see
 * `partial-credit-survives.test.ts`, where 1 of 2 goes through the production
 * pipeline untouched -- so this is a fidelity fix, not a proven cause of the
 * probe's two wrong marks.
 *
 * Reconstructing the tariff is necessary and not sufficient. A pool, a cap or
 * a stated dependency all mean something the line-by-line reading cannot
 * carry, so those schemes are left whole and labelled unstructured rather than
 * claimed as complete structure with a rule quietly dropped.
 */
const NEWLINE = "\n";
const lines = (...parts: string[]) => parts.join(NEWLINE);

describe("reading a published scheme's mark points", () => {
  it("splits the two marks of a method-and-accuracy scheme", () => {
    const points = parsePointsFromScheme(
      lines("M1 for a correct first step in the process.", "", "A1 for $A = 56$ and $B = 4$."),
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
      lines("C1 for a correct comparison of medians.", "", "C1 for a correct comparison of spread."),
      2
    );
    expect(points.every((point) => point.code === "B")).toBe(true);
    expect(points).toHaveLength(2);
  });

  it("carries a mark worth more than one", () => {
    const points = parsePointsFromScheme(
      lines("B2 for a fully correct method.", "", "B1 for the answer."),
      3
    );
    expect(points.map((point) => point.marks)).toEqual([2, 1]);
  });

  it("keeps a wrapped line with the mark it belongs to", () => {
    const points = parsePointsFromScheme(
      lines("M1 for a correct first step,", "e.g. sight of $(t - 4)^2$.", "", "A1 for the answer."),
      2
    );
    expect(points).toHaveLength(2);
    expect(points[0]!.text).toContain("sight of");
  });

  it("reads follow-through from the scheme's own words", () => {
    const points = parsePointsFromScheme(
      lines("M1 for the method.", "", "A1 ft for the answer, follow through from their value."),
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
    const scheme = lines("M1 for a step.", "", "A1 for the answer.");
    expect(parsePointsFromScheme(scheme, 5)).toEqual([]);
    expect(parsePointsFromScheme(scheme, 1)).toEqual([]);
  });

  it("leaves a single-criterion scheme alone", () => {
    expect(parsePointsFromScheme("B1 for 7.", 1)).toEqual([]);
  });

  it("returns nothing for prose with no notation in it", () => {
    expect(parsePointsFromScheme("Award marks for a clear and accurate explanation.", 3)).toEqual([]);
    expect(parsePointsFromScheme("", 3)).toEqual([]);
  });

  /*
   * Two marks written with the same code are two marks. The probe's median
   * question states C1 twice, and reading them as one criterion would put the
   * scheme back where it started.
   */
  it("treats a repeated code as two distinct criteria", () => {
    const points = parsePointsFromScheme(
      lines("C1 for comparing the medians.", "", "C1 for comparing the spread."),
      2
    );
    expect(points).toHaveLength(2);
    expect(points[0]!.id).not.toBe(points[1]!.id);
    expect(points[0]!.text).not.toEqual(points[1]!.text);
  });

  /*
   * Precaution, not a fix for anything observed: no scheme in the corpus
   * contains an alternative route. The reasoning first given for this -- that
   * two alternative one-mark routes sum to a one-mark tariff -- was wrong
   * arithmetic; they sum to two and the tariff check already rejects them.
   * Detecting the phrase is cheap and is not evidence that every alternative
   * form is recognised.
   */
  it("refuses a scheme offering alternative routes", () => {
    const scheme = lines("M1 for completing the square.", "", "OR", "", "M1 for differentiating.");
    expect(schemeStructureIsReadable(scheme)).toBe(false);
    expect(parsePointsFromScheme(scheme, 1)).toEqual([]);
    expect(
      parsePointsFromScheme(lines("B1 for one route.", "Alternatively:", "B1 for another."), 1)
    ).toEqual([]);
  });

  it("refuses a pool or an award cap", () => {
    expect(
      parsePointsFromScheme(
        lines("B1 for each valid reason, any two from the list below.", "", "B1 more."),
        2
      )
    ).toEqual([]);
    expect(
      parsePointsFromScheme(
        lines("B1 for a reason.", "", "B1 for another.", "", "Maximum 2 marks."),
        2
      )
    ).toEqual([]);
    expect(schemeStructureIsReadable("Award up to 3 marks for the explanation.")).toBe(false);
  });

  /*
   * A code inside an example is part of that mark's wording, not the start of
   * a new one -- only a line that begins with a code opens a mark.
   */
  it("ignores a code that appears inside a mark's own text", () => {
    const points = parsePointsFromScheme(
      lines("M1 for a correct method; do not award A1 here if the answer is wrong.", "", "A1 for 56."),
      2
    );
    expect(points).toHaveLength(2);
    expect(points[0]!.code).toBe("M");
    expect(points[0]!.text).toContain("do not award A1");
  });

  /*
   * Leaving `dep` empty avoids inventing a dependency and instead asserts
   * there is none, which is a different falsehood. A scheme that states one is
   * not claimed as structured at all -- one of the corpus's own maths schemes
   * writes `M1dep` and "Dependent on previous M1".
   */
  it("refuses a scheme that states a dependency it cannot represent", () => {
    expect(schemeStructureIsReadable(lines("M1 for the setup.", "M1dep for isolating r."))).toBe(false);
    expect(
      schemeStructureIsReadable(lines("M1 for a method.", "A1 dependent on the previous M1."))
    ).toBe(false);
    expect(parsePointsFromScheme(lines("M1 for a method.", "", "A1 dep for the answer."), 2)).toEqual([]);
  });

  /*
   * Acceptance rules are not dependencies. "or equivalent" and "correct answer
   * only" travel with the mark's own wording into the criterion text, so the
   * marker still sees them -- and an earlier draft that lumped them in with
   * `dep` would have discarded a readable three-mark scheme over an "oe".
   */
  it("keeps a scheme whose only extra notation is an acceptance rule", () => {
    const points = parsePointsFromScheme(
      lines("P1 for the multiplier.", "", "P1 for the overall multiplier.", "", "A1 for $25/36$ oe"),
      3
    );
    expect(points).toHaveLength(3);
    expect(points[2]!.text).toContain("oe");
    expect(schemeStructureIsReadable("A1 for 9.77 cao.")).toBe(true);
  });

  it("leaves dependencies empty on the schemes it does accept", () => {
    const points = parsePointsFromScheme(lines("M1 for the method.", "", "A1 for the answer."), 2);
    expect(points.every((point) => point.dep.length === 0)).toBe(true);
  });
});
