import { evidenceShare } from "@/lib/learning/scoring/item-weights";
import { recencyWeight } from "@/lib/learning/scoring/mastery-score";
import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * How many answers' worth of recent evidence it takes to be fairly sure.
 * See `tuning.ts` for why it is set where it is.
 */
export const CONFIDENCE_EVIDENCE_SCALE = DEFAULT_LEARNING_TUNING.confidenceEvidenceScale;

export type ConfidenceLabel = "low" | "medium" | "high";

export function confidenceFromEvidence(
  amount: number,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return 1 - Math.exp(-amount / tuning.confidenceEvidenceScale);
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
  observations: readonly (Pick<LearningObservation, "itemId" | "weight" | "at"> & {
    share?: number;
    /**
     * Accepted and deliberately ignored, unlike in `masteryScore`.
     *
     * A score from the scheduler's fitted memory is about now, so mastery must
     * not fade it for age. How *much* evidence stands behind it is a different
     * question with a different answer: those reviews still happened when they
     * happened, and reviews from two years ago are thin evidence about a
     * student today however durable the memory they left.
     */
    currentEstimate?: boolean;
  })[],
  now: number,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
) {
  const perItem = new Map<string, { units: number; share: number }>();
  for (const observation of observations) {
    const unit =
      Math.min(1, Math.max(0, observation.weight)) *
      recencyWeight(observation.at, now, tuning.masteryRecencyHalfLifeDays);
    const entry = perItem.get(observation.itemId) ?? { units: 0, share: 0 };
    entry.units += unit;
    entry.share = Math.max(entry.share, evidenceShare(observation));
    perItem.set(observation.itemId, entry);
  }
  let amount = 0;
  for (const { units, share } of perItem.values()) {
    amount += Math.min(tuning.maxEvidencePerItem, units) * share;
  }
  return confidenceFromEvidence(amount, tuning);
}

export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}
