import { countUniqueItems } from "@/lib/learning/scoring/item-weights";
import { weightedAccuracy } from "@/lib/learning/scoring/mastery-score";
import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";
import type { LearningObservation, LearningTrend } from "@/lib/learning/types";

/** Each window needs at least this many answers, on this many different items, before a trend is claimed. */
export const TREND_MIN_PER_WINDOW = 3;
/** The recent window is at most this many answers, so an old run of work cannot hide a recent change. */
export const TREND_MAX_WINDOW = 10;
/** A change smaller than this, in accuracy, is noise rather than a trend. See `tuning.ts`. */
export const TREND_THRESHOLD = DEFAULT_LEARNING_TUNING.trendThreshold;

export type TrendMeasurement = {
  trend: LearningTrend;
  recentAccuracy: number;
  previousAccuracy: number;
};

export function classifyTrend(
  recent: number,
  previous: number,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
): LearningTrend {
  const change = recent - previous;
  if (change >= tuning.trendThreshold) return "improving";
  if (change <= -tuning.trendThreshold) return "declining";
  return "stable";
}

/**
 * The latest answers against the same number of answers before them.
 *
 * Only trend-eligible observations take part, and nothing is returned below
 * two full windows or when either window is really one item answered
 * repeatedly: an unknown trend is an honest answer, a guessed one is not.
 */
export function measureTrend(
  observations: readonly (Pick<
    LearningObservation,
    "score" | "weight" | "at" | "itemId" | "trendEligible"
  > & { share?: number })[],
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
): TrendMeasurement | null {
  const ordered = observations
    .filter((observation) => observation.trendEligible)
    .sort((left, right) => left.at - right.at || left.itemId.localeCompare(right.itemId));
  if (ordered.length < TREND_MIN_PER_WINDOW * 2) return null;

  const windowSize = Math.min(TREND_MAX_WINDOW, Math.floor(ordered.length / 2));
  const recent = ordered.slice(-windowSize);
  const previous = ordered.slice(-windowSize * 2, -windowSize);
  if (
    countUniqueItems(recent) < TREND_MIN_PER_WINDOW ||
    countUniqueItems(previous) < TREND_MIN_PER_WINDOW
  ) {
    return null;
  }
  const recentAccuracy = weightedAccuracy(recent, tuning);
  const previousAccuracy = weightedAccuracy(previous, tuning);
  return {
    trend: classifyTrend(recentAccuracy, previousAccuracy, tuning),
    recentAccuracy,
    previousAccuracy,
  };
}
