import { describe, expect, it } from "vitest";
import type { MarkingCorpusRecord, MarkingCorpusSource } from "@/lib/evaluation/marking-corpus";
import {
  armCoverage,
  commonBenchmark,
  detectArmCollapse,
  selectExemplars,
} from "@/lib/evaluation/exemplar-arms";
import { estimateExperiment, runExperiment, type Marker } from "@/lib/evaluation/experiment";

const open: MarkingCorpusSource = {
  id: "open",
  title: "Open",
  level: "gcse",
  subjects: ["maths"],
  regimes: ["additive"],
  licence: { id: "CC BY 4.0", redistributable: true, verified: true },
  handwritten: false,
  commentary: false,
  notes: "",
};
const sourceFor = () => open;

function record(overrides: Partial<MarkingCorpusRecord> & { id: string }): MarkingCorpusRecord {
  return {
    sourceId: "open",
    level: "gcse",
    subject: "maths",
    regime: "additive",
    questionId: overrides.id,
    questionPrompt: "Explain.",
    answer: { kind: "text", text: "An answer." },
    humanMarks: [4],
    maxMarks: 8,
    ...overrides,
  };
}

const target = record({ id: "target", questionId: "q-target" });
const pool = [
  record({ id: "same", questionId: "q-same" }),
  record({ id: "other-regime", questionId: "q-banded", regime: "banded" }),
  record({ id: "other-subject", questionId: "q-english", subject: "english" }),
  record({ id: "other-level", questionId: "q-alevel", level: "alevel" }),
];

describe("choosing exemplars for an arm", () => {
  const base = { target, pool, benchmark: [target], sourceFor, count: 2 };

  it("gives the control none", () => {
    expect(selectExemplars({ ...base, arm: "none" }).exemplars).toEqual([]);
  });

  it("lets the generic arm take anything", () => {
    const { exemplars } = selectExemplars({ ...base, arm: "generic", count: 4 });
    expect(exemplars).toHaveLength(4);
  });

  it("restricts the regime arm to the same regime", () => {
    const { exemplars } = selectExemplars({ ...base, arm: "regime", count: 4 });
    expect(exemplars.every((record) => record.regime === "additive")).toBe(true);
    expect(exemplars.map((r) => r.id)).not.toContain("other-regime");
  });

  it("restricts the matched arm to subject, level and regime", () => {
    const { exemplars } = selectExemplars({ ...base, arm: "matched", count: 4 });
    expect(exemplars.map((record) => record.id)).toEqual(["same"]);
  });

  /**
   * The guard is re-run per candidate rather than trusting the pool it was
   * handed. A pool built once and trusted forever is how a leak survives.
   */
  it("never retrieves another answer to the question under test", () => {
    const sameQuestion = record({ id: "sibling", questionId: "q-target" });
    const { exemplars } = selectExemplars({
      ...base,
      arm: "generic",
      pool: [...pool, sameQuestion],
      count: 9,
    });
    expect(exemplars.map((record) => record.id)).not.toContain("sibling");
  });

  it("never retrieves a record that is in the benchmark", () => {
    const held = record({ id: "held", questionId: "q-held" });
    const { exemplars } = selectExemplars({
      ...base,
      arm: "generic",
      pool: [...pool, held],
      benchmark: [target, held],
      count: 9,
    });
    expect(exemplars.map((record) => record.id)).not.toContain("held");
  });

  it("never retrieves calibration data", () => {
    const doubleMarked = record({ id: "double", questionId: "q-double", humanMarks: [3, 5] });
    const { exemplars } = selectExemplars({
      ...base,
      arm: "generic",
      pool: [...pool, doubleMarked],
      count: 9,
    });
    expect(exemplars.map((record) => record.id)).not.toContain("double");
  });

  it("chooses the same exemplars every run", () => {
    const first = selectExemplars({ ...base, arm: "generic" }).exemplars.map((r) => r.id);
    const second = selectExemplars({ ...base, arm: "generic" }).exemplars.map((r) => r.id);
    expect(first).toEqual(second);
  });

  /**
   * An arm that quietly fell back to a looser match would make C and D
   * indistinguishable from B and invalidate the comparison.
   */
  it("reports a shortfall rather than loosening the match", () => {
    const { exemplars, shortfall } = selectExemplars({
      ...base,
      arm: "matched",
      target: record({ id: "t", questionId: "q-t", subject: "history" }),
    });
    expect(exemplars).toEqual([]);
    expect(shortfall).toContain("No exemplar in the pool matches matched");
  });
});

describe("keeping the arms comparable", () => {
  /**
   * If arm D can only be filled for some responses, scoring it on those while
   * scoring arm A on everything compares two different exams.
   */
  it("runs every arm over only the responses all of them can serve", () => {
    const servable = record({ id: "servable", questionId: "q-servable" });
    const unservable = record({ id: "history", questionId: "q-history", subject: "history" });
    const common = commonBenchmark({
      benchmark: [servable, unservable],
      pool,
      sourceFor,
      count: 1,
    });
    expect(common.map((record) => record.id)).toEqual(["servable"]);
  });

  it("reports how much of the benchmark each arm could serve", () => {
    const coverage = armCoverage({
      benchmark: [target, record({ id: "h", questionId: "q-h", subject: "history" })],
      pool,
      sourceFor,
      count: 1,
    });
    expect(coverage.find((entry) => entry.arm === "none")?.share).toBe(1);
    expect(coverage.find((entry) => entry.arm === "matched")?.servable).toBe(1);
  });
});

/**
 * The quiet failure that would invalidate the whole experiment: if the pool
 * holds one level/subject/regime, then "any exemplar", "same regime" and
 * "fully matched" all pick the same records, the arms score identically, and
 * the obvious reading — matching makes no difference — is exactly backwards.
 */
describe("detecting arms that are secretly the same arm", () => {
  it("reports arms that choose identical exemplars", () => {
    const uniform = [
      record({ id: "u1", questionId: "q-u1" }),
      record({ id: "u2", questionId: "q-u2" }),
    ];
    const { collapsed, targets } = detectArmCollapse({
      benchmark: [target],
      pool: uniform,
      sourceFor,
      count: 2,
    });
    expect(targets).toBe(1);
    expect(collapsed).toHaveLength(3);
    expect(collapsed.every((entry) => entry.records === 1)).toBe(true);
  });

  it("stays quiet when the pool actually varies", () => {
    const varied = [
      record({ id: "v1", questionId: "q-v1" }),
      record({ id: "v2", questionId: "q-v2", regime: "banded" }),
      record({ id: "v3", questionId: "q-v3", subject: "english" }),
      record({ id: "v4", questionId: "q-v4", level: "alevel" }),
    ];
    const { collapsed } = detectArmCollapse({
      benchmark: [target],
      pool: varied,
      sourceFor,
      count: 1,
    });
    expect(collapsed).toEqual([]);
  });
});

describe("running the experiment", () => {
  const benchmark = [
    record({ id: "b1", questionId: "q-b1", humanMarks: [4, 6], maxMarks: 8 }),
    record({ id: "b2", questionId: "q-b2", humanMarks: [3], maxMarks: 8 }),
  ];

  /** A stub marker: perfect when it has exemplars, two marks out without. */
  const marker: Marker = async ({ record, exemplars }) =>
    exemplars.length > 0
      ? { awardedMarks: record.humanMarks[0] }
      : { awardedMarks: record.humanMarks[0] + 2 };

  it("marks the same responses in every arm", async () => {
    const result = await runExperiment({ benchmark, pool, mark: marker, sourceFor, exemplarCount: 1 });
    const counts = result.arms.map((arm) => arm.summary.count);
    expect(new Set(counts).size).toBe(1);
    expect(result.benchmarkSize).toBe(2);
  });

  it("reports every arm against the control, with improvement positive", async () => {
    const result = await runExperiment({ benchmark, pool, mark: marker, sourceFor, exemplarCount: 1 });
    for (const comparison of result.comparison) {
      expect(comparison.exactDelta).toBeGreaterThan(0);
      // Error falls, and the delta is flipped so positive still reads as better.
      expect(comparison.maeDelta).toBeGreaterThan(0);
      expect(comparison.normalisedErrorDelta).toBeGreaterThan(0);
    }
  });

  it("records a refusal rather than inventing a mark", async () => {
    const refusing: Marker = async ({ arm }) => (arm === "none" ? null : { awardedMarks: 4 });
    const result = await runExperiment({
      benchmark,
      pool,
      mark: refusing,
      sourceFor,
      exemplarCount: 1,
    });
    const control = result.arms.find((arm) => arm.arm === "none");
    expect(control?.refusals).toBe(2);
    expect(control?.summary.count).toBe(0);
  });

  it("carries the marker's criteria into the scoring", async () => {
    const withCriteria = [
      record({
        id: "c1",
        questionId: "q-c1",
        humanMarks: [1],
        maxMarks: 2,
        criteria: [
          { id: "Mark 1", available: 1, awarded: 1 },
          { id: "Mark 2", available: 1, awarded: 0 },
        ],
      }),
    ];
    const criterionMarker: Marker = async () => ({
      awardedMarks: 1,
      criteria: [
        { criterion: "Mark 1", awarded: true },
        { criterion: "Mark 2", awarded: false },
      ],
    });
    const result = await runExperiment({
      benchmark: withCriteria,
      pool,
      mark: criterionMarker,
      sourceFor,
      arms: ["none"],
      exemplarCount: 1,
    });
    expect(result.arms[0].summary.criterionAgreement).toBe(1);
    expect(result.arms[0].summary.rightForTheRightReasons).toBe(1);
  });

  it("says which held-out responses no arm could serve", async () => {
    const result = await runExperiment({
      benchmark: [...benchmark, record({ id: "h", questionId: "q-h", subject: "history" })],
      pool,
      mark: marker,
      sourceFor,
      exemplarCount: 1,
    });
    expect(result.excluded.map((entry) => entry.recordId)).toEqual(["h"]);
  });
});

describe("estimating before spending", () => {
  it("charges the exemplars, so the richer arms cost more", () => {
    const estimates = estimateExperiment({
      benchmark: [target],
      pool,
      sourceFor,
      exemplarCount: 3,
    });
    const control = estimates.find((entry) => entry.arm === "none")!;
    const generic = estimates.find((entry) => entry.arm === "generic")!;
    expect(generic.estimate.estimatedUsd).toBeGreaterThan(control.estimate.estimatedUsd);
    expect(control.records).toBe(generic.records);
  });
});
