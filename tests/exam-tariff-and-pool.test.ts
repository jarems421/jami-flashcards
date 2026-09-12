import { describe, expect, it } from "vitest";
import { readPrintedTariff } from "@/lib/practice/exam-page-regions";
import { normalizeMarkSchemeItem } from "@/lib/practice/mark-schemes";

/**
 * Two ways a sound question was held back, both found on 8300/1H.
 *
 * Neither was the reviewer being strict: one was the tariff reader believing
 * the question's own arithmetic, and the other was a pool of acceptable
 * answers read as a list of required ones.
 */
describe("reading a tariff out of a question's own region", () => {
  /*
   * Question 13(b) reads `f(6) / f(2) is equal to f(3)` and prints
   * `[2 marks]`. Taking the largest bracketed number made its tariff 6, and
   * the question was rejected for disagreeing with a number that was never a
   * tariff at all.
   */
  it("believes the number that says marks over the question's own notation", () => {
    const region = "13 (b) f( x ) = kx 2 Kai says that f(6) f(2) is equal to f(3) because 6 2 = 3 [2 marks]";
    expect(readPrintedTariff(region)).toBe(2);
  });

  it("is not fooled by coordinates either", () => {
    expect(readPrintedTariff("A (1, 3) and B (12, 9) are points on a grid. [3 marks]")).toBe(3);
  });

  /** Edexcel prints a bare `(3)` against the margin and nothing else. */
  it("still reads a bare bracket when nothing says marks", () => {
    expect(readPrintedTariff("18 Work out the value of x. (4)")).toBe(4);
  });

  it("prefers the largest worded tariff when a region holds more than one", () => {
    expect(readPrintedTariff("(a) ... [2 marks] (b) ... [5 marks]")).toBe(5);
  });

  it("reads nothing out of a region with no tariff", () => {
    expect(readPrintedTariff("The Venn diagram represents 100 items.")).toBeNull();
  });
});

function point(id: string, marks: number, dep: string[] = []) {
  return { id, marks, code: "B", text: `Point ${id}`, dep, allow: [], reject: [] };
}

describe("a scheme whose points outrun the question", () => {
  const question = { id: "q9", marks: 2 };

  /*
   * "Make two different criticisms of her sketch" is worth two marks and AQA
   * lists three it will accept. Read as additive that is three marks against a
   * two-mark tariff, and the question was rejected for a scheme that is
   * perfectly sound.
   */
  it("reads three one-mark points on a two-mark question as a pool of two", () => {
    const item = normalizeMarkSchemeItem(
      { marking: "additive", answer: "", points: [point("p1", 1), point("p2", 1), point("p3", 1)] },
      question
    );
    expect(item?.marking).toBe("pointPool");
    expect(item && "awardable" in item ? item.awardable : 0).toBe(2);
  });

  it("leaves a scheme that fits its tariff alone", () => {
    const item = normalizeMarkSchemeItem(
      { marking: "additive", answer: "", points: [point("p1", 1), point("p2", 1)] },
      question
    );
    expect(item?.marking).toBe("additive");
  });

  /*
   * A scheme whose points build on each other cannot be picked from, so a
   * mismatch there is a misread rather than a pool -- and it keeps the
   * mismatch, which holds the question for review.
   */
  it("does not pool points that depend on one another", () => {
    const item = normalizeMarkSchemeItem(
      { marking: "additive", answer: "", points: [point("p1", 1), point("p2", 1), point("p3", 1, ["p1"])] },
      question
    );
    expect(item?.marking).toBe("additive");
  });

  it("does not pool points of differing value, which give no count to recover", () => {
    const item = normalizeMarkSchemeItem(
      { marking: "additive", answer: "", points: [point("p1", 2), point("p2", 1), point("p3", 1)] },
      question
    );
    expect(item?.marking).toBe("additive");
  });

  /** Three two-mark points on a three-mark question divide into no whole pool. */
  it("does not pool when the tariff is not a multiple of a point", () => {
    const item = normalizeMarkSchemeItem(
      { marking: "additive", answer: "", points: [point("p1", 2), point("p2", 2)] },
      { id: "q", marks: 3 }
    );
    expect(item?.marking).toBe("additive");
  });
});
