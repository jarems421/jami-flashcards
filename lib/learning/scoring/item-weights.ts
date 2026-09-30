import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * The most one item -- a card, a question -- can count for, as a multiple of
 * its single heaviest answer. See `tuning.ts` for why it is set where it is.
 */
export const MAX_EVIDENCE_PER_ITEM = DEFAULT_LEARNING_TUNING.maxEvidencePerItem;

/**
 * The part of an answer that is about the concept being scored, 0 to 1.
 *
 * An answer testing two concepts is half the evidence about each. Missing, it
 * is the whole answer.
 */
export function evidenceShare(observation: { share?: number }) {
  const share = observation.share;
  return typeof share === "number" && Number.isFinite(share) && share > 0 ? Math.min(1, share) : 1;
}

/**
 * What this answer counts for, given where it came from.
 *
 * Applied here rather than inside each source module so there is one place
 * that decides how much a kind of evidence is trusted, and so a new source
 * cannot quietly arrive at full strength by forgetting to scale itself.
 * An observation with no recognised kind keeps its own weight.
 */
export function sourceWeight<T extends Pick<LearningObservation, "weight"> & { kind?: string }>(
  observation: T,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
) {
  const kind = observation.kind as keyof LearningTuning["evidenceSourceWeight"] | undefined;
  const multiplier = kind ? tuning.evidenceSourceWeight[kind] : undefined;
  return Math.max(0, observation.weight) * (typeof multiplier === "number" ? multiplier : 1);
}

/**
 * Scales down each item's observations, proportionally, so no item exceeds the
 * cap, after each has been weighted for the source it came from.
 */
export function capItemWeights<T extends Pick<LearningObservation, "itemId" | "weight">>(
  observations: readonly T[],
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
): T[] {
  const scaled = observations.map((observation) => {
    const weight = sourceWeight(observation, tuning);
    return weight === observation.weight ? observation : { ...observation, weight };
  });
  const totals = new Map<string, { total: number; heaviest: number }>();
  for (const observation of scaled) {
    const weight = Math.max(0, observation.weight);
    const entry = totals.get(observation.itemId) ?? { total: 0, heaviest: 0 };
    entry.total += weight;
    entry.heaviest = Math.max(entry.heaviest, weight);
    totals.set(observation.itemId, entry);
  }
  return scaled.map((observation) => {
    const entry = totals.get(observation.itemId);
    if (!entry || entry.total <= 0) return observation;
    const cap = entry.heaviest * tuning.maxEvidencePerItem;
    if (entry.total <= cap) return observation;
    return { ...observation, weight: Math.max(0, observation.weight) * (cap / entry.total) };
  });
}

export function countUniqueItems(observations: readonly Pick<LearningObservation, "itemId">[]) {
  return new Set(observations.map((observation) => observation.itemId)).size;
}
