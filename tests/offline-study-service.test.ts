import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

const mocks = vi.hoisted(() => ({
  recordStudyReview: vi.fn(),
  applyGoalProgressForAnswer: vi.fn(),
  markDailyReviewCardComplete: vi.fn(),
  recordDailyReviewWeakAttempt: vi.fn(),
}));

const firestoreMock = vi.hoisted(() => ({
  addDoc: vi.fn(),
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(() => "DELETE_FIELD"),
  doc: vi.fn((_db: unknown, collectionName: string, cardId: string) => ({
    path: `${collectionName}/${cardId}`,
  })),
  getDocs: vi.fn(),
  increment: vi.fn((value: number) => ({ increment: value })),
  query: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestoreMock);

vi.mock("@/services/firebase/client", () => ({
  db: {},
}));

vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: vi.fn(async (promise: Promise<unknown>) => await promise),
}));

vi.mock("@/services/study/activity", () => ({
  recordStudyReview: mocks.recordStudyReview,
}));

vi.mock("@/services/study/goals", () => ({
  applyGoalProgressForAnswer: mocks.applyGoalProgressForAnswer,
}));

vi.mock("@/services/study/daily-review", () => ({
  markDailyReviewCardComplete: mocks.markDailyReviewCardComplete,
  recordDailyReviewWeakAttempt: mocks.recordDailyReviewWeakAttempt,
}));

const {
  getOfflineQueuedReviews,
  queueOfflineStudyReview,
} = await import("@/lib/study/offline-study");
const { syncOfflineStudyReviews } = await import("@/services/study/offline");

const NOW = Date.parse("2026-07-29T12:00:00.000Z");
const USER_ID = "user-1";

function createLocalStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function queueReview(
  overrides: Partial<Parameters<typeof queueOfflineStudyReview>[0]> = {}
) {
  return queueOfflineStudyReview({
    userId: USER_ID,
    cardId: "card-1",
    deckId: "deck-1",
    topicIds: ["topic-1"],
    folderIds: ["folder-1"],
    rating: "good",
    reviewedAt: NOW,
    studyDayKey: getStudyDayKey(NOW),
    isCorrect: true,
    durationMs: 2_000,
    sessionKind: "daily-required",
    cardUpdates: { reps: 3 },
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.stubGlobal("window", { localStorage: createLocalStorage() });
  mocks.recordStudyReview.mockResolvedValue(undefined);
  mocks.applyGoalProgressForAnswer.mockResolvedValue({
    completedGoals: 0,
    starsEarned: 0,
  });
  mocks.markDailyReviewCardComplete.mockResolvedValue(undefined);
  mocks.recordDailyReviewWeakAttempt.mockResolvedValue({
    attemptCount: 1,
    parked: false,
  });
  firestoreMock.updateDoc.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("offline study synchronization", () => {
  it("syncs card, activity, goals, and current-day daily review state", async () => {
    queueReview({
      cardId: "required-struggle",
      rating: "again",
      isCorrect: false,
      cardUpdates: { simpleStudyWrongCount: 2 },
    });
    queueReview({
      cardId: "optional-success",
      sessionKind: "daily-optional",
      cardUpdates: { reps: 4 },
    });

    await expect(syncOfflineStudyReviews(USER_ID)).resolves.toEqual({
      attempted: 2,
      synced: 2,
      remaining: 0,
    });

    expect(getOfflineQueuedReviews(USER_ID)).toEqual([]);
    expect(mocks.recordStudyReview).toHaveBeenCalledTimes(2);
    expect(mocks.applyGoalProgressForAnswer).toHaveBeenCalledTimes(2);
    expect(firestoreMock.updateDoc).toHaveBeenCalledWith(
      { path: "cards/required-struggle" },
      { simpleStudyWrongCount: 2 }
    );
    expect(firestoreMock.updateDoc).toHaveBeenCalledWith(
      { path: "cards/optional-success" },
      { reps: 4 }
    );
    expect(mocks.recordDailyReviewWeakAttempt).toHaveBeenCalledWith(
      USER_ID,
      "required-struggle",
      NOW
    );
    expect(mocks.markDailyReviewCardComplete).toHaveBeenCalledWith(
      USER_ID,
      "optional-success",
      "optional"
    );
  });

  it("does not apply an old review to the current daily review state", async () => {
    const currentDayKey = getStudyDayKey(NOW);
    queueReview({
      sessionKind: "daily-optional",
      studyDayKey: shiftStudyDayKey(currentDayKey, -1),
      clearMemoryRiskOverrideDayKey: true,
      cardUpdates: {
        memoryRiskOverrideDayKey: currentDayKey,
        reps: 5,
      },
    });

    await syncOfflineStudyReviews(USER_ID);

    expect(firestoreMock.updateDoc).toHaveBeenCalledWith(
      { path: "cards/card-1" },
      {
        memoryRiskOverrideDayKey: "DELETE_FIELD",
        reps: 5,
      }
    );
    expect(mocks.recordDailyReviewWeakAttempt).not.toHaveBeenCalled();
    expect(mocks.markDailyReviewCardComplete).not.toHaveBeenCalled();
  });

  it("keeps a failed review queued while removing later successful reviews", async () => {
    const failedReview = queueReview({
      cardId: "failed-card",
      reviewedAt: NOW - 1_000,
    });
    queueReview({
      cardId: "successful-card",
      reviewedAt: NOW,
    });
    mocks.recordStudyReview.mockImplementation(
      async (_userId: string, reviewedAt: number) => {
        if (reviewedAt === failedReview.reviewedAt) {
          throw new Error("Offline sync failed");
        }
      }
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(syncOfflineStudyReviews(USER_ID)).resolves.toEqual({
      attempted: 2,
      synced: 1,
      remaining: 1,
    });

    expect(getOfflineQueuedReviews(USER_ID)).toEqual([
      expect.objectContaining({
        id: failedReview.id,
        cardId: "failed-card",
      }),
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
