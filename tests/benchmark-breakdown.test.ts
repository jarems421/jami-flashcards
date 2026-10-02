import { describe, expect, it } from "vitest";

import {
  MIN_REPORTABLE,
  breakdownBy,
  breakdownRow,
  examinerCeiling,
  meanInterval,
  wilsonInterval,
} from "@/lib/evaluation/benchmark-breakdown";
import type { MarkOutcome } from "@/lib/evaluation/scoring";

const outcome = (candidate: number, human: number, maxMarks: number, subject = "maths"): MarkOutcome => ({
  recordId: `r${Math.random()}`,
  sourceId: "gcse-board-exemplars",
  level: "gcse",
  subject,
  regime: "additive",
  questionId: "q",
  maxMarks,
  humanMarks: [human],
  candidate,
  perMarkerError: [Math.abs(candidate - human)],
  consensusError: Math.abs(candidate - human),
  normalisedConsensusError: Math.abs(candidate - human) / maxMarks,
  exactAgainstAny: candidate === human,
  exactAgainstAll: candidate === human,
  withinOneOfAny: Math.abs(candidate - human) <= 1,
  humanSpread: null,
  insideHumanInterval: null,
  intervalError: null,
  withinHumanVariation: null,
  criterion: null,
});

describe("wilsonInterval", () => {
  it("stays inside 0..1 and is wide on small samples", () => {
    const small = wilsonInterval(5, 5)!;
    expect(small.high).toBe(1);
    expect(small.low).toBeGreaterThan(0.5);
    expect(small.low).toBeLessThan(0.6);
    const large = wilsonInterval(500, 500)!;
    expect(large.low).toBeGreaterThan(0.99);
  });

  it("matches the textbook value for 8 of 10", () => {
    const interval = wilsonInterval(8, 10)!;
    expect(interval.low).toBeCloseTo(0.49, 2);
    expect(interval.high).toBeCloseTo(0.943, 2);
  });

  it("has nothing to say about an empty cell", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(meanInterval([1])).toBeNull();
  });
});

describe("breakdownRow", () => {
  it("measures agreement against the marks available, not the answers", () => {
    // One 10-mark answer two marks off, one 2-mark answer exact.
    const row = breakdownRow("all", [outcome(8, 10, 10), outcome(2, 2, 2)]);
    expect(row.markAgreement).toBeCloseTo(1 - 2 / 12);
    expect(row.exact).toBe(0.5);
    expect(row.withinOne).toBe(0.5);
    expect(row.bias).toBe(-1);
  });

  it("signs generosity positive", () => {
    const row = breakdownRow("all", [outcome(3, 2, 4), outcome(4, 3, 4)]);
    expect(row.bias).toBe(1);
  });

  it("refuses to call a cell below the reporting floor", () => {
    const few = Array.from({ length: MIN_REPORTABLE - 1 }, () => outcome(1, 1, 2));
    expect(breakdownRow("few", few).reportable).toBe(false);
    expect(breakdownRow("enough", [...few, outcome(1, 1, 2)]).reportable).toBe(true);
  });
});

describe("examinerCeiling", () => {
  it("scores the second examiner against the first, as the marker is scored", () => {
    const row = examinerCeiling("two examiners", [
      { firstMark: 6, secondMark: 6, maxMarks: 9 },
      { firstMark: 4, secondMark: 6, maxMarks: 9 },
    ]);
    expect(row.exact).toBe(0.5);
    expect(row.withinOne).toBe(0.5);
    expect(row.markAgreement).toBeCloseTo(1 - 2 / 18);
    expect(row.bias).toBe(1);
  });
});

describe("breakdownBy", () => {
  it("splits by facet, largest cell first, and skips records with no facet", () => {
    const rows = breakdownBy(
      [outcome(1, 1, 2, "maths"), outcome(1, 1, 2, "maths"), outcome(1, 0, 2, "history"), outcome(1, 1, 2, "none")],
      (o) => (o.subject === "none" ? null : o.subject)
    );
    expect(rows.map((row) => [row.key, row.answers])).toEqual([
      ["maths", 2],
      ["history", 1],
    ]);
  });
});
