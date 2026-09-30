import "server-only";

import {
  replayLearnerModelPredictions,
  summarizeLearnerModelEvaluation,
  type LearnerModelEvaluation,
} from "@/lib/learning/evaluation/learner-model-evaluation";
import {
  measureInterventionEffect,
  type InterventionEffect,
} from "@/lib/learning/evaluation/intervention-effect";
import { collectLearnerObservations } from "@/lib/learning/profile/build-learner-profile";
import { loadLearnerEvidence } from "@/services/learning/learner-profile.server";
import { loadStudyActionEvents } from "@/services/learning/study-action-history.server";

/**
 * How well the learner model has predicted one student's own answers, in one
 * folder or deck.
 *
 * Built from the same bounded evidence the profile reads, so it measures the
 * model the student actually gets -- over their recent history, not all of it.
 * Two numbers, deliberately separate. The calibration says whether the model
 * predicts this student's answers. The intervention effect says whether taking
 * its advice was associated with getting better -- which a well-calibrated
 * model that recommends useless work would fail while scoring perfectly.
 *
 * Aggregate numbers only; nothing about what was studied.
 */
export async function evaluateLearnerModel(input: {
  uid: string;
  folderId?: string;
  deckId?: string;
  now?: number;
}): Promise<{
  evaluation: LearnerModelEvaluation;
  intervention: InterventionEffect;
} | null> {
  const now = input.now ?? Date.now();
  const [loaded, events] = await Promise.all([
    loadLearnerEvidence(input),
    loadStudyActionEvents({ uid: input.uid }),
  ]);
  if (!loaded) return null;
  const { observations } = collectLearnerObservations(loaded.evidence, now);
  return {
    evaluation: summarizeLearnerModelEvaluation(replayLearnerModelPredictions(observations)),
    /*
     * Asked of the same observations the calibration uses, so the two numbers
     * describe one body of evidence. They answer different questions: whether
     * the model predicts, and whether acting on what it says is worth doing.
     */
    intervention: measureInterventionEffect(events, observations, now),
  };
}
