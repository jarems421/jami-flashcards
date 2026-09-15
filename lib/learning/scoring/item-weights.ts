import type { LearningObservation } from "@/lib/learning/types";

/**
 * The most one item -- a card, a question -- can count for, as a multiple of
 * its single heaviest answer.
 *
 * Retrying a question, or reviewing the same card every day for a month, is
 * not that many independent pieces of evidence about a topic. At 1.5 a
 * past-paper question plus its guided retry (which counts half) sits exactly at
 * the cap, so the cap only bites on genuine repetition.
 */
export const MAX_EVIDENCE_PER_ITEM = 1.5;

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

/** Scales down each item's observations, proportionally, so no item exceeds the cap. */
export function capItemWeights<T extends Pick<LearningObservation, "itemId" | "weight">>(
  observations: readonly T[]
): T[] {
  const totals = new Map<string, { total: number; heaviest: number }>();
  for (const observation of observations) {
    const weight = Math.max(0, observation.weight);
    const entry = totals.get(observation.itemId) ?? { total: 0, heaviest: 0 };
    entry.total += weight;
    entry.heaviest = Math.max(entry.heaviest, weight);
    totals.set(observation.itemId, entry);
  }
  return observations.map((observation) => {
    const entry = totals.get(observation.itemId);
    if (!entry || entry.total <= 0) return observation;
    const cap = entry.heaviest * MAX_EVIDENCE_PER_ITEM;
    if (entry.total <= cap) return observation;
    return { ...observation, weight: Math.max(0, observation.weight) * (cap / entry.total) };
  });
}

export function countUniqueItems(observations: readonly Pick<LearningObservation, "itemId">[]) {
  return new Set(observations.map((observation) => observation.itemId)).size;
}
