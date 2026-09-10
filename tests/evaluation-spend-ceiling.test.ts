import { describe, expect, it, vi } from "vitest";

/**
 * A ceiling that is checked after the money is gone is not a ceiling.
 *
 * The run was bounded by a record count, which bounds the number of markings
 * and not their price, and the first spend guard read the running total on the
 * way in. That bounds nothing under concurrency -- eight markings pass the
 * check together and then all eight spend -- and it ignores that one marking
 * is several calls: a second marker where the rule asks for one, an
 * adjudication where the two disagree, and a retry for every rate-limited
 * attempt.
 *
 * So the money is committed before the first call and reconciled to the real
 * figure afterwards. These tests hold the marker still and check the bound,
 * not the provider.
 */
const markPracticePaperWithAudit = vi.hoisted(() => vi.fn());
const markSingleQuestionAdaptively = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/services/ai/practice-paper-marking.server", () => ({
  markPracticePaperWithAudit,
  markSingleQuestionAdaptively,
}));
vi.mock("@/lib/evaluation/practice-paper-adapter", () => ({
  adaptRecordToPaper: () => ({
    ok: true,
    adapted: {
      paper: {
        questions: [{ id: "q1", label: "Q1", prompt: "Explain.", marks: 3 }],
        markScheme: { items: [{ questionId: "q1", maxMarks: 3, marking: "additive", points: [] }] },
      },
      answerParts: [{ text: "an answer" }],
    },
  }),
  exemplarsToParts: () => [],
}));

const { createEvaluationMarker } = await import("@/services/ai/evaluation-marker.server");

function record(id: string) {
  return {
    id,
    sourceId: "test",
    level: "gcse",
    subject: "maths",
    regime: "additive",
    questionId: "q1",
    questionPrompt: "Explain.",
    answer: { kind: "text", text: "an answer" },
    humanMarks: [2],
    maxMarks: 3,
    markScheme: "P1 for a method",
  } as never;
}

function reply(costUsd: number, unreportedCalls = 0) {
  return {
    result: {
      questionResults: [{ questionId: "q1", awardedMarks: 2, maxMarks: 3, criterionResults: [] }],
    },
    estimatedCostUsd: costUsd,
    costAccounting: { usd: costUsd, unreportedCalls },
    audit: {
      version: 1,
      primaryScores: { q1: 2 },
      verifierScores: {},
      disputedQuestionIds: [],
      adjudicatedQuestionIds: [],
      thirdViewQuestionIds: [],
      createdAt: 0,
    },
  };
}

describe("the evaluation spend ceiling", () => {
  it("stops before the call that would cross it, and never spends past it", async () => {
    markPracticePaperWithAudit.mockReset();
    markPracticePaperWithAudit.mockResolvedValue(reply(0.02));
    const { mark, stats } = createEvaluationMarker({
      maxRecords: 1_000,
      maxSpendUsd: 0.3,
      reserveUsdPerRecord: 0.1,
    });

    let refused = "";
    for (let index = 0; index < 100 && !refused; index += 1) {
      try {
        await mark({ record: record(`r${index}`), arm: "control", exemplars: [] } as never);
      } catch (error) {
        refused = error instanceof Error ? error.message : String(error);
      }
    }

    expect(refused).toMatch(/spend ceiling/);
    // A marking that comes in under its reservation releases the difference,
    // so a cheap run gets more markings -- but never more money.
    expect(stats.reportedUsd).toBeLessThanOrEqual(0.3);
    expect(stats.marked).toBeGreaterThan(3);
  });

  /*
   * The case a running total cannot catch: everything in flight at once, each
   * one seeing a total that none of the others has added to yet.
   */
  it("holds when every marking starts at the same moment", async () => {
    markPracticePaperWithAudit.mockReset();
    let inFlight = 0;
    let peak = 0;
    markPracticePaperWithAudit.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return reply(0.02);
    });
    const { mark, stats } = createEvaluationMarker({
      maxRecords: 100,
      maxSpendUsd: 0.2,
      reserveUsdPerRecord: 0.1,
    });

    const results = await Promise.allSettled(
      ["a", "b", "c", "d", "e", "f"].map((id) =>
        mark({ record: record(id), arm: "control", exemplars: [] } as never)
      )
    );

    // Two reservations fit in $0.20; the other four are refused outright.
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(2);
    expect(peak).toBeGreaterThan(1);
    expect(stats.marked).toBe(2);
  });

  /*
   * A marking that threw may already have paid for the calls it made. There is
   * no figure for those, so the reservation stands rather than being released.
   */
  it("keeps the reservation when a marking fails", async () => {
    markPracticePaperWithAudit.mockReset();
    markPracticePaperWithAudit.mockRejectedValue(new Error("provider exploded"));
    const { mark, stats } = createEvaluationMarker({
      maxRecords: 100,
      maxSpendUsd: 0.2,
      reserveUsdPerRecord: 0.1,
    });

    await mark({ record: record("a"), arm: "control", exemplars: [] } as never);
    await mark({ record: record("b"), arm: "control", exemplars: [] } as never);
    await expect(
      mark({ record: record("c"), arm: "control", exemplars: [] } as never)
    ).rejects.toThrow(/spend ceiling/);
    expect(stats.failed).toBe(2);
    // Nothing was reported, so nothing is measured: it is all held reservation.
    expect(stats.reportedUsd).toBe(0);
    expect(stats.retainedReservationUsd).toBeCloseTo(0.2);
  });

  /** An expensive marking reconciles upward, and the next one sees it. */
  it("reconciles a marking that cost more than its reservation", async () => {
    markPracticePaperWithAudit.mockReset();
    markPracticePaperWithAudit.mockResolvedValue(reply(0.25));
    const { mark, stats } = createEvaluationMarker({
      maxRecords: 100,
      maxSpendUsd: 0.3,
      reserveUsdPerRecord: 0.1,
    });

    await mark({ record: record("a"), arm: "control", exemplars: [] } as never);
    await expect(
      mark({ record: record("b"), arm: "control", exemplars: [] } as never)
    ).rejects.toThrow(/spend ceiling/);
    expect(stats.reportedUsd).toBeCloseTo(0.25);
  });

  /*
   * A provider that reports nothing sums to zero, which is the number a free
   * call produces. Releasing the reservation on that basis is how a bounded
   * run spends without noticing, so the reservation stands instead.
   */
  it("keeps the reservation when the provider reported no cost", async () => {
    markPracticePaperWithAudit.mockReset();
    markPracticePaperWithAudit.mockResolvedValue(reply(0, 1));
    const { mark, stats } = createEvaluationMarker({
      maxRecords: 100,
      maxSpendUsd: 0.2,
      reserveUsdPerRecord: 0.1,
    });

    await mark({ record: record("a"), arm: "control", exemplars: [] } as never);
    await mark({ record: record("b"), arm: "control", exemplars: [] } as never);
    await expect(
      mark({ record: record("c"), arm: "control", exemplars: [] } as never)
    ).rejects.toThrow(/spend ceiling/);
    expect(stats.unaccountedMarkings).toBe(2);
    expect(stats.reportedUsd).toBeCloseTo(0);
    expect(stats.retainedReservationUsd).toBeCloseTo(0.2);
  });

  /** A partly reported marking is still unaccounted: the floor is not a total. */
  it("does not release a reservation on a partial bill", async () => {
    markPracticePaperWithAudit.mockReset();
    markPracticePaperWithAudit.mockResolvedValue(reply(0.02, 1));
    const { mark, stats } = createEvaluationMarker({
      maxRecords: 100,
      maxSpendUsd: 0.2,
      reserveUsdPerRecord: 0.1,
    });
    await mark({ record: record("a"), arm: "control", exemplars: [] } as never);
    await mark({ record: record("b"), arm: "control", exemplars: [] } as never);
    await expect(
      mark({ record: record("c"), arm: "control", exemplars: [] } as never)
    ).rejects.toThrow(/spend ceiling/);
    expect(stats.unaccountedMarkings).toBe(2);
  });

  /*
   * Without a figure the reservation is all that is known, and every further
   * marking widens the gap between what was committed and what is being
   * charged. A run given a budget it must not exceed stops rather than
   * spending blind.
   */
  it("stops the whole run the first time a cost comes back unreported", async () => {
    markPracticePaperWithAudit.mockReset();
    markPracticePaperWithAudit.mockResolvedValue(reply(0.02, 1));
    const { mark, stats } = createEvaluationMarker({
      maxRecords: 100,
      maxSpendUsd: 3.51,
      reserveUsdPerRecord: 0.351,
      haltOnUnreportedCost: true,
    });

    await mark({ record: record("a"), arm: "control", exemplars: [] } as never);
    await expect(
      mark({ record: record("b"), arm: "control", exemplars: [] } as never)
    ).rejects.toThrow(/reported no cost/);
    expect(stats.unaccountedMarkings).toBe(1);
    // The budget was nowhere near exhausted; the unknown bill is what stopped it.
    expect(stats.reportedUsd).toBeLessThan(0.4);
  });

  it("keeps going on an unreported cost when it was not told to stop", async () => {
    markPracticePaperWithAudit.mockReset();
    markPracticePaperWithAudit.mockResolvedValue(reply(0.02, 1));
    const { mark, stats } = createEvaluationMarker({ maxRecords: 100, maxSpendUsd: 3.51 });
    await mark({ record: record("a"), arm: "control", exemplars: [] } as never);
    await mark({ record: record("b"), arm: "control", exemplars: [] } as never);
    expect(stats.unaccountedMarkings).toBe(2);
  });

  it("does not bound a run that was given no ceiling", async () => {
    markPracticePaperWithAudit.mockReset();
    markPracticePaperWithAudit.mockResolvedValue(reply(5));
    const { mark, stats } = createEvaluationMarker({ maxRecords: 3 });
    for (const id of ["a", "b", "c"]) {
      await mark({ record: record(id), arm: "control", exemplars: [] } as never);
    }
    expect(stats.marked).toBe(3);
  });
});
