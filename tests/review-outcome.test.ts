import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/study/cards";
import { DAILY_REVIEW_MAX_WEAK_ATTEMPTS } from "@/lib/study/daily-review";
import type { DailyReviewState } from "@/lib/study/daily-review-types";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import { applyReviewToDailyState, planReviewOutcome } from "@/lib/study/review-outcome";

const NOW = Date.parse("2026-09-14T18:00:00.000Z");

const card = {
  id: "card-1",
  userId: "user-1",
  deckId: "deck-1",
  front: "What is ATP?",
  back: "The immediate energy carrier of the cell.",
  createdAt: 1,
  dueDate: 0,
  tags: [],
  topicIds: [],
} as Card;

function dailyState(overrides: Partial<DailyReviewState> = {}): DailyReviewState {
  return {
    id: "daily-review",
    studyDayKey: getStudyDayKey(NOW),
    generatedAt: 1,
    requiredCardIds: ["card-1"],
    optionalCardIds: [],
    carryoverRequiredCardIds: [],
    completedRequiredCardIds: [],
    completedOptionalCardIds: [],
    parkedRequiredCardIds: [],
    requiredRetryCounts: {},
    updatedAt: 1,
    ...overrides,
  } as DailyReviewState;
}

const schedule = { dueDate: NOW + 86_400_000, stability: 2, difficulty: 5, reps: 1 } as never;

describe("what a rating decides on the device", () => {
  it("schedules a good Daily Review answer and clears yesterday's risk", () => {
    const outcome = planReviewOutcome({
      card: { ...card, memoryRiskOverrideDayKey: "2026-09-14" } as Card,
      rating: "good",
      answeredAt: NOW,
      sessionKind: "daily-required",
      schedule,
      dailyReviewState: dailyState(),
    });

    expect(outcome.isCorrect).toBe(true);
    expect(outcome.retryResult).toBeNull();
    expect(outcome.cardUpdates).toEqual(expect.objectContaining({ dueDate: NOW + 86_400_000 }));
    expect(outcome.nextCard.memoryRiskOverrideDayKey).toBeUndefined();
    expect(outcome.updatesCards).toBe(true);
  });

  it("counts a missed Daily Review card from what is loaded, and parks it on the last attempt", () => {
    const first = planReviewOutcome({
      card, rating: "again", answeredAt: NOW, sessionKind: "daily-required", schedule, dailyReviewState: dailyState(),
    });
    expect(first.retryResult).toEqual({ attemptCount: 1, parked: false });
    expect(first.parkedRiskUpdates).toBeNull();

    const last = planReviewOutcome({
      card,
      rating: "again",
      answeredAt: NOW,
      sessionKind: "daily-required",
      schedule,
      dailyReviewState: dailyState({ requiredRetryCounts: { "card-1": DAILY_REVIEW_MAX_WEAK_ATTEMPTS - 1 } }),
    });
    expect(last.retryResult).toEqual({ attemptCount: DAILY_REVIEW_MAX_WEAK_ATTEMPTS, parked: true });
    expect(last.parkedRiskUpdates?.memoryRiskOverrideDayKey).toBe(shiftStudyDayKey(getStudyDayKey(NOW), 1));
  });

  it("takes the server's retry count over its own when it has one", () => {
    const outcome = planReviewOutcome({
      card, rating: "again", answeredAt: NOW, sessionKind: "daily-required", schedule, dailyReviewState: dailyState(),
      retryResult: { attemptCount: 3, parked: true },
    });
    expect(outcome.retryResult).toEqual({ attemptCount: 3, parked: true });
    expect(outcome.parkedRiskUpdates).not.toBeNull();
  });

  it("marks a Focused Review struggle as at risk without scheduling it", () => {
    const outcome = planReviewOutcome({
      card, rating: "hard", answeredAt: NOW, sessionKind: "custom", schedule: null, dailyReviewState: null,
    });
    expect(outcome.cardUpdates).not.toHaveProperty("dueDate");
    expect(outcome.cardUpdates.customStruggleCount).toBe(1);
    expect(outcome.nextCard.memoryRiskOverrideDayKey).toEqual(expect.any(String));
    expect(outcome.updatesCards).toBe(true);
  });
});

describe("Daily Review after an answer", () => {
  it("completes a required card, or counts and parks a retry", () => {
    expect(applyReviewToDailyState(dailyState(), "card-1", "daily-required", null, NOW)?.completedRequiredCardIds).toEqual(["card-1"]);

    const retried = applyReviewToDailyState(dailyState(), "card-1", "daily-required", { attemptCount: 3, parked: true }, NOW);
    expect(retried?.requiredRetryCounts).toEqual({ "card-1": 3 });
    expect(retried?.parkedRequiredCardIds).toEqual(["card-1"]);
    expect(retried?.completedRequiredCardIds).toEqual([]);
  });

  it("completes an optional card, and leaves Focused Review alone", () => {
    expect(applyReviewToDailyState(dailyState(), "card-1", "daily-optional", null, NOW)?.completedOptionalCardIds).toEqual(["card-1"]);
    const state = dailyState();
    expect(applyReviewToDailyState(state, "card-1", "custom", null, NOW)).toBe(state);
    expect(applyReviewToDailyState(null, "card-1", "daily-required", null, NOW)).toBeNull();
  });
});
