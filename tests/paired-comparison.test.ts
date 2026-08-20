import { describe, expect, it } from "vitest";
import type { MarkOutcome } from "@/lib/evaluation/scoring";
import {
  countDirection,
  countDiscordant,
  mcnemarExact,
  pairCriterionCalls,
} from "@/lib/evaluation/paired-comparison";

const outcome = (
  recordId: string,
  entries: { id: string; human: boolean; jami: boolean | null }[]
): MarkOutcome =>
  ({
    recordId,
    sourceId: "qs",
    level: "alevel",
    subject: "maths",
    regime: "additive",
    questionId: "q1",
    maxMarks: entries.length,
    humanMarks: [entries.filter((call) => call.human).length],
    candidate: entries.filter((call) => call.jami).length,
    perMarkerError: [0],
    consensusError: 0,
    normalisedConsensusError: 0,
    exactAgainstAny: true,
    exactAgainstAll: true,
    withinOneOfAny: true,
    humanSpread: null,
    insideHumanInterval: null,
    intervalError: null,
    withinHumanVariation: null,
    criterion: {
      compared: entries.filter((call) => call.jami !== null).length,
      agreed: entries.filter((call) => call.jami === call.human).length,
      missed: entries.filter((call) => call.jami === null).length,
      extra: 0,
      rightForTheRightReasons: false,
      markGap: null,
      // One-mark criteria, which is what every source but the coursework
      // assignments publishes.
      calls: entries.map((call) => ({
        ...call,
        available: 1,
        humanMarks: call.human ? 1 : 0,
        jamiMarks: call.jami === null ? null : call.jami ? 1 : 0,
      })),
    },
  }) as MarkOutcome;

describe("pairing two runs over the same marks", () => {
  it("lines each mark up with itself across the runs", () => {
    const before = [outcome("r1", [{ id: "Mark 1", human: true, jami: false }])];
    const after = [outcome("r1", [{ id: "Mark 1", human: true, jami: true }])];
    expect(pairCriterionCalls(before, after)).toEqual([
      {
        recordId: "r1",
        criterionId: "Mark 1",
        human: true,
        beforeAgreed: false,
        afterAgreed: true,
      },
    ]);
  });

  /**
   * A record one run could not mark at all is a gap in coverage. Scoring it as
   * a disagreement would make an outage look like a regression.
   */
  it("drops marks only one run ruled on", () => {
    const before = [outcome("r1", [{ id: "Mark 1", human: true, jami: true }])];
    const after = [
      outcome("r1", [{ id: "Mark 1", human: true, jami: true }]),
      outcome("r2", [{ id: "Mark 1", human: true, jami: true }]),
    ];
    expect(pairCriterionCalls(before, after)).toHaveLength(1);
  });

  it("treats a mark the run never addressed as a disagreement", () => {
    const before = [outcome("r1", [{ id: "Mark 1", human: true, jami: null }])];
    const after = [outcome("r1", [{ id: "Mark 1", human: true, jami: true }])];
    expect(pairCriterionCalls(before, after)[0]).toMatchObject({
      beforeAgreed: false,
      afterAgreed: true,
    });
  });

  it("counts the four cells a paired comparison rests on", () => {
    const counts = countDiscordant([
      { recordId: "r", criterionId: "1", human: true, beforeAgreed: true, afterAgreed: true },
      { recordId: "r", criterionId: "2", human: true, beforeAgreed: true, afterAgreed: false },
      { recordId: "r", criterionId: "3", human: true, beforeAgreed: false, afterAgreed: true },
      { recordId: "r", criterionId: "4", human: true, beforeAgreed: false, afterAgreed: true },
      { recordId: "r", criterionId: "5", human: true, beforeAgreed: false, afterAgreed: false },
    ]);
    expect(counts).toEqual({
      agreedBoth: 1,
      onlyBefore: 1,
      onlyAfter: 2,
      agreedNeither: 1,
    });
  });
});

describe("the exact test", () => {
  /** An even split is exactly what a change that did nothing would produce. */
  it("finds nothing in a symmetric split", () => {
    expect(mcnemarExact(10, 10).pValue).toBe(1);
  });

  it("returns nothing to test when no mark changed its mind", () => {
    expect(mcnemarExact(0, 0)).toEqual({ discordant: 0, pValue: 1 });
  });

  /**
   * Known value: with 23 discordant marks split 3/20, the exact two-sided
   * binomial is about 0.0005 — a split that lopsided is not chance.
   */
  it("matches the binomial on a lopsided split", () => {
    const { discordant, pValue } = mcnemarExact(3, 20);
    expect(discordant).toBe(23);
    expect(pValue).toBeCloseTo(0.0005, 4);
  });

  it("is symmetric, so it cannot favour the newer run", () => {
    expect(mcnemarExact(4, 17).pValue).toBeCloseTo(mcnemarExact(17, 4).pValue, 12);
  });

  /** Small counts stay honest rather than borrowing significance. */
  it("refuses to call a two-against-nothing split significant", () => {
    expect(mcnemarExact(0, 2).pValue).toBeCloseTo(0.5, 10);
  });

  it("stays computable at counts a large run would produce", () => {
    const { pValue } = mcnemarExact(120, 200);
    expect(pValue).toBeGreaterThan(0);
    expect(pValue).toBeLessThan(0.0001);
  });
});

/**
 * The hypothesis is not only that agreement improves, but that it improves by
 * the marker becoming less generous. A change that fixed as many harsh calls
 * as it broke generous ones would leave agreement flat while doing what was
 * asked, and one percentage could not tell the difference.
 */
describe("which way a run errs", () => {
  it("separates marks awarded too freely from marks withheld too readily", () => {
    const direction = countDirection([
      outcome("r1", [
        { id: "Mark 1", human: false, jami: true },
        { id: "Mark 2", human: false, jami: true },
        { id: "Mark 3", human: true, jami: false },
        { id: "Mark 4", human: true, jami: true },
        { id: "Mark 5", human: true, jami: null },
      ]),
    ]);
    expect(direction).toEqual({ generous: 2, harsh: 1 });
  });
});
