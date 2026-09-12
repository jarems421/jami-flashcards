import { describe, expect, it } from "vitest";
import { markingCostBound } from "@/lib/evaluation/marking-cost-bound";
import { getAiInputTokenCap, getAiTokenCap } from "@/lib/ai/budgets";

/**
 * The number a run reserves against.
 *
 * It is a conservative estimate and not a ceiling: image billing, the
 * provider's own tokeniser, reasoning-token accounting and per-endpoint prices
 * are all outside it. What these check is that the estimate is derived from
 * the caps the product actually ships, so changing a cap moves the reservation
 * instead of silently invalidating it.
 */
describe("the per-marking cost bound", () => {
  const shipped = markingCostBound({
    inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
    maxOutputTokens: getAiTokenCap("examQuestionMarking"),
  });

  it("is computed from the caps the product actually ships", () => {
    expect(shipped.capsEnforced).toBe(true);
    expect(getAiInputTokenCap("examQuestionMarking")).toBe(32_000);
    expect(getAiTokenCap("examQuestionMarking")).toBe(16_000);
  });

  /*
   * Not a guarantee at all without an input cap: nothing stops a request
   * growing, so the caller is told the bound is unverified rather than handed
   * a number that looks like one.
   */
  it("says so when there is no input cap to compute from", () => {
    expect(markingCostBound({ inputTokenCap: null, maxOutputTokens: 8_000 }).capsEnforced).toBe(false);
  });

  /*
   * Bounded, and no longer the number a ten-record probe was budgeted around.
   *
   * The output cap doubled to 16,000 after a benchmark truncated one marking in
   * six at 8,000 and paid for every one of them, so the reserve this computes
   * rose with it. That is the bound working: it is a function of the caps, and
   * a reserve that had not moved would have been describing a marker the
   * product no longer ships.
   */
  it("stays within an order of magnitude of a single marking", () => {
    expect(shipped.usdPerRecord).toBeLessThanOrEqual(1);
    expect(shipped.usdPerRecord).toBeGreaterThan(0.2);
  });

  it("prices the supervisor above the worker, as the rates do", () => {
    expect(shipped.breakdown.supervisorCallUsd).toBeGreaterThan(shipped.breakdown.workerCallUsd);
  });

  it("counts one marking as three calls, retried", () => {
    expect(shipped.breakdown.callsPerMarking).toBe(3);
    expect(shipped.breakdown.attemptsPerCall).toBe(3);
    expect(shipped.breakdown.rateLimitAttempts).toBe(4);
  });

  it("grows with the caps rather than staying a fixed number", () => {
    const doubled = markingCostBound({ inputTokenCap: 64_000, maxOutputTokens: 32_000 });
    expect(doubled.usdPerRecord).toBeGreaterThan(shipped.usdPerRecord * 1.9);
  });
});
