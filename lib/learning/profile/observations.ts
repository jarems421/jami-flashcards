import { isValidEvidenceTime } from "@/lib/learning/evidence-time";
import type { LearningObservation } from "@/lib/learning/types";

function compareObservations(left: LearningObservation, right: LearningObservation) {
  return (
    left.at - right.at ||
    left.kind.localeCompare(right.kind) ||
    left.itemId.localeCompare(right.itemId) ||
    left.evidenceId.localeCompare(right.evidenceId)
  );
}

/**
 * Observations the engine can trust, in one canonical order.
 *
 * Malformed records are dropped rather than repaired: a timestamp that is not
 * a real study time, a non-finite score, a weightless answer. A future
 * timestamp (a device clock running ahead) is clamped to now. The same stored
 * record reaching the engine twice counts once.
 *
 * The order matters as much as the filtering. Every later sum runs in this
 * order, so the profile is identical however Firestore happened to return the
 * documents -- and consumers that show a ranked list never see it reshuffle
 * between two requests over the same evidence.
 */
export function canonicalizeObservations(
  observations: readonly LearningObservation[],
  now: number
): { observations: LearningObservation[]; dropped: number } {
  const valid = observations
    .filter(
      (observation) =>
        isValidEvidenceTime(observation.at) &&
        Number.isFinite(observation.score) &&
        Number.isFinite(observation.weight) &&
        observation.weight > 0 &&
        Boolean(observation.evidenceId) &&
        Boolean(observation.itemId)
    )
    .map((observation) => (observation.at > now ? { ...observation, at: now } : observation))
    .sort(compareObservations);

  const seen = new Set<string>();
  const kept: LearningObservation[] = [];
  for (const observation of valid) {
    const key = `${observation.kind}:${observation.evidenceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(observation);
  }
  return { observations: kept, dropped: observations.length - kept.length };
}

/** An observation as one concept sees it: `share` is how much of the answer is about that concept. */
export type TopicObservation = LearningObservation & { share?: number };

/**
 * Observations under every concept they count towards, each carrying its share
 * of that concept. The profile and its evaluation both group through here, so
 * a mixed answer weighs the same in each.
 */
export function groupObservationsByTopic(
  observations: readonly LearningObservation[]
): Map<string, TopicObservation[]> {
  const byTopic = new Map<string, TopicObservation[]>();
  for (const observation of observations) {
    for (const topicKey of new Set(observation.topicKeys)) {
      const share = observation.topicShares?.[topicKey];
      const list = byTopic.get(topicKey) ?? [];
      list.push(share === undefined || share >= 1 ? observation : { ...observation, share });
      byTopic.set(topicKey, list);
    }
  }
  return byTopic;
}
