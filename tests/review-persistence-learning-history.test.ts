import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStudyDayKey } from "@/lib/study/day";
import type { OfflineQueuedReview } from "@/lib/study/offline-study";

/**
 * A saved answer, and its place in the learning history.
 *
 * The history is recorded only once the answer itself has saved, and it can
 * never be the reason an answer fails to save or stays queued.
 */

const mocks = vi.hoisted(() => ({
  recordStudyReview: vi.fn(),
  updateCardAfterReview: vi.fn(),
  recordSimpleStudyResult: vi.fn(),
  reserveStudyCommit: vi.fn(),
  clearStudyCommitDraft: vi.fn(),
  markDailyReviewCardComplete: vi.fn(),
  recordDailyReviewWeakAttempt: vi.fn(),
  applyGoalProgressForAnswer: vi.fn(),
  recordFlashcardReviewEvent: vi.fn(),
}));

vi.mock("@/services/study/activity", () => ({ recordStudyReview: mocks.recordStudyReview }));
vi.mock("@/services/study/cards", () => ({
  recordSimpleStudyResult: mocks.recordSimpleStudyResult,
  updateCardAfterReview: mocks.updateCardAfterReview,
}));
vi.mock("@/services/study/commit-intent", () => ({
  reserveStudyCommit: mocks.reserveStudyCommit,
  clearStudyCommitDraft: mocks.clearStudyCommitDraft,
}));
vi.mock("@/services/study/daily-review", () => ({
  markDailyReviewCardComplete: mocks.markDailyReviewCardComplete,
  recordDailyReviewWeakAttempt: mocks.recordDailyReviewWeakAttempt,
}));
vi.mock("@/services/study/goals", () => ({ applyGoalProgressForAnswer: mocks.applyGoalProgressForAnswer }));
vi.mock("@/services/learning/flashcard-review-events", () => ({
  recordFlashcardReviewEvent: mocks.recordFlashcardReviewEvent,
}));

const { persistStudyReview } = await import("@/services/study/review-persistence");

const NOW = Date.UTC(2026, 8, 15, 12);
const DAY_KEY = getStudyDayKey(NOW);

function review(overrides: Partial<OfflineQueuedReview> = {}): OfflineQueuedReview {
  return {
    id: "review-1",
    commitId: "commit-1",
    userId: "user-1",
    cardId: "card-1",
    deckId: "deck-1",
    rating: "good",
    reviewedAt: NOW,
    studyDayKey: DAY_KEY,
    isCorrect: true,
    durationMs: 1_500,
    sessionKind: "custom",
    cardUpdates: { reps: 2 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordStudyReview.mockResolvedValue(undefined);
  mocks.updateCardAfterReview.mockResolvedValue(undefined);
  mocks.recordSimpleStudyResult.mockResolvedValue(undefined);
  mocks.applyGoalProgressForAnswer.mockResolvedValue({ completedGoals: 0, starsEarned: 0 });
  mocks.recordFlashcardReviewEvent.mockResolvedValue("recorded");
});

describe("persisting a review into the learning history", () => {
  it("records the answer once the answer itself has saved", async () => {
    await persistStudyReview("user-1", review(), DAY_KEY);

    expect(mocks.recordFlashcardReviewEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordFlashcardReviewEvent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ cardId: "card-1", commitId: "commit-1" })
    );
    expect(mocks.updateCardAfterReview.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordFlashcardReviewEvent.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("never lets a failed history write fail the saved answer", async () => {
    mocks.recordFlashcardReviewEvent.mockRejectedValue(new Error("permission-denied"));

    await expect(persistStudyReview("user-1", review(), DAY_KEY)).resolves.toBeDefined();
    expect(mocks.clearStudyCommitDraft).toHaveBeenCalledWith("user-1", "commit-1");
  });

  it("records nothing for an answer that did not save", async () => {
    mocks.updateCardAfterReview.mockRejectedValue(new Error("unavailable"));

    await expect(persistStudyReview("user-1", review(), DAY_KEY)).rejects.toThrow("unavailable");
    expect(mocks.recordFlashcardReviewEvent).not.toHaveBeenCalled();
  });

  it("records simple-study answers too", async () => {
    await persistStudyReview("user-1", review({ sessionKind: "simple" }), DAY_KEY);

    expect(mocks.recordSimpleStudyResult).toHaveBeenCalled();
    expect(mocks.recordFlashcardReviewEvent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ sessionKind: "simple" })
    );
  });
});
