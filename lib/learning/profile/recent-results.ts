import type {
  LearningObservation,
  LearningRecentOutcome,
  LearningRecentResult,
  LearningTopicState,
} from "@/lib/learning/types";

/**
 * What the student got right and wrong lately, item by item.
 *
 * The profile's topic numbers say "chemistry calculations: 45%"; a tutor who
 * remembers a student says "you've missed the limiting-reagent card three times
 * this week". This keeps the individual items -- a card, a practice question,
 * a past-paper question -- with how the latest attempt went, so Tutor can name
 * the thing rather than the topic. Wrong answers are listed before right ones:
 * what a student keeps getting wrong is what the next answer should change.
 *
 * Deterministic and wordless: ids, scores, times, topic keys and the fixed
 * error vocabulary. Showing the words of an item is the caller's job, and only
 * for material the student may see in a prompt (see the Tutor loader).
 */

export const RECENT_RESULTS_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
export const RECENT_RESULTS_LIMITS = { missed: 8, partial: 4, correct: 3 } as const;

const MISSED_BELOW = 0.5;
const CORRECT_FROM = 0.85;

function outcomeOf(score: number): LearningRecentOutcome {
  if (score < MISSED_BELOW) return "missed";
  return score >= CORRECT_FROM ? "correct" : "partial";
}

/** The most specific labelled topic among an item's keys, which include every ancestor. */
function topicOf(keys: readonly string[], topics: ReadonlyMap<string, LearningTopicState>) {
  const known = keys.filter((key) => topics.has(key));
  const leaves = known.filter((key) => !known.some((other) => topics.get(other)?.parentKey === key));
  const key = leaves[0] ?? known[0];
  return key ? { topicKey: key, topicLabel: topics.get(key)?.label } : {};
}

export function selectRecentResults(input: {
  observations: readonly LearningObservation[];
  topics: readonly LearningTopicState[];
  now: number;
}): LearningRecentResult[] {
  const since = input.now - RECENT_RESULTS_WINDOW_MS;
  const topics = new Map(input.topics.map((topic) => [topic.topicKey, topic]));
  const byItem = new Map<string, LearningObservation[]>();
  for (const observation of input.observations) {
    // A card read from its scheduler state has no dated answer to show.
    if (observation.at < since || observation.at > input.now + 60_000) continue;
    if (observation.kind === "flashcards" && !observation.trendEligible) continue;
    const list = byItem.get(observation.itemId) ?? [];
    list.push(observation);
    byItem.set(observation.itemId, list);
  }

  const results = [...byItem.values()].map((list): LearningRecentResult => {
    const ordered = [...list].sort((left, right) => right.at - left.at);
    const latest = ordered[0];
    return {
      kind: latest.kind,
      itemId: latest.itemId,
      ...topicOf(latest.topicKeys, topics),
      outcome: outcomeOf(latest.score),
      score: latest.score,
      at: latest.at,
      attempts: ordered.length,
      misses: ordered.filter((observation) => observation.score < MISSED_BELOW).length,
      missedErrors: Array.from(
        new Set(latest.errorChecks.filter((check) => check.missed).map((check) => check.category))
      ),
    };
  });

  const pick = (outcome: LearningRecentOutcome, limit: number) =>
    results
      .filter((result) => result.outcome === outcome)
      .sort(
        (left, right) =>
          right.misses - left.misses || right.at - left.at || left.itemId.localeCompare(right.itemId)
      )
      .slice(0, limit);

  return [
    ...pick("missed", RECENT_RESULTS_LIMITS.missed),
    ...pick("partial", RECENT_RESULTS_LIMITS.partial),
    ...pick("correct", RECENT_RESULTS_LIMITS.correct),
  ];
}
