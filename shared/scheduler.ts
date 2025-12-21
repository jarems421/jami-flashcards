export type Rating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';
export type CardState = 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';

export interface SchedulerSettings {
  learningStepsMinutes: number[];
  graduatingIntervalDays: number;
  easyIntervalDays: number;
  startingEaseFactor: number;
  easyBonus: number;
  hardMultiplier: number;
  lapseStepsMinutes: number[];
  lapseIntervalMultiplier: number;
  minEaseFactor: number;
  maxIntervalDays: number;
}

export const DEFAULT_SETTINGS: SchedulerSettings = {
  learningStepsMinutes: [1, 10],
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  startingEaseFactor: 2.5,
  easyBonus: 1.3,
  hardMultiplier: 1.2,
  lapseStepsMinutes: [10],
  lapseIntervalMultiplier: 0.5,
  minEaseFactor: 1.3,
  maxIntervalDays: 36500,
};

export interface CardSchedule {
  state: CardState;
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  learningStepIndex: number;
  lapses: number;
  reps: number;
  lastReviewedAt: Date;
}

export function scheduleCard(
  current: CardSchedule,
  rating: Rating,
  settings: SchedulerSettings = DEFAULT_SETTINGS,
  now: Date = new Date()
): CardSchedule {
  // Clone to avoid mutation
  const next = { ...current };
  
  // Updates that happen regardless of state/rating
  next.reps += 1;
  next.lastReviewedAt = now;

  // State Machine
  switch (current.state) {
    case 'NEW':
      // Treat first grade as LEARNING step 0 immediately
      next.state = 'LEARNING';
      next.learningStepIndex = 0;
      handleLearning(next, rating, settings, now);
      break;

    case 'LEARNING':
      handleLearning(next, rating, settings, now);
      break;

    case 'REVIEW':
      handleReview(next, rating, settings, now);
      break;

    case 'RELEARNING':
      handleRelearning(next, rating, settings, now);
      break;
  }

  // Global Clamps
  next.easeFactor = Math.max(settings.minEaseFactor, next.easeFactor);
  next.intervalDays = Math.min(settings.maxIntervalDays, next.intervalDays);
  
  // Interval floor (sanity check, usually > 0 for review, 0 for learning minutes)
  if (next.state === 'REVIEW' && next.intervalDays < 1) {
    next.intervalDays = 1;
  }

  return next;
}

function handleLearning(next: CardSchedule, rating: Rating, settings: SchedulerSettings, now: Date) {
  const steps = settings.learningStepsMinutes;
  
  switch (rating) {
    case 'AGAIN':
      next.learningStepIndex = 0;
      next.dueAt = addMinutes(now, steps[0]);
      break;
      
    case 'HARD':
      // Repeat step
      next.dueAt = addMinutes(now, steps[next.learningStepIndex] || steps[0]);
      break;
      
    case 'GOOD':
      next.learningStepIndex += 1;
      if (next.learningStepIndex >= steps.length) {
        // Graduate
        next.state = 'REVIEW';
        next.intervalDays = settings.graduatingIntervalDays;
        next.dueAt = addDays(now, next.intervalDays);
        next.learningStepIndex = 0; // Reset for future lapses
      } else {
        next.dueAt = addMinutes(now, steps[next.learningStepIndex]);
      }
      break;
      
    case 'EASY':
      // Graduate immediately to easy interval
      next.state = 'REVIEW';
      next.intervalDays = settings.easyIntervalDays;
      next.dueAt = addDays(now, next.intervalDays);
      next.learningStepIndex = 0;
      break;
  }
}

function handleReview(next: CardSchedule, rating: Rating, settings: SchedulerSettings, now: Date) {
  switch (rating) {
    case 'AGAIN':
      next.state = 'RELEARNING';
      next.lapses += 1;
      next.intervalDays = Math.max(1, next.intervalDays * settings.lapseIntervalMultiplier);
      next.learningStepIndex = 0;
      next.dueAt = addMinutes(now, settings.lapseStepsMinutes[0]);
      break;

    case 'HARD':
      next.intervalDays = Math.max(1, next.intervalDays * settings.hardMultiplier);
      next.easeFactor = Math.max(settings.minEaseFactor, next.easeFactor - 0.15);
      next.dueAt = addDays(now, next.intervalDays);
      break;

    case 'GOOD':
      next.intervalDays = next.intervalDays * next.easeFactor;
      next.dueAt = addDays(now, next.intervalDays);
      break;

    case 'EASY':
      next.intervalDays = next.intervalDays * next.easeFactor * settings.easyBonus;
      next.easeFactor += 0.15;
      next.dueAt = addDays(now, next.intervalDays);
      break;
  }
}

function handleRelearning(next: CardSchedule, rating: Rating, settings: SchedulerSettings, now: Date) {
  const steps = settings.lapseStepsMinutes;
  
  switch (rating) {
    case 'AGAIN':
      next.learningStepIndex = 0;
      next.dueAt = addMinutes(now, steps[0]);
      break;

    case 'HARD':
      // Repeat step
      next.dueAt = addMinutes(now, steps[next.learningStepIndex] || steps[0]);
      break;

    case 'GOOD':
      next.learningStepIndex += 1;
      if (next.learningStepIndex >= steps.length) {
        // Graduate back to REVIEW
        next.state = 'REVIEW';
        // Use the stored (and already penalized) intervalDays
        next.dueAt = addDays(now, next.intervalDays);
        next.learningStepIndex = 0;
      } else {
        next.dueAt = addMinutes(now, steps[next.learningStepIndex]);
      }
      break;

    case 'EASY':
      // Graduate immediately
      next.state = 'REVIEW';
      next.dueAt = addDays(now, next.intervalDays);
      next.learningStepIndex = 0;
      break;
  }
}

// Helpers
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
