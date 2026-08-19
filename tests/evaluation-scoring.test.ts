import { describe, expect, it } from "vitest";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { compareCriteria, scoreMark, summariseBy, summariseOutcomes } from "@/lib/evaluation/scoring";

function record(overrides: Partial<MarkingCorpusRecord> = {}): MarkingCorpusRecord {
  return {
    id: "r1",
    sourceId: "s",
    level: "gcse",
    subject: "maths",
    regime: "additive",
    questionId: "q1",
    questionPrompt: "Explain.",
    answer: { kind: "text", text: "An answer." },
    humanMarks: [4],
    maxMarks: 8,
    ...overrides,
  };
}

describe("scoring against humans who disagree", () => {
  /**
   * The judgement the whole module is built on. Two examiners said 6 and 8;
   * a mark of 7 is not an error against either of them, it is the best
   * available answer, and scoring it as "wrong against examiner 1" would
   * measure Jami against a number examiner 2 already rejected.
   */
  it("treats a mark between two examiners as inside human variation", () => {
    const outcome = scoreMark({ record: record({ humanMarks: [6, 8], maxMarks: 20 }), candidate: 7 });
    expect(outcome.insideHumanInterval).toBe(true);
    expect(outcome.intervalError).toBe(0);
    expect(outcome.withinHumanVariation).toBe(true);
    expect(outcome.consensusError).toBe(0);
    // It matches neither examiner exactly, and that is not held against it.
    expect(outcome.exactAgainstAny).toBe(false);
  });

  it("measures how far outside the interval a mark falls", () => {
    const outcome = scoreMark({ record: record({ humanMarks: [6, 8], maxMarks: 20 }), candidate: 11 });
    expect(outcome.insideHumanInterval).toBe(false);
    expect(outcome.intervalError).toBe(3);
    expect(outcome.withinHumanVariation).toBe(false);
  });

  it("counts agreement with either examiner, and with both", () => {
    const agreesWithOne = scoreMark({ record: record({ humanMarks: [6, 8] }), candidate: 6 });
    expect(agreesWithOne.exactAgainstAny).toBe(true);
    expect(agreesWithOne.exactAgainstAll).toBe(false);

    const agreesWithBoth = scoreMark({ record: record({ humanMarks: [6, 6] }), candidate: 6 });
    expect(agreesWithBoth.exactAgainstAll).toBe(true);
  });

  /**
   * A single-marked response has no interval. Reporting that as zero error
   * would flatter every source that could not supply a second marker.
   */
  it("leaves interval measurements null when only one human marked", () => {
    const outcome = scoreMark({ record: record({ humanMarks: [4] }), candidate: 9 });
    expect(outcome.humanSpread).toBeNull();
    expect(outcome.insideHumanInterval).toBeNull();
    expect(outcome.intervalError).toBeNull();
    expect(outcome.withinHumanVariation).toBeNull();
  });

  it("normalises error by the question's tariff so sizes compare", () => {
    const small = scoreMark({ record: record({ maxMarks: 2, humanMarks: [2] }), candidate: 1 });
    const large = scoreMark({ record: record({ maxMarks: 40, humanMarks: [40] }), candidate: 39 });
    expect(small.normalisedConsensusError).toBe(0.5);
    expect(large.normalisedConsensusError).toBeCloseTo(0.025);
  });

  it("counts a mark within one of either examiner", () => {
    expect(scoreMark({ record: record({ humanMarks: [6, 8] }), candidate: 9 }).withinOneOfAny).toBe(true);
    expect(scoreMark({ record: record({ humanMarks: [6, 8] }), candidate: 10 }).withinOneOfAny).toBe(false);
  });
});

describe("criterion agreement", () => {
  const human = [
    { id: "Mark 1", available: 1, awarded: 1, description: "find midpoint of PQ" },
    { id: "Mark 2", available: 1, awarded: 0, description: "calculate gradient" },
  ];

  it("matches by the scheme's identifier", () => {
    const outcome = compareCriteria(
      human,
      [
        { criterion: "Mark 1", awarded: true },
        { criterion: "Mark 2", awarded: false },
      ],
      true
    );
    expect(outcome).toMatchObject({ compared: 2, agreed: 2, missed: 0, extra: 0 });
  });

  it("falls back to the scheme's wording when the identifier is absent", () => {
    const outcome = compareCriteria(
      human,
      [
        { criterion: "find midpoint of PQ", awarded: true },
        { criterion: "calculate gradient", awarded: false },
      ],
      true
    );
    expect(outcome.compared).toBe(2);
    expect(outcome.agreed).toBe(2);
  });

  /**
   * A marker that addresses three of six marks and gets all three right is not
   * a marker that agrees with the examiner, so what it never mentioned is
   * counted rather than dropped.
   */
  it("counts criteria the marker never addressed", () => {
    const outcome = compareCriteria(human, [{ criterion: "Mark 1", awarded: true }], true);
    expect(outcome).toMatchObject({ compared: 1, agreed: 1, missed: 1 });
    expect(outcome.rightForTheRightReasons).toBe(false);
  });

  it("counts criteria the marker invented", () => {
    const outcome = compareCriteria(
      human,
      [
        { criterion: "Mark 1", awarded: true },
        { criterion: "Mark 2", awarded: false },
        { criterion: "Mark 3", awarded: true },
      ],
      true
    );
    expect(outcome.extra).toBe(1);
  });

  /** The right total by the wrong route is the failure this catches. */
  it("only credits the right reasons when the total is right too", () => {
    const rightTotalWrongReasons = compareCriteria(
      human,
      [
        { criterion: "Mark 1", awarded: false },
        { criterion: "Mark 2", awarded: true },
      ],
      true
    );
    expect(rightTotalWrongReasons.agreed).toBe(0);
    expect(rightTotalWrongReasons.rightForTheRightReasons).toBe(false);

    const wrongTotalRightReasons = compareCriteria(
      human,
      [
        { criterion: "Mark 1", awarded: true },
        { criterion: "Mark 2", awarded: false },
      ],
      false
    );
    expect(wrongTotalRightReasons.rightForTheRightReasons).toBe(false);
  });

  /**
   * The counts say how many marks agreed; these say which. Without them two
   * runs cannot be compared mark against mark, and "why did I lose mark 3"
   * can only be answered by inferring Jami's decisions from its total.
   */
  it("records each mark and what both sides decided about it", () => {
    const outcome = compareCriteria(
      human,
      [
        { criterion: "Mark 1", awarded: false },
        { criterion: "Mark 2", awarded: false },
      ],
      false
    );
    expect(outcome.calls).toEqual([
      { id: "Mark 1", human: true, jami: false },
      { id: "Mark 2", human: false, jami: false },
    ]);
  });

  it("records a mark the marker never addressed as null rather than withheld", () => {
    const outcome = compareCriteria(human, [{ criterion: "Mark 2", awarded: false }], false);
    expect(outcome.calls).toEqual([
      { id: "Mark 1", human: true, jami: null },
      { id: "Mark 2", human: false, jami: false },
    ]);
  });

  /** A mark the examiner never ruled on has nothing to sit beside. */
  it("leaves invented marks out of the calls and counts them as extra", () => {
    const outcome = compareCriteria(
      human,
      [
        { criterion: "Mark 1", awarded: true },
        { criterion: "Mark 2", awarded: false },
        { criterion: "Mark 3", awarded: true },
      ],
      true
    );
    expect(outcome.calls).toHaveLength(2);
    expect(outcome.extra).toBe(1);
  });

  it("is only reported when both sides carry criteria", () => {
    expect(scoreMark({ record: record(), candidate: 4 }).criterion).toBeNull();
    const withBoth = scoreMark({
      record: record({ criteria: human }),
      candidate: 4,
      criteria: [{ criterion: "Mark 1", awarded: true }],
    });
    expect(withBoth.criterion).not.toBeNull();
  });
});

describe("summarising a run", () => {
  const outcomes = [
    scoreMark({ record: record({ id: "a", humanMarks: [6, 8], maxMarks: 20 }), candidate: 7 }),
    scoreMark({ record: record({ id: "b", humanMarks: [4], maxMarks: 8 }), candidate: 4 }),
    scoreMark({ record: record({ id: "c", subject: "english", humanMarks: [2], maxMarks: 8 }), candidate: 5 }),
  ];

  it("reports human and candidate disagreement side by side", () => {
    const summary = summariseOutcomes(outcomes);
    expect(summary.doubleMarked).toBe(1);
    expect(summary.humanDisagreement).toBe(2);
    expect(summary.candidateDisagreement).toBe(0);
    expect(summary.insideHumanInterval).toBe(1);
  });

  it("reports bias, so a generous marker is visible", () => {
    const summary = summariseOutcomes(outcomes);
    // 7 vs consensus 7, 4 vs 4, 5 vs 2 -> mean +1
    expect(summary.bias).toBeCloseTo(1);
  });

  it("leaves interval figures null when nothing was double-marked", () => {
    const summary = summariseOutcomes([outcomes[1]]);
    expect(summary.doubleMarked).toBe(0);
    expect(summary.humanDisagreement).toBeNull();
    expect(summary.withinHumanVariation).toBeNull();
  });

  it("splits by a facet so a gain cannot hide a loss elsewhere", () => {
    const bySubject = summariseBy(outcomes, (outcome) => outcome.subject);
    expect(bySubject.map((entry) => entry.key)).toEqual(["english", "maths"]);
    expect(bySubject.find((entry) => entry.key === "english")?.summary.exact).toBe(0);
    expect(bySubject.find((entry) => entry.key === "maths")?.summary.count).toBe(2);
  });

  it("returns a zeroed summary rather than dividing by nothing", () => {
    expect(summariseOutcomes([])).toMatchObject({ count: 0, exact: 0, humanDisagreement: null });
  });
});
