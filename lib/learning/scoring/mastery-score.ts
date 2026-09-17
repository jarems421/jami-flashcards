import { capItemWeights, evidenceShare } from "@/lib/learning/scoring/item-weights";
import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";
import type { LearningObservation } from "@/lib/learning/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How quickly old evidence fades. See `tuning.ts` for why it is set where it is. */
export const MASTERY_RECENCY_HALF_LIFE_DAYS = DEFAULT_LEARNING_TUNING.masteryRecencyHalfLifeDays;

/**
 * Where an estimate starts before there is evidence, and how many answers'
 * worth of weight that starting point carries. See `tuning.ts`.
 */
export const MASTERY_PRIOR = DEFAULT_LEARNING_TUNING.masteryPrior;
export const MASTERY_PRIOR_WEIGHT = DEFAULT_LEARNING_TUNING.masteryPriorWeight;

type ScoredObservation = Pick<
  LearningObservation,
  "itemId" | "score" | "weight" | "at"
> & { share?: number; currentEstimate?: boolean };

export function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 1 for work done now, 0.5 at one half-life old. Future timestamps count as now. */
export function recencyWeight(
  at: number,
  now: number,
  halfLifeDays = MASTERY_RECENCY_HALF_LIFE_DAYS
) {
  const ageDays = Math.max(0, (now - at) / DAY_MS);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Recency-weighted accuracy, shrunk towards the prior by how little evidence
 * there is, with each item's repetitions capped and each answer counted for the
 * share of it that is about this concept.
 */
export function masteryScore(
  observations: readonly ScoredObservation[],
  now: number,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
) {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const observation of capItemWeights(observations, tuning)) {
    // A score that is already an estimate of now carries its own decay model.
    const age = observation.currentEstimate
      ? 1
      : recencyWeight(observation.at, now, tuning.masteryRecencyHalfLifeDays);
    const weight = Math.max(0, observation.weight) * evidenceShare(observation) * age;
    weightedScore += weight * clampUnit(observation.score);
    totalWeight += weight;
  }
  return (
    (weightedScore + tuning.masteryPrior * tuning.masteryPriorWeight) /
    (totalWeight + tuning.masteryPriorWeight)
  );
}

/**
 * Plain weighted accuracy: no prior, no recency, repetitions still capped.
 *
 * What a student would call their score over a set of answers. Mastery is the
 * estimate; this is the record.
 */
export function weightedAccuracy(
  observations: readonly (Pick<LearningObservation, "itemId" | "score" | "weight"> & { share?: number })[],
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
) {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const observation of capItemWeights(observations, tuning)) {
    const weight = Math.max(0, observation.weight) * evidenceShare(observation);
    weightedScore += weight * clampUnit(observation.score);
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedScore / totalWeight : 0;
}
