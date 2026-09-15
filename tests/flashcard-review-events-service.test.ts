import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recording a flashcard answer in the learning history.
 *
 * Written once per answer, under the answer's own commit id, as a plain create
 * that Firestore can queue offline. A retried answer whose event already
 * exists is refused by the rules as an update, and that refusal means
 * "already recorded", not a failure.
 */

const mocks = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  setDoc: vi.fn(async (...args: unknown[]) => {
    void args;
  }),
}));

vi.mock("firebase/firestore", () => ({ doc: mocks.doc, setDoc: mocks.setDoc }));
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
  mocks.setDoc.mockReset();
  mocks.setDoc.mockResolvedValue(undefined);
  mocks.doc.mockClear();
});

describe("recording a flashcard review event", () => {
  it("writes one compact event under the answer's commit id", async () => {
    await expect(recordFlashcardReviewEvent("user-1", review, REVIEWED_AT + 1)).resolves.toBe("recorded");

    expect(mocks.doc).toHaveBeenCalledWith({}, "users", "user-1", "flashcardReviewEvents", "commit-1");
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const written = mocks.setDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(
      ["cardId", "correct", "createdAt", "deckId", "rating", "reviewedAt", "schemaVersion", "studyDayKey"]
    );
  });

  it("reads a refused second write as an answer already recorded", async () => {
    mocks.setDoc.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    await expect(recordFlashcardReviewEvent("user-1", review)).resolves.toBe("already-recorded");
  });

  it("passes any other failure on, for the caller to ignore", async () => {
    mocks.setDoc.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "unavailable" }));
    await expect(recordFlashcardReviewEvent("user-1", review)).rejects.toThrow("gone");
  });

  it("skips an answer it cannot scope, without touching Firestore", async () => {
    await expect(
      recordFlashcardReviewEvent("user-1", { ...review, deckId: undefined })
    ).resolves.toBe("skipped");
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
