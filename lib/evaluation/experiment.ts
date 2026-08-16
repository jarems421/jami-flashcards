import type { MarkingCorpusRecord, MarkingCorpusSource } from "@/lib/evaluation/marking-corpus";
import {
  ARM_LABELS,
  EXEMPLAR_ARMS,
  commonBenchmark,
  selectExemplars,
  type ExemplarArm,
} from "./exemplar-arms.ts";
import {
  summariseBy,
  summariseOutcomes,
  scoreMark,
  type MarkOutcome,
  type OutcomeSummary,
} from "./scoring.ts";
import { estimateEvaluationCost, type TokenPricing } from "./sampling.ts";

/**
 * The exemplar experiment.
 *
 * Runs the same held-out responses through every arm and compares the results.
 * Two decisions make it worth trusting.
 *
 * Every arm marks the same responses. Letting each run on whatever it could
 * find exemplars for would score arm D on the subjects that happen to have
 * exemplars and arm A on everything, and the gap between them would measure a
 * difference in the exam rather than in the marking.
 *
 * The marker is injected. This module never calls a model, which is what lets
 * the whole harness be tested for nothing, and what keeps the decision to spend
 * money in the caller's hands rather than buried in a library.
 */

export type MarkRequest = {
  record: MarkingCorpusRecord;
  arm: ExemplarArm;
  exemplars: readonly MarkingCorpusRecord[];
};

export type MarkResponse = {
  awardedMarks: number;
  criteria?: readonly { criterion: string; awarded: boolean }[];
};

/** Injected. Returning null records a refusal rather than inventing a mark. */
export type Marker = (request: MarkRequest) => Promise<MarkResponse | null>;

export type ArmResult = {
  arm: ExemplarArm;
  label: string;
  outcomes: MarkOutcome[];
  summary: OutcomeSummary;
  bySubject: { key: string; summary: OutcomeSummary }[];
  byLevel: { key: string; summary: OutcomeSummary }[];
  byRegime: { key: string; summary: OutcomeSummary }[];
  /** Responses the marker declined or failed on. */
  refusals: number;
  exemplarsPerRecord: number;
};

export type ExperimentResult = {
  arms: ArmResult[];
  /** The responses every arm marked, which is what makes the arms comparable. */
  benchmarkSize: number;
  /** Held-out responses no arm could be filled for, and why. */
  excluded: { recordId: string; reason: string }[];
  comparison: ArmComparison[];
};

/** Each arm read against the control, which is the only number that matters. */
export type ArmComparison = {
  arm: ExemplarArm;
  label: string;
  exactDelta: number;
  maeDelta: number;
  normalisedErrorDelta: number;
  withinHumanVariationDelta: number | null;
  criterionAgreementDelta: number | null;
};

export type ExperimentOptions = {
  benchmark: readonly MarkingCorpusRecord[];
  pool: readonly MarkingCorpusRecord[];
  mark: Marker;
  arms?: readonly ExemplarArm[];
  exemplarCount?: number;
  seed?: string;
  /** Cap on responses marked per arm. */
  limit?: number;
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
  /**
   * Markings in flight at once. One by default, so tests stay deterministic
   * and ordered.
   *
   * Worth raising for a real run: marking is almost entirely waiting. A first
   * run spent an hour on 42 responses because one model in the ensemble sits
   * on a 60-second timeout, and sequential waiting turns each of those into
   * dead wall-clock. Concurrency does not make any single marking faster; it
   * stops the slow ones blocking everything behind them.
   */
  concurrency?: number;
  /** Called as each marking lands, so a long run can be checkpointed. */
  onOutcome?: (outcome: MarkOutcome, arm: ExemplarArm) => void;
};

export async function runExperiment(options: ExperimentOptions): Promise<ExperimentResult> {
  const arms = options.arms ?? EXEMPLAR_ARMS;
  const selection = {
    benchmark: options.benchmark,
    pool: options.pool,
    count: options.exemplarCount,
    seed: options.seed,
    sourceFor: options.sourceFor,
  };

  const common = commonBenchmark(selection);
  const servable = new Set(common.map((record) => record.id));
  const excluded = options.benchmark
    .filter((record) => !servable.has(record.id))
    .map((record) => ({
      recordId: record.id,
      reason: `No exemplar available for every arm at ${record.level}/${record.subject}/${record.regime}.`,
    }));

  const targets = options.limit ? common.slice(0, options.limit) : common;

  const concurrency = Math.max(1, options.concurrency ?? 1);
  const results: ArmResult[] = [];
  for (const arm of arms) {
    const scored = new Array<MarkOutcome | null>(targets.length).fill(null);
    let refusals = 0;
    let exemplarTotal = 0;

    // A shared cursor rather than fixed slices, so one slow marking holds up
    // only its own worker instead of a whole block behind it.
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= targets.length) return;
        const record = targets[index];
        const { exemplars } = selectExemplars({ ...selection, arm, target: record });
        exemplarTotal += exemplars.length;
        const response = await options.mark({ record, arm, exemplars });
        if (!response) {
          refusals += 1;
          continue;
        }
        const outcome = scoreMark({
          record,
          candidate: response.awardedMarks,
          criteria: response.criteria,
        });
        // Placed by index, so results are in benchmark order whatever order
        // they finished in and a rerun is comparable to this one.
        scored[index] = outcome;
        options.onOutcome?.(outcome, arm);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, targets.length) }, () => worker())
    );
    const outcomes = scored.filter((outcome): outcome is MarkOutcome => outcome !== null);

    results.push({
      arm,
      label: ARM_LABELS[arm],
      outcomes,
      summary: summariseOutcomes(outcomes),
      bySubject: summariseBy(outcomes, (outcome) => outcome.subject),
      byLevel: summariseBy(outcomes, (outcome) => outcome.level),
      byRegime: summariseBy(outcomes, (outcome) => outcome.regime),
      refusals,
      exemplarsPerRecord: targets.length === 0 ? 0 : exemplarTotal / targets.length,
    });
  }

  return {
    arms: results,
    benchmarkSize: targets.length,
    excluded,
    comparison: compareToControl(results),
  };
}

/**
 * Every arm against the control.
 *
 * Reported as deltas because the absolute figures are not the question. An
 * arm scoring 0.62 exact agreement means nothing on its own; whether it beats
 * the no-exemplar control is the whole experiment, and a delta of roughly zero
 * is a result worth having — it says the exemplar tokens are being spent for
 * nothing.
 */
export function compareToControl(arms: readonly ArmResult[]): ArmComparison[] {
  const control = arms.find((arm) => arm.arm === "none");
  if (!control) return [];
  const difference = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a - b;

  return arms
    .filter((arm) => arm.arm !== "none")
    .map((arm) => ({
      arm: arm.arm,
      label: arm.label,
      exactDelta: arm.summary.exact - control.summary.exact,
      // Lower is better for error, so the sign is flipped to make every delta
      // read the same way: positive is an improvement.
      maeDelta: control.summary.meanAbsoluteError - arm.summary.meanAbsoluteError,
      normalisedErrorDelta: control.summary.normalisedError - arm.summary.normalisedError,
      withinHumanVariationDelta: difference(
        arm.summary.withinHumanVariation,
        control.summary.withinHumanVariation
      ),
      criterionAgreementDelta: difference(
        arm.summary.criterionAgreement,
        control.summary.criterionAgreement
      ),
    }));
}

/**
 * What the run would cost before anything is spent.
 *
 * Exemplars are charged on every call, so arm D is meaningfully dearer than
 * arm A over the same responses. Reporting per-arm rather than in total is what
 * makes "does it help enough to be worth paying for" answerable.
 */
export function estimateExperiment(options: {
  benchmark: readonly MarkingCorpusRecord[];
  pool: readonly MarkingCorpusRecord[];
  arms?: readonly ExemplarArm[];
  exemplarCount?: number;
  seed?: string;
  limit?: number;
  pricing?: TokenPricing;
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
}) {
  const selection = {
    benchmark: options.benchmark,
    pool: options.pool,
    count: options.exemplarCount,
    seed: options.seed,
    sourceFor: options.sourceFor,
  };
  const common = commonBenchmark(selection);
  const targets = options.limit ? common.slice(0, options.limit) : common;

  return (options.arms ?? EXEMPLAR_ARMS).map((arm) => {
    const marked: MarkingCorpusRecord[] = [];
    for (const record of targets) {
      const { exemplars } = selectExemplars({ ...selection, arm, target: record });
      // An exemplar's cost is its own content, so it is charged by estimating
      // the exemplar alongside the response it is attached to.
      marked.push(record, ...exemplars);
    }
    return {
      arm,
      label: ARM_LABELS[arm],
      records: targets.length,
      estimate: estimateEvaluationCost(marked, options.pricing),
    };
  });
}
