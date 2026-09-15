import { evidenceConfidence } from "@/lib/learning/scoring/confidence-score";
import { countUniqueItems } from "@/lib/learning/scoring/item-weights";
import { weightedAccuracy } from "@/lib/learning/scoring/mastery-score";
import type { LearningCommandWordSignal, LearningObservation } from "@/lib/learning/types";

/**
 * How a student does on each kind of instruction: "Explain", "Show that".
 *
 * Accuracy and confidence only, and only where enough different questions ask
 * it. The claim this supports -- "loses marks when asked to show something" --
 * is about a pattern across questions, so one question answered again and
 * again is not evidence of it, and a word seen twice is not a pattern.
 */

/** Different questions a command word needs before it describes anything. */
export const MIN_COMMAND_WORD_ITEMS = 3;
export const COMMAND_WORD_SIGNAL_LIMIT = 6;

export function buildCommandWordSignals(
  observations: readonly LearningObservation[],
  now: number
): LearningCommandWordSignal[] {
  const byWord = new Map<string, LearningObservation[]>();
  for (const observation of observations) {
    if (!observation.commandWord) continue;
    const list = byWord.get(observation.commandWord) ?? [];
    list.push(observation);
    byWord.set(observation.commandWord, list);
  }

  const signals: LearningCommandWordSignal[] = [];
  for (const [commandWord, list] of byWord) {
    const uniqueItems = countUniqueItems(list);
    if (uniqueItems < MIN_COMMAND_WORD_ITEMS) continue;
    signals.push({
      commandWord,
      attempts: list.reduce((total, observation) => total + observation.count, 0),
      uniqueItems,
      accuracy: weightedAccuracy(list),
      confidence: evidenceConfidence(list, now),
      lastSeenAt: list.reduce((latest, observation) => Math.max(latest, observation.at), 0),
    });
  }

  const cost = (signal: LearningCommandWordSignal) => (1 - signal.accuracy) * signal.confidence;
  return signals
    .sort(
      (left, right) =>
        cost(right) - cost(left) ||
        right.lastSeenAt - left.lastSeenAt ||
        left.commandWord.localeCompare(right.commandWord)
    )
    .slice(0, COMMAND_WORD_SIGNAL_LIMIT);
}
