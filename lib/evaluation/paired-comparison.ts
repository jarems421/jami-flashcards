import type { CriterionCall, MarkOutcome } from "@/lib/evaluation/scoring";

/**
 * Comparing two runs over the same responses.
 *
 * The headline figures of two runs can be subtracted, and the difference means
 * very little: 60% against 64% over 350 marks could as easily be the marks
 * that happened to be attempted as anything the change did. What answers the
 * question is that both runs marked the *same* marks, so each one can be asked
 * whether it flipped, and only the marks that changed their mind carry any
 * information about the change.
 *
 * That is McNemar's test, and it is used here in its exact form rather than
 * the chi-square approximation. A criterion benchmark is small enough that the
 * approximation's assumptions are the ones most likely to be violated, and
 * exact costs nothing at these counts.
 */

/** One mark, as two runs saw it. */
export type PairedCall = {
  recordId: string;
  criterionId: string;
  /** Whether the examiner awarded it; identical in both runs by construction. */
  human: boolean;
  beforeAgreed: boolean;
  afterAgreed: boolean;
};

export type DiscordantCounts = {
  /** Agreed in both runs. */
  agreedBoth: number;
  /** Agreed before the change and not after: what the change broke. */
  onlyBefore: number;
  /** Agreed after the change and not before: what the change fixed. */
  onlyAfter: number;
  /** Disagreed in both runs. */
  agreedNeither: number;
};

const logGamma = (value: number): number => {
  // Lanczos, g = 7, n = 9. Accurate to well past the precision this needs.
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let sum = coefficients[0];
  for (let index = 1; index < 9; index += 1) sum += coefficients[index] / (shifted + index);
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
};

const logChoose = (n: number, k: number) =>
  logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);

/**
 * Exact two-sided McNemar: the chance of a split this lopsided from a change
 * that did nothing.
 *
 * Only the discordant marks are counted. A mark both runs got right, or both
 * got wrong, says nothing about whether the change helped — including it would
 * dilute the comparison with agreement the change had no part in.
 */
export function mcnemarExact(onlyBefore: number, onlyAfter: number) {
  const discordant = onlyBefore + onlyAfter;
  if (discordant === 0) return { discordant, pValue: 1 };
  const smaller = Math.min(onlyBefore, onlyAfter);
  let tail = 0;
  for (let k = 0; k <= smaller; k += 1) {
    tail += Math.exp(logChoose(discordant, k) - discordant * Math.LN2);
  }
  return { discordant, pValue: Math.min(1, 2 * tail) };
}

const callKey = (recordId: string, call: CriterionCall) => `${recordId}::${call.id}`;

/**
 * Every mark both runs ruled on, with whether each run matched the examiner.
 *
 * Marks present in only one run are dropped rather than counted as failures:
 * a record that one run could not mark at all is a gap in coverage, and
 * scoring it as a disagreement would make an outage look like a regression.
 */
export function pairCriterionCalls(
  before: readonly MarkOutcome[],
  after: readonly MarkOutcome[]
): PairedCall[] {
  const index = new Map<string, { recordId: string; call: CriterionCall }>();
  for (const outcome of before) {
    for (const call of outcome.criterion?.calls ?? []) {
      index.set(callKey(outcome.recordId, call), { recordId: outcome.recordId, call });
    }
  }

  const paired: PairedCall[] = [];
  for (const outcome of after) {
    for (const call of outcome.criterion?.calls ?? []) {
      const earlier = index.get(callKey(outcome.recordId, call));
      if (!earlier) continue;
      paired.push({
        recordId: outcome.recordId,
        criterionId: call.id,
        human: call.human,
        beforeAgreed: earlier.call.jami === earlier.call.human,
        afterAgreed: call.jami === call.human,
      });
    }
  }
  return paired;
}

export function countDiscordant(paired: readonly PairedCall[]): DiscordantCounts {
  const counts: DiscordantCounts = {
    agreedBoth: 0,
    onlyBefore: 0,
    onlyAfter: 0,
    agreedNeither: 0,
  };
  for (const call of paired) {
    if (call.beforeAgreed && call.afterAgreed) counts.agreedBoth += 1;
    else if (call.beforeAgreed) counts.onlyBefore += 1;
    else if (call.afterAgreed) counts.onlyAfter += 1;
    else counts.agreedNeither += 1;
  }
  return counts;
}

/**
 * Which way a run errs, over the marks it got wrong.
 *
 * The hypothesis under test is not only that agreement improves but that it
 * improves by the marker becoming less generous, so the direction is reported
 * separately. A change that fixed as many harsh calls as it broke generous
 * ones would leave agreement flat while doing exactly what was asked of it,
 * and a single percentage could not tell the difference.
 */
export function countDirection(
  outcomes: readonly MarkOutcome[]
): { generous: number; harsh: number } {
  let generous = 0;
  let harsh = 0;
  for (const outcome of outcomes) {
    for (const call of outcome.criterion?.calls ?? []) {
      if (call.jami === null || call.jami === call.human) continue;
      // Awarded where the examiner withheld is generous; the converse is harsh.
      if (call.jami) generous += 1;
      else harsh += 1;
    }
  }
  return { generous, harsh };
}
