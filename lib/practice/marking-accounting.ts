import type { AiResponseDiagnostics } from "@/lib/ai/provider-router";
import {
  PracticePaperMarkingFailedError,
  type MarkingCostAccounting,
  type PracticePaperMarkerStageResult,
} from "@/lib/practice/marker-stages";

/**
 * What a marking cost, kept whole across the stages that failed.
 *
 * A marking is up to three provider calls, and the ones that throw are exactly
 * the ones whose spend is easiest to lose: a failed call has no successful
 * response to hang diagnostics on, so its bill travels on the error instead and
 * has to be added back by hand. Under-reporting here is not a reporting bug --
 * it is a real call that the ceiling never sees and the audit never records.
 *
 * These live outside the server module because they are arithmetic over
 * diagnostics, with no I/O of their own, and because the evaluation and the
 * workflow both need the cost-limit error without pulling in the marker.
 */
export const NO_COST: MarkingCostAccounting = { usd: 0, unreportedCalls: 0 };

export function mergeAccounting(
  a: MarkingCostAccounting,
  b: MarkingCostAccounting
): MarkingCostAccounting {
  return { usd: a.usd + b.usd, unreportedCalls: a.unreportedCalls + b.unreportedCalls };
}

export function costAccounting(diagnostics: readonly AiResponseDiagnostics[]): MarkingCostAccounting {
  let usd = 0;
  let unreportedCalls = 0;
  for (const item of diagnostics) {
    if (typeof item.estimatedCostUsd === "number") usd += item.estimatedCostUsd;
    else unreportedCalls += 1;
  }
  return { usd, unreportedCalls };
}

export function successfulCost(diagnostics: readonly AiResponseDiagnostics[]) {
  return diagnostics.reduce((total, item) => total + (item.estimatedCostUsd ?? 0), 0);
}

/**
 * Which models were actually called, as a set.
 *
 * Not the configured ids: routing moves. A failover reaches a different
 * endpoint, a standby reaches a different model family, and both have happened
 * here. A measurement that records what it configured rather than what answered
 * is describing a marker that may not be the one it measured.
 */
export function modelsUsed(diagnostics: readonly AiResponseDiagnostics[]) {
  return [...new Set(diagnostics.map((item) => item.modelName).filter(Boolean))].sort();
}

/** What a rejected stage spent before it failed. */
export function failedStageCost(
  outcome: PromiseSettledResult<PracticePaperMarkerStageResult>
): MarkingCostAccounting {
  if (outcome.status !== "rejected") return NO_COST;
  const reason: unknown = outcome.reason;
  return reason instanceof PracticePaperMarkingFailedError ? reason.costAccounting : NO_COST;
}

/**
 * Rethrow a failed stage with the whole marking's bill, not just its own.
 *
 * When the third call throws, the first two have already been paid for, and an
 * error carrying only the third's accounting under-reports what the marking
 * cost -- which is the same failure as reporting nothing, just quieter.
 */
export function rethrowWithMarkingCost(
  error: unknown,
  earlier: readonly AiResponseDiagnostics[],
  /** Spend from a stage that failed alongside this one, already an accounting. */
  alsoSpent: MarkingCostAccounting = NO_COST
): never {
  if (!(error instanceof PracticePaperMarkingFailedError)) throw error;
  const before = mergeAccounting(costAccounting(earlier), alsoSpent);
  throw new PracticePaperMarkingFailedError(
    error.message,
    mergeAccounting(before, error.costAccounting),
    error.billingKnown && before.unreportedCalls === 0
  );
}

export class PracticePaperMarkingCostLimitError extends Error {
  constructor() {
    super("Practice-paper marking reached its configured cost ceiling.");
    this.name = "PracticePaperMarkingCostLimitError";
  }
}

/** The ceiling is read off successful spend: an unbilled call is halted elsewhere. */
export function assertCostRoom(
  maxEstimatedCostUsd: number | undefined,
  diagnostics: readonly AiResponseDiagnostics[]
) {
  if (maxEstimatedCostUsd !== undefined && successfulCost(diagnostics) >= maxEstimatedCostUsd) {
    throw new PracticePaperMarkingCostLimitError();
  }
}
