import {
  replayLearnerModelPredictions,
  type LearnerModelPrediction,
} from "@/lib/learning/evaluation/learner-model-evaluation";
import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Choosing the model's constants by how well they predicted, not by taste.
 *
 * Every number in `tuning.ts` was set by hand. This replays a student's own
 * history under candidate values and keeps whichever predicted their answers
 * best, which is the only evidence any of those numbers has ever had.
 *
 * Fitted on the earlier part of the history and reported on the later part, so
 * a set of constants that merely memorised the past is visible as such.
 */

/**
 * What a replay can actually settle, and what it cannot.
 *
 * A replay only sees dated evidence -- recorded review events and marked
 * answers -- and only scores predicted mastery against the credit earned. Three
 * groups of constants therefore fall outside it, and pretending otherwise would
 * dress a coin toss as a measurement:
 *
 * - `masteryHorizonDays`, `flashcardLapseWeight` and `flashcardRelearningCap`
 *   only ever score a card read from its aggregate totals, and those carry no
 *   dated history, so they never enter a replay at all.
 * - `confidenceEvidenceScale` sets confidence, and confidence is not what the
 *   error measures. `byConfidence` in the evaluation is the number that speaks
 *   to it: high-confidence predictions should be the more accurate ones.
 * - `trendThreshold` sets a label the error never looks at.
 */
export const FITTABLE_TUNING_FIELDS = [
  "masteryRecencyHalfLifeDays",
  "masteryPrior",
  "masteryPriorWeight",
  "maxEvidencePerItem",
  "studentPriorStrength",
] as const;

export type FittableTuningField = (typeof FITTABLE_TUNING_FIELDS)[number];

/**
 * Candidates per field, spanning well past anything plausible in both
 * directions -- a grid that stops at the hand-set value can only confirm it.
 */
export const TUNING_SEARCH_GRID: Record<FittableTuningField, readonly number[]> = {
  masteryRecencyHalfLifeDays: [7, 14, 30, 45, 60, 90, 180, 365, 1000],
  masteryPrior: [0.3, 0.4, 0.5, 0.6, 0.7],
  masteryPriorWeight: [0.25, 0.5, 1, 1.5, 2.5, 4, 8],
  maxEvidencePerItem: [1, 1.25, 1.5, 2, 3, 6],
  studentPriorStrength: [0, 0.25, 0.5, 0.75, 1],
};

/** How much of the history is fitted on; the rest is kept back to check it. */
export const DEFAULT_TRAIN_FRACTION = 0.7;
/** Passes over the fields. Two is usually enough; a third rarely moves anything. */
export const DEFAULT_FIT_PASSES = 3;

/**
 * How much better a candidate must be before it is worth changing anything.
 *
 * Coordinate descent always finds a winner, including when there is nothing to
 * win. On a student whose ability never changed, error across half-lives from a
 * week to three years varies in the fourth decimal -- pure noise -- and a search
 * without this threshold picks one of them and reports it as a finding. At one
 * part in a thousand a flat objective produces no changes at all, which is the
 * honest answer.
 */
export const MIN_RELATIVE_IMPROVEMENT = 0.001;

export type TuningScore = {
  trainMse: number | null;
  holdoutMse: number | null;
  trainPredictions: number;
  holdoutPredictions: number;
};

export type TuningChange = { field: FittableTuningField; from: number; to: number };

export type TuningFit = {
  baseline: LearningTuning;
  fitted: LearningTuning;
  baselineScore: TuningScore;
  fittedScore: TuningScore;
  changes: TuningChange[];
  splitAt: number;
  /** Whether the held-back part is big enough for its error to mean anything. */
  sufficient: boolean;
};

function mean(values: readonly number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function meanSquaredError(predictions: readonly LearnerModelPrediction[]) {
  return mean(predictions.map((p) => (p.predictedMastery - p.outcome) ** 2));
}

/**
 * The moment that leaves `trainFraction` of the predictions behind it.
 *
 * Split on predictions rather than on observations: the whole history is
 * replayed either way, so a prediction late in the fitted part and one early in
 * the held-back part are built the same way, and nothing in the held-back part
 * starts from a standing start it would never have had in life.
 */
export function splitTimeForPredictions(
  predictions: readonly LearnerModelPrediction[],
  trainFraction = DEFAULT_TRAIN_FRACTION
) {
  if (predictions.length === 0) return Number.POSITIVE_INFINITY;
  const times = predictions.map((p) => p.at).sort((left, right) => left - right);
  const index = Math.min(
    times.length - 1,
    Math.max(0, Math.floor(times.length * Math.min(1, Math.max(0, trainFraction))))
  );
  return times[index] as number;
}

export function scoreTuning(
  observations: readonly LearningObservation[],
  tuning: LearningTuning,
  splitAt: number
): TuningScore {
  const predictions = replayLearnerModelPredictions(observations, tuning);
  const train = predictions.filter((p) => p.at < splitAt);
  const holdout = predictions.filter((p) => p.at >= splitAt);
  return {
    trainMse: meanSquaredError(train),
    holdoutMse: meanSquaredError(holdout),
    trainPredictions: train.length,
    holdoutPredictions: holdout.length,
  };
}

/**
 * Coordinate descent over the fittable fields.
 *
 * One field at a time, each candidate tried and the best kept, repeated until a
 * pass changes nothing. Chosen over anything cleverer because the grid is small
 * and the objective is cheap, and because every step it takes can be printed
 * and argued with.
 */
export function fitLearningTuning(
  observations: readonly LearningObservation[],
  options: {
    baseline?: LearningTuning;
    trainFraction?: number;
    passes?: number;
    minHoldoutPredictions?: number;
    minRelativeImprovement?: number;
  } = {}
): TuningFit {
  const baseline = options.baseline ?? DEFAULT_LEARNING_TUNING;
  const passes = options.passes ?? DEFAULT_FIT_PASSES;
  const splitAt = splitTimeForPredictions(
    replayLearnerModelPredictions(observations, baseline),
    options.trainFraction ?? DEFAULT_TRAIN_FRACTION
  );

  const baselineScore = scoreTuning(observations, baseline, splitAt);
  const margin = options.minRelativeImprovement ?? MIN_RELATIVE_IMPROVEMENT;
  let best = baseline;
  let bestMse = baselineScore.trainMse ?? Number.POSITIVE_INFINITY;

  for (let pass = 0; pass < passes; pass += 1) {
    let improved = false;
    for (const field of FITTABLE_TUNING_FIELDS) {
      for (const candidate of TUNING_SEARCH_GRID[field]) {
        if (candidate === best[field]) continue;
        const trial = { ...best, [field]: candidate };
        const mse = scoreTuning(observations, trial, splitAt).trainMse;
        // Measured against the value being replaced, so a run of tiny gains
        // cannot add up to a change no single step earned.
        if (mse !== null && mse < bestMse * (1 - margin)) {
          best = trial;
          bestMse = mse;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const fittedScore = scoreTuning(observations, best, splitAt);
  const changes = FITTABLE_TUNING_FIELDS.flatMap((field) =>
    best[field] === baseline[field] ? [] : [{ field, from: baseline[field], to: best[field] }]
  );

  return {
    baseline,
    fitted: best,
    baselineScore,
    fittedScore,
    changes,
    splitAt,
    sufficient: fittedScore.holdoutPredictions >= (options.minHoldoutPredictions ?? 30),
  };
}
