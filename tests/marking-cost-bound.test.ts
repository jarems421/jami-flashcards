import { describe, expect, it } from "vitest";
import { markingCostBound } from "@/lib/evaluation/marking-cost-bound";
import { getAiInputTokenCap, getAiTokenCap } from "@/lib/ai/budgets";

/**
 * The number a run reserves against, and whether it is really a bound.
 *
 * Reserving before a call only bounds a run if the reservation is an upper
 * bound on what that call can cost. These check the derivation against the
 * caps the product actually ships, so a change to either cap moves the
 * reservation rather than silently invalidating it.
 */
describe("the per-marking cost bound", () => {
  const shipped = markingCostBound({
    inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
    maxOutputTokens: getAiTokenCap("examQuestionMarking"),
  });

  it("is verified against enforced caps for the shipped configuration", () => {
    expect(shipped.verified).toBe(true);
    expect(getAiInputTokenCap("examQuestionMarking")).toBe(32_000);
    expect(getAiTokenCap("examQuestionMarking")).toBe(8_000);
  });

  /*
   * Not a guarantee at all without an input cap: nothing stops a request
   * growing, so the caller is told the bound is unverified rather than handed
   * a number that looks like one.
   */
  it("refuses to call itself verified when nothing caps the input", () => {
    expect(markingCostBound({ inputTokenCap: null, maxOutputTokens: 8_000 }).verified).toBe(false);
  });

  it("stays under the amount proposed for the probe", () => {
    expect(shipped.usdPerRecord).toBeLessThanOrEqual(0.4);
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
    const doubled = markingCostBound({ inputTokenCap: 64_000, maxOutputTokens: 16_000 });
    expect(doubled.usdPerRecord).toBeGreaterThan(shipped.usdPerRecord * 1.9);
  });
});
