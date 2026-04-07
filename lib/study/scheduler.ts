export type CardRating = "wrong" | "right" | "again";

type SchedulableCard = {
  interval?: number;
  repetitions?: number;
  easeFactor?: number;
};

type CardSchedule = {
  interval: number;
  repetitions: number;
  easeFactor: number;
  dueDate: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function updateCardSchedule(
  card: SchedulableCard,
  rating: CardRating
): CardSchedule {
  const currentInterval = card.interval && card.interval > 0 ? card.interval : 1;
  const currentEaseFactor = typeof card.easeFactor === "number" ? card.easeFactor : 2.5;

  let interval = currentInterval;
  let repetitions = typeof card.repetitions === "number" ? card.repetitions : 0;
  let easeFactor = currentEaseFactor;

  if (rating === "wrong") {
    interval = 1;
    repetitions = 0;
    easeFactor = Math.max(1.3, currentEaseFactor - 0.1);
  }

  if (rating === "right") {
    interval = Math.max(1, Math.round(currentInterval * 2));
    repetitions += 1;
    easeFactor = currentEaseFactor;
  }

  if (rating === "again") {
    interval = 1;
    easeFactor = currentEaseFactor;
  }

  return {
    interval,
    repetitions,
    easeFactor,
    dueDate: Date.now() + interval * DAY_MS,
  };
}
