import { describe, expect, it } from "vitest";
import { flashcardObservations } from "@/lib/learning/profile/flashcard-signals";
import { evidenceConfidence } from "@/lib/learning/scoring/confidence-score";
import { masteryScore } from "@/lib/learning/scoring/mastery-score";
import { cardRetrievability, hasMemoryModel } from "@/lib/learning/scoring/memory-model";
import { DEFAULT_LEARNING_TUNING } from "@/lib/learning/scoring/tuning";

/**
 * Reading the scheduler's fitted memory instead of re-estimating recall.
 *
 * What these guard is the reason the horizon exists at all: asked about this
 * instant, every card reviewed today looks perfect, and a profile built on that
 * would call a student strong the evening of the day they crammed.
 */

const NOW = Date.UTC(2026, 8, 15);
const DAY = 24 * 60 * 60 * 1000;

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: "card-1",
    deckId: "deck-1",
    topicIds: ["algebra"],
    reps: 6,
    lapses: 0,
    difficulty: 3,
    lastReview: NOW,
    ...overrides,
  };
}

describe("the fitted memory model", () => {
  it("tells a fragile memory from a durable one on the day both were reviewed", () => {
    const fragile = cardRetrievability(card({ stability: 1 }), NOW);
    const durable = cardRetrievability(card({ stability: 200 }), NOW);
    expect(fragile).not.toBeNull();
    expect(durable).not.toBeNull();
    // Read at this instant both would be 1.0, which is the failure being avoided.
    expect(fragile as number).toBeLessThan(0.8);
    expect(durable as number).toBeGreaterThan(0.99);
  });

  it("fades as the time since the last review grows", () => {
    const fresh = cardRetrievability(card({ stability: 10 }), NOW) as number;
    const stale = cardRetrievability(card({ stability: 10, lastReview: NOW - 100 * DAY }), NOW) as number;
    expect(fresh).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThan(0);
  });

  it("has no answer for a card from before FSRS, rather than a wrong one", () => {
    expect(hasMemoryModel(card({ stability: undefined }))).toBe(false);
    expect(cardRetrievability(card({ stability: undefined }), NOW)).toBeNull();
    expect(cardRetrievability(card({ stability: 10, lastReview: undefined }), NOW)).toBeNull();
    expect(cardRetrievability(card({ stability: 0 }), NOW)).toBeNull();
  });

  it("reads further ahead when the horizon is longer", () => {
    const near = cardRetrievability(card({ stability: 10 }), NOW, DEFAULT_LEARNING_TUNING) as number;
    const far = cardRetrievability(card({ stability: 10 }), NOW, {
      ...DEFAULT_LEARNING_TUNING,
      masteryHorizonDays: 60,
    }) as number;
    expect(far).toBeLessThan(near);
  });
});

describe("a score that is already an estimate of now", () => {
  const old = { itemId: "card-1", score: 0.9, weight: 1, at: NOW - 365 * DAY };

  it("is not faded again by mastery", () => {
    const measured = masteryScore([old], NOW);
    const estimate = masteryScore([{ ...old, currentEstimate: true }], NOW);
    // A year on, the measurement has faded to nothing and mastery is back at
    // the prior. The estimate is about now, so it still moves the number.
    expect(measured).toBeCloseTo(0.5, 2);
    expect(estimate).toBeCloseTo(0.66, 2);
  });

  it("still counts as old evidence for confidence", () => {
    const fresh = evidenceConfidence([{ ...old, at: NOW, currentEstimate: true }], NOW);
    const stale = evidenceConfidence([{ ...old, currentEstimate: true }], NOW);
    expect(stale).toBeLessThan(fresh);
  });
});

describe("flashcard evidence", () => {
  it("scores a card from its fitted memory and marks it a current estimate", () => {
    const [observation] = flashcardObservations([card({ stability: 200 })], [], NOW);
    expect(observation?.currentEstimate).toBe(true);
    expect(observation?.score).toBeGreaterThan(0.99);
  });

  it("falls back to the lapse rate for a card with no fitted memory", () => {
    const [observation] = flashcardObservations([card({ stability: undefined })], [], NOW);
    expect(observation?.currentEstimate).toBeUndefined();
    // 6 reps, 0 lapses, difficulty 3 -- the old blend, unchanged.
    expect(observation?.score).toBeCloseTo(1 * 0.7 + (1 - (3 - 1) / 9) * 0.3, 5);
  });

  it("separates two equally-reviewed cards the old scoring called identical", () => {
    const shaky = flashcardObservations([card({ id: "a", stability: 1 })], [], NOW)[0];
    const solid = flashcardObservations([card({ id: "b", stability: 200 })], [], NOW)[0];
    const legacy = flashcardObservations([card({ id: "c", stability: undefined })], [], NOW)[0];
    expect(legacy?.score).toBeCloseTo(
      flashcardObservations([card({ id: "d", stability: undefined })], [], NOW)[0]?.score ?? 0,
      5
    );
    expect((solid?.score ?? 0) - (shaky?.score ?? 0)).toBeGreaterThan(0.2);
  });
});
