/**
 * A conservative estimate of what one marking can cost. Not a guarantee.
 *
 * It is worth being exact about what this is, because an earlier version of
 * this comment called it an upper bound and it is not one.
 *
 * Four inputs are genuinely enforced in shipped code:
 *
 *   text input   `inputTokenCap` is checked before every provider call and the
 *                call refused above it.
 *   output       `maxOutputTokens` is sent with every request.
 *   calls        one marking is at most a primary, one verifier and one
 *                adjudication -- the forced and post-check verifiers are
 *                mutually exclusive.
 *   retries      three attempts per marker call from the shipped policy, and
 *                the evaluation's rate-limit loop may repeat a whole marking
 *                four times. Both are counted, multiplied.
 *
 * Four are not, and each could make a real bill exceed this number:
 *
 *   images       the cap is enforced against a character estimate that treats
 *                image bytes as characters divided by 3.5. That has no
 *                relationship to how a provider bills an image, which is
 *                usually by tile or patch. For the handwritten set the images
 *                are small -- a median of 5.7KB, none close to the cap -- and
 *                the estimator happens to call a median image about 1,200
 *                tokens, which is a plausible figure by coincidence rather
 *                than by modelling.
 *   tokeniser    even for text, the cap is enforced against characters over
 *                3.5, not the provider's own tokeniser. The margin below is a
 *                safety factor, not a proof.
 *   reasoning    the supervisor runs at medium reasoning effort. Whether those
 *                tokens are billed inside `max_tokens` or beyond it is a
 *                provider behaviour that has not been established here.
 *   routing      this said failover only selects a different endpoint for the
 *                same model. The first paid run disproved it: after three
 *                failures the router moved to a standby and called
 *                `moonshotai/kimi-k3`, a different model at a price this table
 *                does not hold. Per-endpoint prices on one model vary too. So
 *                the model billed is not fixed, and pinning it is the work
 *                this estimate would need to become a bound.
 *
 * So: reserve against this, report it as an estimate, and expect a small
 * overshoot to be possible. Closing the four gaps means pinning routes and
 * modelling image billing, which is a larger piece of work than the experiment
 * it would be protecting.
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
  /** A conservative estimate per marking, not a guaranteed ceiling. */
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
 * The per-marking estimate a run reserves against.
 *
 * `capsEnforced` says only that a text input cap and an output cap exist to
 * compute from. It does not mean the figure cannot be exceeded -- see the four
 * unmodelled dimensions above -- and it is named for what it checks rather
 * than being called `verified`, which read as a promise this cannot make.
 */
export function markingCostBound(input: {
  inputTokenCap: number | null;
  maxOutputTokens: number;
}): MarkingCostBound & { capsEnforced: boolean } {
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
    capsEnforced: typeof input.inputTokenCap === "number" && input.inputTokenCap > 0,
    breakdown: {
      supervisorCallUsd,
      workerCallUsd,
      callsPerMarking: 3,
      attemptsPerCall: ATTEMPTS_PER_CALL,
      rateLimitAttempts: RATE_LIMIT_ATTEMPTS,
    },
  };
}
