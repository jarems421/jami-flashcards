import { describe, expect, it } from "vitest";
import {
  MARKING_CORPUS_SOURCES,
  corpusCoverageGaps,
  corpusSubjects,
  humanDisagreement,
  isShippableAsExemplar,
  referenceMark,
  type MarkingCorpusRecord,
  type MarkingLevel,
  type MarkingRegime,
} from "@/lib/evaluation/marking-corpus";
import {
  budgetRefusal,
  estimateEvaluationCost,
  planEvaluation,
} from "@/lib/evaluation/sampling";

function record(
  overrides: Partial<MarkingCorpusRecord> & { id: string }
): MarkingCorpusRecord {
  return {
    sourceId: "test",
    level: "gcse",
    subject: "maths",
    regime: "additive",
    questionId: "q1",
    questionPrompt: "Solve for x.",
    answer: { kind: "text", text: "x = 4" },
    humanMarks: [3],
    maxMarks: 4,
    ...overrides,
  };
}

function spread(
  count: number,
  level: MarkingLevel,
  subject: string,
  regime: MarkingRegime
) {
  return Array.from({ length: count }, (_, index) =>
    record({ id: `${level}-${subject}-${regime}-${index}`, level, subject, regime })
  );
}

describe("corpus licensing", () => {
  /**
   * Unverified means not shippable, however permissive the licence looks. The
   * same fail-closed rule the provider gates use: a plausible label is not a
   * substitute for someone having read the terms.
   */
  it("never treats unread terms as permission", () => {
    expect(
      isShippableAsExemplar({
        ...MARKING_CORPUS_SOURCES[0],
        licence: { id: "CC BY 4.0", redistributable: true, verified: false },
      })
    ).toBe(false);
  });

  it("allows an exemplar only once the licence is both open and verified", () => {
    const base = MARKING_CORPUS_SOURCES[0];
    expect(
      isShippableAsExemplar({
        ...base,
        licence: { id: "CC BY 4.0", redistributable: true, verified: true },
      })
    ).toBe(true);
    expect(
      isShippableAsExemplar({
        ...base,
        licence: { id: "board exemplar", redistributable: false, verified: true },
      })
    ).toBe(false);
  });

  /**
   * This once asserted that nothing in the catalogue was shippable, which was
   * true only because nobody had read a licence yet. Two sources now carry
   * their licence in the payload — Medly ships the CC BY 4.0 text, JorGPT's
   * Zenodo record was preserved with the download — so the standing rule is
   * what gets tested: a source ships only when the terms were confirmed and
   * permit it, and anything unverified stays measure-only however open it
   * looks.
   */
  it("ships only what has an open licence someone has confirmed", () => {
    for (const source of MARKING_CORPUS_SOURCES) {
      if (!isShippableAsExemplar(source)) continue;
      expect(source.licence.verified).toBe(true);
      expect(source.licence.redistributable).toBe(true);
    }
    const unverified = MARKING_CORPUS_SOURCES.filter((source) => !source.licence.verified);
    expect(unverified.every((source) => !isShippableAsExemplar(source))).toBe(true);
  });
});

describe("corpus coverage", () => {
  it("spans school, upper school, undergraduate and postgraduate", () => {
    const levels = new Set(MARKING_CORPUS_SOURCES.map((source) => source.level));
    expect(levels).toContain("gcse");
    expect(levels).toContain("alevel");
    expect(levels).toContain("advancedHigher");
    expect(levels).toContain("undergraduate");
    expect(levels).toContain("postgraduate");
  });

  it("covers every marking regime somewhere", () => {
    const regimes = new Set(MARKING_CORPUS_SOURCES.flatMap((source) => source.regimes));
    for (const regime of ["additive", "pointPool", "banded", "weightedTraits", "competency"]) {
      expect(regimes).toContain(regime);
    }
  });

  it("covers sciences and essay subjects, not just maths", () => {
    const subjects = corpusSubjects();
    for (const subject of ["maths", "biology", "chemistry", "physics", "english", "economics"]) {
      expect(subjects).toContain(subject);
    }
  });

  it("includes handwritten sources, since that is the actual pipeline", () => {
    expect(MARKING_CORPUS_SOURCES.some((source) => source.handwritten)).toBe(true);
  });

  it("includes commentary sources, since those teach criterion reasoning", () => {
    expect(MARKING_CORPUS_SOURCES.some((source) => source.commentary)).toBe(true);
  });

  it("reports gaps rather than hiding them", () => {
    const gaps = corpusCoverageGaps();
    // Proof-style undergraduate maths has no marked corpus anywhere, so the
    // gap list should never be empty and quietly reassuring.
    expect(Array.isArray(gaps)).toBe(true);
    expect(gaps.every((gap) => gap.level && gap.regime)).toBe(true);
  });
});

describe("human marks", () => {
  it("averages multiple markers into one reference", () => {
    expect(referenceMark(record({ id: "a", humanMarks: [3, 4] }))).toBe(3.5);
  });

  it("reports the spread between markers, which sets the bar", () => {
    expect(humanDisagreement(record({ id: "a", humanMarks: [2, 5] }))).toBe(3);
  });

  it("has no spread to report from a single marker", () => {
    expect(humanDisagreement(record({ id: "a", humanMarks: [4] }))).toBeNull();
  });
});

describe("evaluation planning", () => {
  const corpus = [
    ...spread(50, "gcse", "maths", "additive"),
    ...spread(50, "gcse", "biology", "pointPool"),
    ...spread(400, "undergraduate", "computerScience", "pointPool"),
    ...spread(4, "alevel", "english", "banded"),
  ];

  it("spreads the sample across strata instead of following the biggest source", () => {
    const plan = planEvaluation({ records: corpus, budget: { perStratum: 5, maxRecords: 100 } });
    const selected = new Map(plan.strata.map((s) => [s.key, s.selected]));
    expect(selected.get("undergraduate/computerScience/pointPool")).toBe(5);
    expect(selected.get("gcse/maths/additive")).toBe(5);
    expect(selected.get("alevel/english/banded")).toBe(4);
  });

  it("thins every stratum evenly when the ceiling bites", () => {
    const plan = planEvaluation({ records: corpus, budget: { perStratum: 10, maxRecords: 8 } });
    expect(plan.records).toHaveLength(8);
    // Round-robin, so all four buckets appear rather than the first two
    // consuming the whole allowance.
    expect(plan.strata.filter((stratum) => stratum.selected > 0)).toHaveLength(4);
  });

  it("is reproducible for a given seed and varies with a different one", () => {
    const ids = (seed: string) =>
      planEvaluation({ records: corpus, seed, budget: { perStratum: 3, maxRecords: 12 } })
        .records.map((item) => item.id);
    expect(ids("alpha")).toEqual(ids("alpha"));
    expect(ids("alpha")).not.toEqual(ids("beta"));
  });

  it("reports what a source contributed against what it holds", () => {
    const plan = planEvaluation({ records: corpus, budget: { perStratum: 5, maxRecords: 100 } });
    const big = plan.strata.find((s) => s.key === "undergraduate/computerScience/pointPool");
    expect(big).toMatchObject({ available: 400, selected: 5 });
  });
});

describe("cost control", () => {
  it("charges an image answer far more than a typed one", () => {
    const typed = estimateEvaluationCost([record({ id: "typed" })]);
    const scanned = estimateEvaluationCost([
      record({ id: "scanned", answer: { kind: "image", paths: ["a.png", "b.png"] } }),
    ]);
    expect(scanned.estimatedInputTokens).toBeGreaterThan(typed.estimatedInputTokens * 5);
  });

  it("prices a blind pair plus adjudication, not a single call", () => {
    const estimate = estimateEvaluationCost([record({ id: "a" }), record({ id: "b" })]);
    expect(estimate.estimatedCalls).toBeGreaterThan(2 * 2);
  });

  it("refuses a run whose estimate exceeds the ceiling", () => {
    const plan = planEvaluation({
      records: spread(500, "undergraduate", "maths", "additive"),
      budget: { perStratum: 500, maxRecords: 500 },
    });
    expect(budgetRefusal(plan, { maxEstimatedUsd: 0.000001 })).toContain("exceeds");
  });

  it("permits a run inside the ceiling", () => {
    const plan = planEvaluation({ records: spread(10, "gcse", "maths", "additive") });
    expect(budgetRefusal(plan)).toBeNull();
  });

  it("refuses an empty plan rather than reporting a free success", () => {
    expect(budgetRefusal(planEvaluation({ records: [] }))).toContain("nothing to evaluate");
  });

  it("defaults to a sample small enough to be boring", () => {
    const plan = planEvaluation({ records: spread(10_000, "undergraduate", "maths", "additive") });
    expect(plan.records.length).toBeLessThanOrEqual(120);
    expect(plan.estimate.estimatedUsd).toBeLessThan(5);
  });
});
