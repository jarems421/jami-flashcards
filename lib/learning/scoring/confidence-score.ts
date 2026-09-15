import { MAX_EVIDENCE_PER_ITEM, evidenceShare } from "@/lib/learning/scoring/item-weights";
import { recencyWeight } from "@/lib/learning/scoring/mastery-score";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * How many answers' worth of recent evidence it takes to be fairly sure.
 *
 * With a scale of six, three answers give about 39% confidence, seventeen give
 * about 94%, and eighty give effectively certain. "33% from 3 questions" and
 * "58% across 84" should not read as the same kind of claim, and this is the
 * number that tells them apart.
 */
export const CONFIDENCE_EVIDENCE_SCALE = 6;

export type ConfidenceLabel = "low" | "medium" | "high";

export function confidenceFromEvidence(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return 1 - Math.exp(-amount / CONFIDENCE_EVIDENCE_SCALE);
}

/**
 * Confidence in an estimate built from these observations.
 *
 * Each observation contributes at most one unit (a flashcard reviewed once
 * contributes a third of one), faded by age, and each item is capped -- so
 * breadth of evidence builds confidence and repetition of one item cannot.
 * The cap comes first and the share second: an item that tests two concepts
 * is half the evidence about each however often it was answered.
 */
export function evidenceConfidence(
  observations: readonly (Pick<LearningObservation, "itemId" | "weight" | "at"> & { share?: number })[],
  now: number
) {
  const perItem = new Map<string, { units: number; share: number }>();
  for (const observation of observations) {
    const unit =
      Math.min(1, Math.max(0, observation.weight)) * recencyWeight(observation.at, now);
    const entry = perItem.get(observation.itemId) ?? { units: 0, share: 0 };
    entry.units += unit;
    entry.share = Math.max(entry.share, evidenceShare(observation));
    perItem.set(observation.itemId, entry);
  }
  let amount = 0;
  for (const { units, share } of perItem.values()) {
    amount += Math.min(MAX_EVIDENCE_PER_ITEM, units) * share;
  }
  return confidenceFromEvidence(amount);
}

export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}
