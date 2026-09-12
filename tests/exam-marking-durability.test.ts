import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";
import type { PracticePaperMarkerCheckpoints } from "@/lib/practice/marker-stages";

const generateAiText = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
const countAiInputTokens = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("@/lib/ai/provider-router", () => ({ generateAiText, countAiInputTokens }));

const { markSingleQuestionAdaptively, markerTimeoutMs } = await import(
  "@/services/ai/practice-paper-marking.server"
);

/**
 * Marking one question when the request that asked for it has gone.
 *
 * Two things changed when marking moved to a durable job, and both are the
 * kind that look fine until they cost money. The per-call timeout stopped
 * being a slice of a 55-second route budget, and a marking that dies part way
 * stopped throwing away the reports it had already paid for.
 */
const paper = mapPracticePaperData("paper-1", {
  notebookId: "paper-1",
  folderId: "folder-1",
  title: "Maths paper",
  status: "submitted",
  assessmentProfile: { qualificationOrModule: "GCSE Maths" },
  questions: [{ id: "q1", label: "Question 1", prompt: "Solve for x.", marks: 3 }],
  markScheme: {
    kind: "official",
    items: [
      {
        questionId: "q1",
        answer: "x = 4",
        criteria: ["Rearranges", "Solves"],
        acceptableAlternatives: [],
        commonMistakes: [],
      },
    ],
  },
});

function report(awardedMarks: number) {
  return JSON.stringify({
    summary: "Evidence-based report.",
    strengths: ["Correct method"],
    priorities: ["Show the substitution"],
    questionResults: [
      {
        questionId: "q1",
        label: "Question 1",
        awardedMarks,
        maxMarks: 3,
        feedback: "Specific feedback.",
        criterionResults: [
          { criterion: "Rearranges", awarded: true, awardedMarks: 1, evidence: "Line 1" },
          { criterion: "Solves", awarded: awardedMarks > 1, awardedMarks: awardedMarks - 1, evidence: "Line 2" },
        ],
        evidence: ["Line 1"],
        strengths: [],
        improvements: [],
        confidence: "high",
        attempted: true,
      },
    ],
  });
}

function input() {
  return {
    paper,
    answerParts: [
      { text: "--- BEGIN UNTRUSTED REFERENCE: ANSWER q1 ---" },
      { inlineData: { data: "cTEtaW1hZ2U=", mimeType: "image/png" } },
      { text: "--- END UNTRUSTED REFERENCE: ANSWER q1 ---" },
    ],
    deadlineAt: Date.now() + 600_000,
    maxOutputTokens: 2_000,
  };
}

beforeEach(() => {
  generateAiText.mockReset();
  generateAiText.mockResolvedValue(report(3));
  countAiInputTokens.mockReset();
  countAiInputTokens.mockResolvedValue(0);
});

describe("how long a marker gets", () => {
  /*
   * The override this replaces gave the supervisor 30 seconds because that is
   * what fitted beside two other calls inside a 55-second request. The role's
   * own measurements -- p99 report length over p5 generation rate -- size the
   * same report at 408. Nothing about marking justified the smaller number.
   */
  it("uses the timeout derived from what the role writes", async () => {
    await markSingleQuestionAdaptively(input());
    const [call] = generateAiText.mock.calls.map((entry) => entry[0]);
    expect(call.timeoutMs).toBe(markerTimeoutMs("supervisor"));
    expect(call.timeoutMs).toBeGreaterThan(300_000);
  });

  /** The route's old arithmetic, kept only so an evaluation can reproduce it. */
  it("can still be asked for the deadline-shaped policy", async () => {
    await markSingleQuestionAdaptively({ ...input(), timeoutPolicy: "shipped" });
    expect(generateAiText.mock.calls[0][0].timeoutMs).toBe(30_000);
  });

  it("does not quietly apply that policy by default", async () => {
    await markSingleQuestionAdaptively(input());
    expect(generateAiText.mock.calls[0][0].timeoutMs).not.toBe(30_000);
  });
});

describe("a marking resumed after a failure", () => {
  /*
   * The case that used to cost twice. Two markers report, the adjudicator
   * throws, and the attempt is settled as failed -- with both paid reports
   * discarded, so the retry buys them again.
   */
  it("does not call a marker whose report it already has", async () => {
    const first = await markSingleQuestionAdaptively({ ...input(), forceVerification: true });
    const stages: PracticePaperMarkerCheckpoints = {};
    generateAiText.mockClear();

    await markSingleQuestionAdaptively({
      ...input(),
      forceVerification: true,
      cachedStageResults: {
        primary: { result: first.result, diagnostics: [] },
        verifier: { result: first.result, diagnostics: [] },
      },
      onStageResult: async (stage, result) => { stages[stage] = result; },
    });

    expect(generateAiText).not.toHaveBeenCalled();
    expect(Object.keys(stages)).toEqual([]);
  });

  it("records each report as it arrives, so the next run can reuse it", async () => {
    const stages: PracticePaperMarkerCheckpoints = {};
    await markSingleQuestionAdaptively({
      ...input(),
      forceVerification: true,
      onStageResult: async (stage, result) => { stages[stage] = result; },
    });
    expect(Object.keys(stages).sort()).toEqual(["primary", "verifier"]);
    expect(stages.primary?.result.questionResults[0].awardedMarks).toBe(3);
  });

  /*
   * A resumed stage's cost is counted, not dropped. The money went on this
   * marking, and both readers of these diagnostics -- the audit and the cost
   * ceiling -- are about the marking rather than about one attempt at it.
   * Forgetting it would let a marking that keeps failing spend without limit,
   * one resumption at a time.
   */
  it("keeps a reused report's cost against the marking", async () => {
    const marked = await markSingleQuestionAdaptively({
      ...input(),
      cachedStageResults: {
        primary: {
          result: JSON.parse(report(3)),
          diagnostics: [{ estimatedCostUsd: 0.02 } as never],
        },
      },
    });
    expect(marked.estimatedCostUsd).toBeCloseTo(0.02, 6);
    expect(marked.costAccounting.usd).toBeCloseTo(0.02, 6);
    expect(generateAiText).not.toHaveBeenCalled();
  });

  /*
   * Whether the primary needed repairing decides whether a second marker is
   * bought. It cannot be recomputed from the report -- the trouble was in the
   * calls -- so a resumed marking that did not carry it would silently skip a
   * post-check the original ran.
   */
  it("remembers that a report took more than one attempt to obtain", async () => {
    generateAiText.mockResolvedValueOnce("not json at all");
    const stages: PracticePaperMarkerCheckpoints = {};
    await markSingleQuestionAdaptively({
      ...input(),
      onStageResult: async (stage, result) => { stages[stage] = result; },
    });
    expect(stages.primary?.neededParseRetry).toBe(true);
  });
});

/**
 * What a failed double marking is allowed to forget.
 *
 * The two markers run together, so when one throws the other has usually
 * already answered and already been billed. `Promise.all` rejects on the first
 * failure and drops the other outcome entirely -- so a real provider call
 * vanished from the books, the failure was recorded as costing less than it
 * did, and `haltOnUnreportedCost` was shown one fewer call than had happened.
 * A benchmark stopped after one record for this reason once already.
 */
describe("the books when a double marking fails", () => {
  function diagnostic(role: string, estimatedCostUsd: number | undefined) {
    return {
      provider: "openrouter",
      role,
      routeReason: "primary",
      modelName: `model-${role}`,
      latencyMs: 10,
      ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
    };
  }

  /** Bills the call, then answers with something no parser will accept. */
  function billThenFail(cost: number) {
    return (call: { role: string; onResponse?: (value: unknown) => void }) => {
      call.onResponse?.(diagnostic(call.role, cost));
      return Promise.resolve("not a report");
    };
  }

  function billThenReport(cost: number | undefined, marks: number) {
    return (call: { role: string; onResponse?: (value: unknown) => void }) => {
      call.onResponse?.(diagnostic(call.role, cost));
      return Promise.resolve(report(marks));
    };
  }

  it("keeps the verifier's bill when the primary fails", async () => {
    generateAiText.mockImplementation((call: { role: string; onResponse?: (value: unknown) => void }) =>
      call.role === "supervisor" ? billThenFail(0.05)(call) : billThenReport(0.02, 3)(call)
    );

    const error = await markSingleQuestionAdaptively({ ...input(), forceVerification: true })
      .then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    const accounting = (error as { costAccounting: { usd: number; unreportedCalls: number } }).costAccounting;
    // Two primary attempts at $0.05, plus the verifier's one reported call at
    // $0.02. Dropping the verifier would leave $0.10 -- the old number.
    expect(accounting.usd).toBeCloseTo(0.12, 5);
    expect(accounting.unreportedCalls).toBe(0);
  });

  it("keeps the primary's bill when the verifier fails", async () => {
    generateAiText.mockImplementation((call: { role: string; onResponse?: (value: unknown) => void }) =>
      call.role === "supervisor" ? billThenReport(0.05, 3)(call) : billThenFail(0.02)(call)
    );

    const error = await markSingleQuestionAdaptively({ ...input(), forceVerification: true })
      .then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    const accounting = (error as { costAccounting: { usd: number; unreportedCalls: number } }).costAccounting;
    // Two verifier attempts at $0.02, plus the primary's report at $0.05.
    // Dropping the primary would leave $0.04.
    expect(accounting.usd).toBeCloseTo(0.09, 5);
  });

  /*
   * A forced verification is the guarantee that a mark was checked before a
   * student saw it. A verifier that died leaves one report, which is not that
   * guarantee, so the marking fails and the retry buys the missing stage back
   * from its checkpoint rather than marking single-handed.
   */
  it("does not quietly return a single-marked result when the verifier dies", async () => {
    generateAiText.mockImplementation((call: { role: string; onResponse?: (value: unknown) => void }) =>
      call.role === "supervisor" ? billThenReport(0.05, 3)(call) : billThenFail(0.02)(call)
    );
    await expect(markSingleQuestionAdaptively({ ...input(), forceVerification: true })).rejects.toThrow();
  });

  it("reports an unbilled call rather than counting it as free", async () => {
    generateAiText.mockImplementation((call: { role: string; onResponse?: (value: unknown) => void }) =>
      call.role === "supervisor" ? billThenFail(0.05)(call) : billThenReport(undefined, 3)(call)
    );

    const error = await markSingleQuestionAdaptively({ ...input(), forceVerification: true })
      .then(() => null, (thrown: unknown) => thrown);

    const thrown = error as { costAccounting: { unreportedCalls: number }; billingKnown: boolean };
    expect(thrown.costAccounting.unreportedCalls).toBeGreaterThan(0);
    expect(thrown.billingKnown).toBe(false);
  });
});
