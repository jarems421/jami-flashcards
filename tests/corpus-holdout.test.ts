import { describe, expect, it } from "vitest";
import type { MarkingCorpusRecord, MarkingCorpusSource } from "@/lib/evaluation/marking-corpus";
import { auditHoldout, exemplarRefusal, splitCorpus } from "@/lib/evaluation/holdout";

const open: MarkingCorpusSource = {
  id: "open-source",
  title: "Open",
  level: "gcse",
  subjects: ["maths"],
  regimes: ["additive"],
  licence: { id: "CC BY 4.0", redistributable: true, verified: true },
  handwritten: false,
  commentary: false,
  notes: "",
};
const closed: MarkingCorpusSource = {
  ...open,
  id: "closed-source",
  licence: { id: "board exemplar", redistributable: false, verified: false },
};

const sourceFor = (id: string) => [open, closed].find((source) => source.id === id);

function record(overrides: Partial<MarkingCorpusRecord> & { id: string }): MarkingCorpusRecord {
  return {
    sourceId: "open-source",
    level: "gcse",
    subject: "maths",
    regime: "additive",
    questionId: "q1",
    questionPrompt: "Explain.",
    answer: { kind: "text", text: "An answer." },
    humanMarks: [3],
    maxMarks: 5,
    ...overrides,
  };
}

/** Enough questions that the fraction has something to divide. */
const many = Array.from({ length: 40 }, (_unused, index) =>
  record({ id: `open:q${index}:a`, questionId: `q${index}` })
);

describe("splitting the corpus", () => {
  it("is the same split every time it runs", () => {
    const first = splitCorpus(many, { sourceFor });
    const second = splitCorpus(many, { sourceFor });
    expect(first.benchmark.map((r) => r.id)).toEqual(second.benchmark.map((r) => r.id));
    expect(first.exemplars.map((r) => r.id)).toEqual(second.exemplars.map((r) => r.id));
  });

  it("puts every record somewhere and none in two places", () => {
    const split = splitCorpus(many, { sourceFor });
    const total =
      split.benchmark.length + split.exemplars.length + split.withheldForLicence.length;
    expect(total).toBe(many.length);
    const ids = [...split.benchmark, ...split.exemplars, ...split.withheldForLicence].map((r) => r.id);
    expect(new Set(ids).size).toBe(many.length);
  });

  /**
   * The rule the whole split exists for. A double-marked response is the only
   * measurement of how far two humans are apart; spending it as an exemplar
   * trades the yardstick for a teaching aid, and lets Jami be shown the answer
   * it is about to be marked on.
   */
  it("always holds out anything more than one human marked", () => {
    const records = [
      record({ id: "double", questionId: "q-double", humanMarks: [4, 6] }),
      record({ id: "single", questionId: "q-single", humanMarks: [4] }),
    ];
    const split = splitCorpus(records, { sourceFor, benchmarkFraction: 0 });
    expect(split.benchmark.map((r) => r.id)).toEqual(["double"]);
    expect(split.exemplars.map((r) => r.id)).toEqual(["single"]);
  });

  /**
   * Retrieving a marked answer to the very question under test hands over the
   * mark scheme in all but name, so a question cannot straddle the line even
   * when its individual responses differ.
   */
  it("moves a whole question to one side, never splitting its answers", () => {
    const records = [
      record({ id: "a", questionId: "shared" }),
      record({ id: "b", questionId: "shared" }),
      record({ id: "c", questionId: "shared", humanMarks: [2, 5] }),
    ];
    const split = splitCorpus(records, { sourceFor });
    expect(split.benchmark).toHaveLength(3);
    expect(split.exemplars).toHaveLength(0);
  });

  it("holds out roughly the fraction asked for", () => {
    const all = splitCorpus(many, { sourceFor, benchmarkFraction: 1 });
    expect(all.exemplars).toHaveLength(0);
    const none = splitCorpus(many, { sourceFor, benchmarkFraction: 0 });
    expect(none.benchmark).toHaveLength(0);
    const some = splitCorpus(many, { sourceFor, benchmarkFraction: 0.5 });
    expect(some.benchmark.length).toBeGreaterThan(0);
    expect(some.exemplars.length).toBeGreaterThan(0);
  });

  /**
   * Licence is a separate gate from the split, and it is checked last: an
   * uncleared source cannot supply an exemplar however the questions fell.
   */
  it("keeps an uncleared licence out of the pool without losing the records", () => {
    const records = [record({ id: "x", sourceId: "closed-source", questionId: "q-closed" })];
    const split = splitCorpus(records, { sourceFor, benchmarkFraction: 0 });
    expect(split.exemplars).toHaveLength(0);
    expect(split.withheldForLicence.map((r) => r.id)).toEqual(["x"]);
  });

  it("says why each question landed where it did", () => {
    const split = splitCorpus(
      [record({ id: "d", questionId: "q-double", humanMarks: [1, 2] })],
      { sourceFor }
    );
    expect(split.groups[0]).toMatchObject({ side: "benchmark", records: 1 });
    expect(split.groups[0].reason).toContain("more than one human");
  });
});

describe("auditing a split", () => {
  it("passes a split it made itself", () => {
    const split = splitCorpus(many, { sourceFor });
    expect(auditHoldout({ ...split, sourceFor })).toEqual([]);
  });

  it("catches the same record on both sides", () => {
    const shared = record({ id: "same", questionId: "q-same" });
    const findings = auditHoldout({ benchmark: [shared], exemplars: [shared], sourceFor });
    expect(findings.some((finding) => finding.kind === "record in both")).toBe(true);
  });

  it("catches a different answer to a held-out question", () => {
    const findings = auditHoldout({
      benchmark: [record({ id: "held", questionId: "q9" })],
      exemplars: [record({ id: "other", questionId: "q9" })],
      sourceFor,
    });
    expect(findings.some((finding) => finding.kind === "question in both")).toBe(true);
  });

  it("catches calibration data offered as an exemplar", () => {
    const findings = auditHoldout({
      benchmark: [],
      exemplars: [record({ id: "cal", questionId: "q2", humanMarks: [3, 5] })],
      sourceFor,
    });
    expect(findings.some((finding) => finding.kind === "calibration record as exemplar")).toBe(true);
  });

  it("catches an uncleared source in the pool", () => {
    const findings = auditHoldout({
      benchmark: [],
      exemplars: [record({ id: "u", sourceId: "closed-source", questionId: "q3" })],
      sourceFor,
    });
    expect(findings.some((finding) => finding.kind === "licence not cleared")).toBe(true);
  });

  /** A source missing from the catalogue is uncleared, not assumed open. */
  it("treats an unknown source as uncleared", () => {
    const findings = auditHoldout({
      benchmark: [],
      exemplars: [record({ id: "unknown", sourceId: "not-catalogued", questionId: "q4" })],
      sourceFor,
    });
    expect(findings.some((finding) => finding.kind === "licence not cleared")).toBe(true);
  });
});

describe("the guard a retrieval path must pass", () => {
  const benchmark = [record({ id: "held", questionId: "q-held" })];

  it("allows a cleared, single-marked record whose question is not held out", () => {
    expect(exemplarRefusal(record({ id: "ok", questionId: "q-free" }), benchmark, sourceFor)).toBeNull();
  });

  it("refuses a record whose question is in the benchmark", () => {
    const refusal = exemplarRefusal(record({ id: "x", questionId: "q-held" }), benchmark, sourceFor);
    expect(refusal).toContain("held-out benchmark");
  });

  it("refuses calibration data outright", () => {
    const refusal = exemplarRefusal(
      record({ id: "x", questionId: "q-free", humanMarks: [1, 4] }),
      benchmark,
      sourceFor
    );
    expect(refusal).toContain("calibration data");
  });

  it("refuses a source whose licence is not cleared", () => {
    const refusal = exemplarRefusal(
      record({ id: "x", questionId: "q-free", sourceId: "closed-source" }),
      benchmark,
      sourceFor
    );
    expect(refusal).toContain("not been verified");
  });
});
