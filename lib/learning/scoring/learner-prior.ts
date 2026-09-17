import { evidenceConfidence } from "@/lib/learning/scoring/confidence-score";
import { masteryScore } from "@/lib/learning/scoring/mastery-score";
import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Where a topic's estimate should start, given how this student does generally.
 *
 * A flat 0.5 treats every topic of every student as a coin toss until proven
 * otherwise, so a student running at 85% across a folder still has each thin
 * topic dragged to the middle, and one at 40% has each thin topic flattered.
 * Neither is what the evidence says. Pooling a topic towards the student's own
 * scope-wide mean is the standard correction, and it is most of what makes a
 * thin estimate reasonable rather than merely cautious.
 *
 * It is bounded by how much the scope itself shows: with no evidence at all the
 * prior is exactly the neutral 0.5 it always was, so nothing changes for a
 * student who has just arrived, and the shift in is gradual rather than a
 * threshold nobody could feel themselves cross.
 */
export function learnerPrior(
  observations: readonly LearningObservation[],
  now: number,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
) {
  const strength = Math.min(1, Math.max(0, tuning.studentPriorStrength));
  if (strength === 0 || observations.length === 0) return tuning.masteryPrior;
  const scopeMean = masteryScore(observations, now, tuning);
  const scopeConfidence = evidenceConfidence(observations, now, tuning);
  return tuning.masteryPrior + (scopeMean - tuning.masteryPrior) * scopeConfidence * strength;
}

/** `tuning`, with the prior replaced by what this student's own work suggests. */
export function tuningWithLearnerPrior(
  observations: readonly LearningObservation[],
  now: number,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
): LearningTuning {
  return { ...tuning, masteryPrior: learnerPrior(observations, now, tuning) };
}
