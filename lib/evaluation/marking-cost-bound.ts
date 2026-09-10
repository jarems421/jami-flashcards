/**
 * The most one marking can cost, derived rather than guessed.
 *
 * A ceiling checked against reported spend is not a ceiling: the money is
 * already gone by the time it is counted, a provider that reports nothing
 * looks free, and one marking is several calls. To hold a reservation before
 * the first call, the reservation has to be an upper bound on what that
 * marking can possibly cost -- so it is computed from the things that are
 * actually enforced.
 *
 * Three of the four are hard limits in the shipped code:
 *
 *   input     `inputTokenCap` is checked before every provider call and the
 *             call is refused above it, so no request can carry more.
 *   output    `maxOutputTokens` is sent with every request and the provider
 *             stops there.
 *   calls     one marking is at most a primary, one verifier, and one
 *             adjudication. The post-check verifier and the forced verifier
 *             are mutually exclusive, so it is one verifier either way.
 *
 * The fourth, retries, is bounded by the shipped policy: three attempts per
 * marker call, and the evaluation's own rate-limit loop may repeat a whole
 * marking up to four times.
 *
 * The estimate is deliberately pessimistic in two places. The input cap is
 * enforced against a provider-neutral character estimate rather than the
 * provider's own tokeniser, so a margin is applied; and every retry is priced
 * as though it generated a full response, when a rate-limited one generates
 * nothing. An over-estimate ends a run early, an under-estimate lets it spend
 * past the number it was given, and only one of those can be undone.
 */

/**
 * Published per-token prices, read from the provider's public model metadata
 * on 2026-09-10. Prices change: a run that matters should re-read them rather
 * than trust this table, which is why the bound reports the date it used.
 */
export const MARKING_MODEL_PRICES = {
  /** qwen/qwen3.6-35b-a3b */
  supervisor: { promptUsdPerToken: 0.0000001, completionUsdPerToken: 0.0000009 },
  /** z-ai/glm-5.3-flash */
  worker: { promptUsdPerToken: 0.00000007, completionUsdPerToken: 0.0000002333 },
} as const;

export const MARKING_PRICES_READ_ON = "2026-09-10";

/** Slack on the input cap, which is enforced against an estimate. */
const INPUT_ESTIMATE_MARGIN = 1.5;
/** Attempts per marker call, from the shipped retry policy. */
const ATTEMPTS_PER_CALL = 3;
/** Whole-marking repeats the evaluation's rate-limit loop allows. */
const RATE_LIMIT_ATTEMPTS = 4;

export type MarkingCostBound = {
  usdPerRecord: number;
  pricesReadOn: string;
  breakdown: {
    supervisorCallUsd: number;
    workerCallUsd: number;
    callsPerMarking: number;
    attemptsPerCall: number;
    rateLimitAttempts: number;
  };
};

/**
 * An upper bound on one marking, for a run that reserves before it calls.
 *
 * `verified` says whether every input in the bound is enforced somewhere. A
 * bound computed without an input cap is not an upper bound at all, because
 * nothing stops a request growing, and the caller is told so rather than being
 * handed a number that looks like a guarantee.
 */
export function markingCostBound(input: {
  inputTokenCap: number | null;
  maxOutputTokens: number;
}): MarkingCostBound & { verified: boolean } {
  const inputTokens = (input.inputTokenCap ?? 0) * INPUT_ESTIMATE_MARGIN;
  const supervisorCallUsd =
    inputTokens * MARKING_MODEL_PRICES.supervisor.promptUsdPerToken +
    input.maxOutputTokens * MARKING_MODEL_PRICES.supervisor.completionUsdPerToken;
  const workerCallUsd =
    inputTokens * MARKING_MODEL_PRICES.worker.promptUsdPerToken +
    input.maxOutputTokens * MARKING_MODEL_PRICES.worker.completionUsdPerToken;

  // Primary and adjudication go to the supervisor; the single verifier to the
  // worker.
  const perAttempt = 2 * supervisorCallUsd + workerCallUsd;
  const usdPerRecord = perAttempt * ATTEMPTS_PER_CALL * RATE_LIMIT_ATTEMPTS;

  return {
    usdPerRecord,
    pricesReadOn: MARKING_PRICES_READ_ON,
    verified: typeof input.inputTokenCap === "number" && input.inputTokenCap > 0,
    breakdown: {
      supervisorCallUsd,
      workerCallUsd,
      callsPerMarking: 3,
      attemptsPerCall: ATTEMPTS_PER_CALL,
      rateLimitAttempts: RATE_LIMIT_ATTEMPTS,
    },
  };
}
