import { describe, expect, it } from "vitest";
import { compareValues, looksLikeValue } from "@/lib/evaluation/value-comparison";

/**
 * A first attempt at this metric reported that 63% of mismatches were awarded
 * anyway, which would have been a striking finding had almost all of it not
 * been string noise: the same equation written backwards, and labels compared
 * against values. Each case below is one that fooled it.
 */
describe("telling a value from a label", () => {
  it("accepts things carrying mathematics", () => {
    for (const value of ["7", "(4, 3)", "y = 7x - 8", "10x^4 - 3", "-1/2", "5^2 = x/3"]) {
      expect(looksLikeValue(value), value).toBe(true);
    }
  });

  it("rejects a description of the mark", () => {
    for (const label of [
      "midpoint of PQ",
      "calculate the gradient",
      "integrable form",
      "",
      "   ",
    ]) {
      expect(looksLikeValue(label), label).toBe(false);
    }
  });

  /** A digit inside a sentence does not make the sentence a value. */
  it("rejects a label that happens to contain a number", () => {
    expect(looksLikeValue("calculate the gradient of 2 lines")).toBe(false);
  });
});

describe("comparing what the guide wanted with what the candidate wrote", () => {
  it("calls a genuine disagreement a disagreement", () => {
    expect(compareValues("7", "10")).toBe("differ");
    expect(compareValues("y = 7x - 8", "y = 10x - 3")).toBe("differ");
    expect(compareValues("-1", "7")).toBe("differ");
  });

  it("is not fooled by an equation written the other way round", () => {
    expect(compareValues("x/3 = 5^2", "5^2 = x/3")).toBe("match");
    expect(compareValues("x = 75", "75 = x")).toBe("match");
  });

  it("is not fooled by spacing or a different minus sign", () => {
    expect(compareValues("y = 7x - 8", "y=7x−8")).toBe("match");
  });

  /** The scheme states the value; the candidate states the line it sits in. */
  it("accepts a value quoted inside the candidate's own line", () => {
    expect(compareValues("-1", "y = -1")).toBe("match");
    expect(compareValues("log_5(x/3)", "log_5(x/3) = 2")).toBe("match");
  });

  /** A quadratic has two roots and the order they are written in is not part
   * of the answer. */
  it("accepts a solution set written in another order", () => {
    expect(compareValues("x = -3 and x = 1", "x = 1, x = -3")).toBe("match");
    expect(compareValues("p = 2/9, 2", "p = 2, p = 2/9")).toBe("match");
  });

  it("accepts any of the alternatives a scheme offers", () => {
    expect(compareValues("-1/2 or -6/12", "-1/2")).toBe("match");
  });

  /**
   * The failure that mattered most. A marker putting a label in one field and a
   * value in the other has annotated rather than compared, and counting that as
   * a mismatch invents a behaviour that is not there.
   */
  it("refuses to compare a label against a value", () => {
    expect(compareValues("midpoint of PQ", "(4, 3)")).toBe("unknown");
    expect(compareValues("calculate the gradient", "2")).toBe("unknown");
    expect(compareValues("integrable form", "divided by the derivative")).toBe("unknown");
  });
});
