import { countUniqueItems } from "@/lib/learning/scoring/item-weights";
import { weightedAccuracy } from "@/lib/learning/scoring/mastery-score";
import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";
import type { LearningEvidenceKind, LearningObservation, LearningTrend } from "@/lib/learning/types";

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

/**
 * Which evidence may share a trend window: recall with recall, application
 * with application. Notebook working sits apart from both, as it does
 * everywhere else.
 */
const TREND_GROUP: Record<LearningEvidenceKind, "recall" | "application" | "notebook"> = {
  flashcards: "recall",
  "past-paper": "application",
  practice: "application",
  notebook: "notebook",
  // Marked by a model like notebook working, so it shares that window rather
  // than either scheme-marked one.
  revision: "notebook",
};

/**
 * A topic's trend, measured within one kind of evidence at a time.
 *
 * One window across every kind compares unlike things. A student who drilled
 * a topic on flashcards last month and has sat exam questions on it this week
 * has a "recent" window of exam answers and a "previous" window of card
 * reviews; exam questions are harder than recall, so the topic reads as
 * declining when nothing has declined -- the student has simply moved on to
 * harder work. That misreading turned the clearest recall-versus-application
 * case into "you are forgetting this".
 *
 * So each kind is measured on its own, and the topic takes the most urgent
 * reading any kind can support: a decline in any kind is a decline, else an
 * improvement, else stable. A kind with too little dated history is simply
 * not measured, as before; an unknown trend is still better than a wrong one.
 */
export function measureTrendWithinKinds(
  observations: readonly (Pick<
    LearningObservation,
    "kind" | "score" | "weight" | "at" | "itemId" | "trendEligible"
  > & { share?: number })[],
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
): TrendMeasurement | null {
  const groups = new Map<string, (typeof observations)[number][]>();
  for (const observation of observations) {
    const group = TREND_GROUP[observation.kind];
    const list = groups.get(group) ?? [];
    list.push(observation);
    groups.set(group, list);
  }
  const measured = Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, group]) => {
      const trend = measureTrend(group, tuning);
      return trend ? [trend] : [];
    });
  const change = (trend: TrendMeasurement) => trend.recentAccuracy - trend.previousAccuracy;
  const declining = measured.filter((trend) => trend.trend === "declining");
  if (declining.length > 0) {
    return declining.reduce((worst, trend) => (change(trend) < change(worst) ? trend : worst));
  }
  const improving = measured.filter((trend) => trend.trend === "improving");
  if (improving.length > 0) {
    return improving.reduce((best, trend) => (change(trend) > change(best) ? trend : best));
  }
  return measured[0] ?? null;
}
