import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recording a flashcard answer in the learning history.
 *
 * Written once per answer, under the answer's own commit id, and only if it
 * is not already there -- so a sync that retries the answer finds its event
 * instead of recording it twice.
 */

type FakeTransaction = {
  get: (ref: unknown) => Promise<{ exists: () => boolean }>;
  set: (ref: unknown, data: Record<string, unknown>) => void;
};

const mocks = vi.hoisted(() => {
  const state = { alreadyRecorded: false };
  const transactionSet = vi.fn();
  return {
    state,
    transactionSet,
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
    runTransaction: vi.fn(
      async (_db: unknown, apply: (transaction: FakeTransaction) => Promise<unknown>) =>
        apply({
          get: async () => ({ exists: () => state.alreadyRecorded }),
          set: transactionSet,
        })
    ),
  };
});

vi.mock("firebase/firestore", () => ({ doc: mocks.doc, runTransaction: mocks.runTransaction }));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: async (promise: Promise<unknown>) => await promise,
}));

const { recordFlashcardReviewEvent } = await import("@/services/learning/flashcard-review-events");

const REVIEWED_AT = Date.UTC(2026, 8, 15, 9);

const review = {
  id: "review-1",
  commitId: "commit-1",
  userId: "user-1",
  cardId: "card-1",
  deckId: "deck-1",
  topicIds: ["topic-1"],
  folderIds: ["folder-1"],
  rating: "good" as const,
  reviewedAt: REVIEWED_AT,
  studyDayKey: "2026-09-15",
  isCorrect: true,
  durationMs: 2_000,
  sessionKind: "daily-required" as const,
  cardUpdates: {},
};

beforeEach(() => {
  mocks.state.alreadyRecorded = false;
  mocks.transactionSet.mockClear();
  mocks.runTransaction.mockClear();
  mocks.doc.mockClear();
});

describe("recording a flashcard review event", () => {
  it("writes one compact event under the answer's commit id", async () => {
    await expect(recordFlashcardReviewEvent("user-1", review, REVIEWED_AT + 1)).resolves.toBe("recorded");

    expect(mocks.doc).toHaveBeenCalledWith({}, "users", "user-1", "flashcardReviewEvents", "commit-1");
    expect(mocks.transactionSet).toHaveBeenCalledTimes(1);
    const written = mocks.transactionSet.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(
      ["cardId", "correct", "createdAt", "deckId", "rating", "reviewedAt", "schemaVersion", "studyDayKey"]
    );
  });

  it("leaves an answer that is already recorded alone", async () => {
    mocks.state.alreadyRecorded = true;
    await expect(recordFlashcardReviewEvent("user-1", review)).resolves.toBe("already-recorded");
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it("skips an answer it cannot scope, without touching Firestore", async () => {
    await expect(
      recordFlashcardReviewEvent("user-1", { ...review, deckId: undefined })
    ).resolves.toBe("skipped");
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
});
