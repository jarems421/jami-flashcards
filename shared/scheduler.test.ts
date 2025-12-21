import { describe, it, expect } from 'vitest';
import { scheduleCard, DEFAULT_SETTINGS, CardSchedule } from './scheduler';

describe('Scheduler', () => {
  const now = new Date('2025-01-01T12:00:00Z');
  
  const newCard: CardSchedule = {
    state: 'NEW',
    dueAt: now,
    intervalDays: 0,
    easeFactor: 2.5,
    learningStepIndex: 0,
    lapses: 0,
    reps: 0,
    lastReviewedAt: new Date(0), // old date
  };

  describe('NEW -> LEARNING', () => {
    it('AGAIN: starts at step 0', () => {
      const next = scheduleCard(newCard, 'AGAIN', DEFAULT_SETTINGS, now);
      expect(next.state).toBe('LEARNING');
      expect(next.learningStepIndex).toBe(0);
      expect(next.dueAt.getTime()).toBe(now.getTime() + 1 * 60000); // 1 min
    });

    it('GOOD: advances to step 1', () => {
      const next = scheduleCard(newCard, 'GOOD', DEFAULT_SETTINGS, now);
      expect(next.state).toBe('LEARNING');
      expect(next.learningStepIndex).toBe(1);
      expect(next.dueAt.getTime()).toBe(now.getTime() + 10 * 60000); // 10 min
    });

    it('EASY: graduates immediately', () => {
      const next = scheduleCard(newCard, 'EASY', DEFAULT_SETTINGS, now);
      expect(next.state).toBe('REVIEW');
      expect(next.intervalDays).toBe(4);
      expect(next.dueAt.getTime()).toBe(now.getTime() + 4 * 24 * 3600 * 1000);
    });
  });

  describe('LEARNING', () => {
    const learningCard: CardSchedule = {
      ...newCard,
      state: 'LEARNING',
      learningStepIndex: 0
    };

    it('AGAIN: resets to step 0', () => {
      // Advance to step 1 first
      const step1 = { ...learningCard, learningStepIndex: 1 };
      const next = scheduleCard(step1, 'AGAIN', DEFAULT_SETTINGS, now);
      expect(next.learningStepIndex).toBe(0);
      expect(next.dueAt.getTime()).toBe(now.getTime() + 1 * 60000);
    });

    it('GOOD (finish): graduates to REVIEW', () => {
      // At step 1 (last step is index 1 for [1, 10])? No, length is 2. Index 0 is 1m, Index 1 is 10m.
      // If we are at index 0 and hit GOOD -> index becomes 1. 1 < 2, so stay LEARNING.
      // If we are at index 1 and hit GOOD -> index becomes 2. 2 >= 2, graduate.
      
      const step1 = { ...learningCard, learningStepIndex: 1 };
      const next = scheduleCard(step1, 'GOOD', DEFAULT_SETTINGS, now);
      
      expect(next.state).toBe('REVIEW');
      expect(next.intervalDays).toBe(1); // Graduating interval
      expect(next.learningStepIndex).toBe(0); // Reset
    });
  });

  describe('REVIEW', () => {
    const reviewCard: CardSchedule = {
      ...newCard,
      state: 'REVIEW',
      intervalDays: 10,
      easeFactor: 2.5
    };

    it('AGAIN: lapses to RELEARNING', () => {
      const next = scheduleCard(reviewCard, 'AGAIN', DEFAULT_SETTINGS, now);
      expect(next.state).toBe('RELEARNING');
      expect(next.lapses).toBe(1);
      expect(next.intervalDays).toBe(5); // 10 * 0.5
      expect(next.dueAt.getTime()).toBe(now.getTime() + 10 * 60000); // 10 min lapse step
    });

    it('HARD: reduced multiplier', () => {
      const next = scheduleCard(reviewCard, 'HARD', DEFAULT_SETTINGS, now);
      expect(next.state).toBe('REVIEW');
      expect(next.intervalDays).toBe(12); // 10 * 1.2
      expect(next.easeFactor).toBe(2.35); // 2.5 - 0.15
    });

    it('GOOD: normal multiplier', () => {
      const next = scheduleCard(reviewCard, 'GOOD', DEFAULT_SETTINGS, now);
      expect(next.intervalDays).toBe(25); // 10 * 2.5
    });

    it('EASY: bonus multiplier', () => {
      const next = scheduleCard(reviewCard, 'EASY', DEFAULT_SETTINGS, now);
      expect(next.intervalDays).toBe(32.5); // 10 * 2.5 * 1.3
      expect(next.easeFactor).toBe(2.65); // 2.5 + 0.15
    });
  });
});
