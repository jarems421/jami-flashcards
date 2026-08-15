import { describe, expect, it } from "vitest";
import {
  markDistribution,
  quadraticWeightedKappa,
  summariseAgreement,
  type MarkPair,
} from "@/lib/evaluation/agreement";

function pairs(
  values: readonly [number, number][],
  maxMarks: number,
  questionId = "q1"
): MarkPair[] {
  return values.map(([reference, candidate]) => ({
    questionId,
    maxMarks,
    reference,
    candidate,
  }));
}

describe("quadratic weighted kappa", () => {
  it("is 1 when two markers agree exactly", () => {
    expect(
      quadraticWeightedKappa(pairs([[0, 0], [1, 1], [2, 2]], 2), 2)
    ).toBe(1);
  });

  /**
   * Every cell of the confusion matrix equally filled is precisely chance
   * agreement, so observed and expected disagreement cancel.
   */
  it("is 0 for chance agreement", () => {
    expect(
      quadraticWeightedKappa(pairs([[0, 0], [0, 1], [1, 0], [1, 1]], 1), 1)
    ).toBe(0);
  });

  it("goes negative when the markers systematically invert each other", () => {
    expect(quadraticWeightedKappa(pairs([[0, 1], [1, 0]], 1), 1)).toBe(-1);
  });

  it("punishes being badly wrong far more than being slightly wrong", () => {
    const slightly = quadraticWeightedKappa(
      pairs([[0, 0], [2, 3], [5, 5]], 5),
      5
    );
    const badly = quadraticWeightedKappa(
      pairs([[0, 0], [2, 5], [5, 5]], 5),
      5
    );
    expect(slightly).not.toBeNull();
    expect(badly).not.toBeNull();
    expect(badly!).toBeLessThan(slightly!);
  });

  it("declines to score a sample that cannot support one", () => {
    // One pair, and a set where nobody varies, are both undefined rather than
    // perfect: there is no disagreement to be better than.
    expect(quadraticWeightedKappa(pairs([[3, 3]], 5), 5)).toBeNull();
    expect(
      quadraticWeightedKappa(pairs([[4, 4], [4, 4], [4, 4]], 5), 5)
    ).toBeNull();
  });

  it("treats out-of-range marks as the nearest point on the scale", () => {
    expect(
      quadraticWeightedKappa(pairs([[0, -3], [2, 99]], 2), 2)
    ).toBe(quadraticWeightedKappa(pairs([[0, 0], [2, 2]], 2), 2));
  });
});

/**
 * Real schemes award halves. Rounding them away turns a two-mark question's
 * five-point scale into a three-point one, discarding exactly the partial
 * credit this system exists to measure.
 */
describe("half-mark scales", () => {
  const halves = (values: readonly [number, number][]): MarkPair[] =>
    values.map(([reference, candidate]) => ({
      questionId: "q21",
      maxMarks: 2,
      step: 0.5,
      reference,
      candidate,
    }));

  it("does not round a half mark into agreement", () => {
    const summary = summariseAgreement(halves([[1.5, 1.5], [0.5, 1]]));
    expect(summary.exact).toBe(0.5);
    expect(summary.meanAbsoluteError).toBe(0.25);
  });

  it("counts one half-mark step as adjacent, not one whole mark", () => {
    expect(summariseAgreement(halves([[1, 1.5], [1, 1.5]])).adjacent).toBe(1);
    expect(summariseAgreement(halves([[0.5, 1.5], [0.5, 1.5]])).adjacent).toBe(0);
  });

  it("scores a half-mark scale as five points rather than three", () => {
    // Marking every 1.5 as a 1 is real disagreement on a half-mark scale, and
    // vanishes entirely if the scale is rounded to whole marks first.
    const kappa = quadraticWeightedKappa(
      halves([[0, 0], [1.5, 1], [2, 2], [0.5, 0.5]]),
      2
    );
    expect(kappa).not.toBeNull();
    expect(kappa!).toBeLessThan(1);
  });

  it("still treats a whole-mark question as whole marks", () => {
    const summary = summariseAgreement(pairs([[3, 4]], 5));
    expect(summary.adjacent).toBe(1);
    expect(summary.meanAbsoluteError).toBe(1);
  });
});

describe("agreement summary", () => {
  /**
   * The reason kappa is computed per question: a three-mark question and a
   * twenty-mark question do not share a scale, and pooling them into one
   * confusion matrix invents one that neither uses.
   */
  it("keeps questions on their own scales rather than pooling marks", () => {
    const mixed = [
      ...pairs([[0, 0], [3, 3]], 3, "short"),
      ...pairs([[0, 0], [20, 20]], 20, "long"),
    ];
    expect(summariseAgreement(mixed).kappa).toBe(1);
  });

  it("reports exact and adjacent agreement over every pair", () => {
    const summary = summariseAgreement(pairs([[3, 3], [3, 4], [3, 5]], 5));
    expect(summary.exact).toBeCloseTo(1 / 3);
    expect(summary.adjacent).toBeCloseTo(2 / 3);
    expect(summary.count).toBe(3);
  });

  it("signs the bias so leniency is visible as a direction", () => {
    expect(summariseAgreement(pairs([[2, 3], [2, 3]], 5)).bias).toBe(1);
    expect(summariseAgreement(pairs([[3, 2], [3, 2]], 5)).bias).toBe(-1);
    expect(summariseAgreement(pairs([[2, 3], [3, 2]], 5)).bias).toBe(0);
  });

  it("separates mean absolute error from bias, which cancels", () => {
    const summary = summariseAgreement(pairs([[2, 4], [4, 2]], 5));
    expect(summary.bias).toBe(0);
    expect(summary.meanAbsoluteError).toBe(2);
  });

  it("has an answer for an empty sample", () => {
    expect(summariseAgreement([])).toMatchObject({ kappa: null, count: 0 });
  });
});

describe("mark distribution", () => {
  /**
   * The shape that exposes central tendency: a marker avoiding the ends of the
   * scale looks fine on average and wrong here.
   */
  it("shows a marker clustering in the middle of the scale", () => {
    const clustered = summariseAgreement(
      pairs([[0, 5], [10, 5], [0, 6], [10, 4]], 10)
    );
    expect(clustered.bias).toBe(0);

    const reference = markDistribution(
      pairs([[0, 5], [10, 5], [0, 6], [10, 4]], 10),
      "reference"
    );
    const candidate = markDistribution(
      pairs([[0, 5], [10, 5], [0, 6], [10, 4]], 10),
      "candidate"
    );
    // The reference marks sit entirely at the two ends; the candidate's sit
    // entirely in the middle, having never once used the top or bottom band.
    expect(reference[0]).toBe(0.5);
    expect(reference[4]).toBe(0.5);
    expect(candidate[0] + candidate[4]).toBe(0);
    expect(candidate[2] + candidate[3]).toBe(1);
  });

  it("puts full marks in the top band rather than off the end", () => {
    expect(markDistribution(pairs([[5, 5]], 5), "candidate")[4]).toBe(1);
  });
});
