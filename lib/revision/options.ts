import type { LearningRecommendation, LearningTopicState } from "@/lib/learning/types";

/**
 * What a student can start a Revision Session on, in one folder.
 *
 * The folder's own concepts and nothing else: its specification concepts,
 * grouped under the headings the board prints, and the student's own Topics.
 * Every one is a concept the Learning Engine already knows, which is what lets
 * a session on it count as evidence. Free text comes later, and when it does it
 * has to resolve to one of these to count.
 */

export type RevisionConceptOption = {
  topicKey: string;
  label: string;
  source: "specification" | "student-topic";
  /** The heading it sits under, for a specification concept. */
  group?: string;
  /** The engine has decided this needs work. */
  suggested: boolean;
  /** Cards the student already has on it. */
  cards: number;
};

/** The most offered as "Jami suggests"; past this it is a list, not a suggestion. */
const MAX_SUGGESTED = 4;
/** Decisions that mean "work on this". */
const NEEDS_WORK = new Set(["diagnose", "teach", "practice", "reinforce", "retrieve", "review"]);

export function buildRevisionOptions(input: {
  topics: readonly LearningTopicState[];
  recommendedFocus: readonly LearningRecommendation[];
  /** Specification heading labels, by their `spec:` key. */
  headings: ReadonlyMap<string, string>;
}): RevisionConceptOption[] {
  const focusOrder = new Map<string, number>();
  input.recommendedFocus.forEach((recommendation, index) => {
    if (recommendation.target.kind === "topic" && !focusOrder.has(recommendation.target.topicKey)) {
      focusOrder.set(recommendation.target.topicKey, index);
    }
  });

  const candidates = input.topics.filter(
    (topic): topic is LearningTopicState & { source: "specification" | "student-topic" } =>
      topic.declared &&
      (topic.source === "specification" || topic.source === "student-topic") &&
      topic.label.trim().length > 0
  );

  const suggestedKeys = new Set(
    candidates
      .filter((topic) => topic.decision && NEEDS_WORK.has(topic.decision.action))
      .sort(
        (left, right) =>
          (focusOrder.get(left.topicKey) ?? Number.MAX_SAFE_INTEGER) -
          (focusOrder.get(right.topicKey) ?? Number.MAX_SAFE_INTEGER)
      )
      .slice(0, MAX_SUGGESTED)
      .map((topic) => topic.topicKey)
  );

  return candidates
    .map((topic) => {
      const group =
        topic.source === "specification" && topic.parentKey
          ? input.headings.get(topic.parentKey)
          : undefined;
      return {
        topicKey: topic.topicKey,
        label: topic.label.trim(),
        source: topic.source,
        ...(group ? { group } : {}),
        suggested: suggestedKeys.has(topic.topicKey),
        cards: topic.exposure.cards,
      };
    })
    .sort((left, right) => {
      if (left.suggested !== right.suggested) return left.suggested ? -1 : 1;
      if (left.suggested) {
        return (
          (focusOrder.get(left.topicKey) ?? Number.MAX_SAFE_INTEGER) -
          (focusOrder.get(right.topicKey) ?? Number.MAX_SAFE_INTEGER)
        );
      }
      // Specification concepts first, in the board's own heading order as given.
      if (left.source !== right.source) return left.source === "specification" ? -1 : 1;
      return 0;
    });
}

/**
 * A neighbour worth a session next: under the same heading, or another of the
 * student's own Topics, that the engine marks as needing work.
 *
 * Structure the board printed or the student made -- never one a model
 * inferred.
 */
export function pickRevisionNeighbour(
  options: readonly RevisionConceptOption[],
  target: { topicKey: string }
): RevisionConceptOption | undefined {
  const self = options.find((option) => option.topicKey === target.topicKey);
  if (!self) return undefined;
  return options.find(
    (option) =>
      option.topicKey !== self.topicKey &&
      option.suggested &&
      option.source === self.source &&
      (self.source === "student-topic" || (self.group !== undefined && option.group === self.group))
  );
}
