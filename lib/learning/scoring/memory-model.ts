import { default_w, forgetting_curve } from "ts-fsrs";
import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";

/**
 * What the scheduler's own memory model says a card is worth as evidence.
 *
 * The scheduler already fits a memory for every card -- `stability` is the
 * number of days until recall falls to 90% -- and until now the profile threw
 * that away and re-estimated recall from the lapse rate instead. This reads the
 * fitted model directly, which is both better grounded and consistent with the
 * scheduling the student actually experiences.
 *
 * Read a short way ahead rather than at this instant, because "can they recall
 * it right now" is 1.0 for every card reviewed today, whether its stability is
 * one day or two hundred. See `masteryHorizonDays` in `tuning.ts`.
 *
 * Note what this replaces: an exponential half-life. FSRS forgetting is a power
 * law and much flatter -- at ten times a card's stability recall is still near
 * 0.69, where a 45-day half-life would have written the same evidence off
 * almost entirely. A score from here has already accounted for the passage of
 * time, so the generic recency weight must not be applied on top of it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type MemoryModelCard = {
  stability?: number;
  lastReview?: number;
};

/** A card the scheduler has a fitted memory for, as opposed to one from before FSRS. */
export function hasMemoryModel(card: MemoryModelCard) {
  return (
    typeof card.stability === "number" &&
    Number.isFinite(card.stability) &&
    card.stability > 0 &&
    typeof card.lastReview === "number" &&
    Number.isFinite(card.lastReview)
  );
}

/**
 * Probability of recall `horizonDays` from now, 0 to 1, or null for a card the
 * scheduler has no fitted memory for -- which the caller scores the old way.
 *
 * `default_w` is passed rather than a bare decay constant so this tracks
 * whatever parameters the scheduler is built with; `lib/study/scheduler.ts`
 * leaves them at their defaults.
 */
export function cardRetrievability(
  card: MemoryModelCard,
  now: number,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
): number | null {
  if (!hasMemoryModel(card)) return null;
  const elapsedDays = Math.max(0, (now - (card.lastReview as number)) / DAY_MS);
  const horizon = Math.max(0, tuning.masteryHorizonDays);
  const retrievability = forgetting_curve(
    default_w,
    elapsedDays + horizon,
    card.stability as number
  );
  return Number.isFinite(retrievability) ? Math.min(1, Math.max(0, retrievability)) : null;
}
