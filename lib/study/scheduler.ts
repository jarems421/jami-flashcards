import {
  fsrs,
  createEmptyCard,
  Rating,
  type Card as FSRSCard,
  type Grade,
} from "ts-fsrs";

export type CardRating = "again" | "hard" | "good" | "easy";

type SchedulableCard = {
  interval?: number;
  repetitions?: number;
  easeFactor?: number;
  dueDate?: number;
  stability?: number;
  difficulty?: number;
  fsrsState?: number;
  lapses?: number;
  reps?: number;
  lastReview?: number;
  scheduledDays?: number;
  elapsedDays?: number;
};

type CardSchedule = {
  // Legacy SM-2 fields (kept for backward compatibility with old cards. Remove when all cards are migrated to FSRS.)
  interval: number;
  repetitions: number;
  easeFactor: number;
  dueDate: number;
  // FSRS fields
  stability: number;
  difficulty: number;
  fsrsState: number;
  lapses: number;
  reps: number;
  lastReview: number;
  scheduledDays: number;
  elapsedDays: number;
};

const scheduler = fsrs({
  request_retention: 0.92,
});

const RATING_MAP: Record<CardRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function isStruggleRating(rating: CardRating) {
  return rating === "again" || rating === "hard";
}

export function isSuccessfulRating(rating: CardRating) {
  return rating === "good" || rating === "easy";
}

function toFSRSCard(card: SchedulableCard): FSRSCard {
  // If the card has FSRS fields, reconstruct the FSRS card
  if (typeof card.stability === "number" && card.stability > 0) {
    return {
      due: card.dueDate ? new Date(card.dueDate) : new Date(),
      stability: Math.max(0, card.stability),
      difficulty: Math.min(10, Math.max(0, card.difficulty ?? 0)),
      elapsed_days: Math.max(0, card.elapsedDays ?? 0),
      scheduled_days: Math.max(0, card.scheduledDays ?? 0),
      reps: Math.max(0, card.reps ?? 0),
      lapses: Math.max(0, card.lapses ?? 0),
      state: ([0, 1, 2, 3].includes(card.fsrsState ?? 0)
        ? card.fsrsState ?? 0
        : 0) as FSRSCard["state"],
      last_review: card.lastReview ? new Date(card.lastReview) : undefined,
      learning_steps: 0,
    };
  }

  // Legacy card or brand-new card - start fresh for FSRS.
  return createEmptyCard();
}

export function updateCardSchedule(
  card: SchedulableCard,
  rating: CardRating
): CardSchedule {
  const fsrsCard = toFSRSCard(card);
  const fsrsRating = RATING_MAP[rating];
  const now = new Date();

  let next: FSRSCard;
  try {
    const result = scheduler.next(fsrsCard, now, fsrsRating);
    next = result.card;
  } catch {
    // Fallback: reset to new card and reschedule
    const fresh = createEmptyCard();
    const result = scheduler.next(fresh, now, fsrsRating);
    next = result.card;
  }

  const dueDateMs = next.due.getTime();

  return {
    // Legacy fields
    interval: Math.max(1, next.scheduled_days || 1),
    repetitions: next.reps,
    easeFactor: 2.5, // kept constant for backward compat
    dueDate: dueDateMs,
    // FSRS fields
    stability: next.stability,
    difficulty: next.difficulty,
    fsrsState: next.state,
    lapses: next.lapses,
    reps: next.reps,
    lastReview: now.getTime(),
    scheduledDays: next.scheduled_days,
    elapsedDays: next.elapsed_days,
  };
}

/**
 * Returns the FSRS difficulty as a human-readable label and color tier.
 * Difficulty ranges from ~0 (easiest) to ~10 (hardest).
 */
export function getDifficultyInfo(difficulty: number | undefined): {
  label: string;
  tier: "easy" | "medium" | "hard";
} {
  if (difficulty === undefined || difficulty === 0) {
    return { label: "New", tier: "easy" };
  }
  if (difficulty < 4) {
    return { label: "Easy", tier: "easy" };
  }
  if (difficulty < 7) {
    return { label: "Medium", tier: "medium" };
  }
  return { label: "Hard", tier: "hard" };
}

