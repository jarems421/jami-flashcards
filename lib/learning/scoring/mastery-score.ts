import { capItemWeights, evidenceShare } from "@/lib/learning/scoring/item-weights";
import type { LearningObservation } from "@/lib/learning/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How quickly old evidence fades. Forty-five days keeps last term's work
 * relevant while letting this month's outweigh it; a year-old answer still
 * counts, just for very little.
 */
export const MASTERY_RECENCY_HALF_LIFE_DAYS = 45;

/**
 * Where an estimate starts before there is evidence, and how many answers'
 * worth of weight that starting point carries.
 *
 * Without it one wrong answer is 0% mastery and one right answer is 100%. The
 * prior pulls thin evidence towards the middle, so a topic only reads as very
 * weak or very strong once enough work says so.
 */
export const MASTERY_PRIOR = 0.5;
export const MASTERY_PRIOR_WEIGHT = 1.5;

type ScoredObservation = Pick<LearningObservation, "itemId" | "score" | "weight" | "at"> & { share?: number };

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
export function masteryScore(observations: readonly ScoredObservation[], now: number) {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const observation of capItemWeights(observations)) {
    const weight =
      Math.max(0, observation.weight) * evidenceShare(observation) * recencyWeight(observation.at, now);
    weightedScore += weight * clampUnit(observation.score);
    totalWeight += weight;
  }
  return (
    (weightedScore + MASTERY_PRIOR * MASTERY_PRIOR_WEIGHT) /
    (totalWeight + MASTERY_PRIOR_WEIGHT)
  );
}

/**
 * Plain weighted accuracy: no prior, no recency, repetitions still capped.
 *
 * What a student would call their score over a set of answers. Mastery is the
 * estimate; this is the record.
 */
export function weightedAccuracy(
  observations: readonly (Pick<LearningObservation, "itemId" | "score" | "weight"> & { share?: number })[]
) {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const observation of capItemWeights(observations)) {
    const weight = Math.max(0, observation.weight) * evidenceShare(observation);
    weightedScore += weight * clampUnit(observation.score);
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedScore / totalWeight : 0;
}
