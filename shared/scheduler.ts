// Simplified scheduler - no intervals, just tracks correct/wrong

export type CardState = 'NEW' | 'STUDIED';
export type Rating = 'WRONG' | 'CORRECT';

export interface CardSchedule {
  state: CardState;
  reps: number;
  lastReviewedAt: Date;
}

export function gradeCard(
  current: CardSchedule,
  rating: Rating,
  now: Date = new Date()
): CardSchedule {
  return {
    state: 'STUDIED',
    reps: current.reps + 1,
    lastReviewedAt: now
  };
}
