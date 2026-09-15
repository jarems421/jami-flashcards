import "server-only";

import {
  replayLearnerModelPredictions,
  summarizeLearnerModelEvaluation,
  type LearnerModelEvaluation,
} from "@/lib/learning/evaluation/learner-model-evaluation";
import { collectLearnerObservations } from "@/lib/learning/profile/build-learner-profile";
import { loadLearnerEvidence } from "@/services/learning/learner-profile.server";

/**
 * How well the learner model has predicted one student's own answers, in one
 * folder or deck.
 *
 * Built from the same bounded evidence the profile reads, so it measures the
 * model the student actually gets -- over their recent history, not all of it.
 * Aggregate numbers only; nothing about what was studied.
 */
export async function evaluateLearnerModel(input: {
  uid: string;
  folderId?: string;
  deckId?: string;
  now?: number;
}): Promise<LearnerModelEvaluation | null> {
  const now = input.now ?? Date.now();
  const loaded = await loadLearnerEvidence(input);
  if (!loaded) return null;
  const { observations } = collectLearnerObservations(loaded.evidence, now);
  return summarizeLearnerModelEvaluation(replayLearnerModelPredictions(observations));
}
