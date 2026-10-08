import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recording a flashcard answer in the learning history.
 *
 * Written once per answer, under the answer's own commit id, as a plain create
 * that Firestore can queue offline. A retried answer whose event already
 * exists is refused by the rules as an update, and that refusal means
 * "already recorded", not a failure.
 */

type StoredEvent = { id: string; data: () => Record<string, unknown> };
type Constraint = { field?: string; op?: string; value?: unknown };

const mocks = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  setDoc: vi.fn(async (...args: unknown[]) => {
    void args;
  }),
  /** Each mix-up read's card ids, in order. */
  reads: [] as unknown[][],
  stored: [] as StoredEvent[],
}));

vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  setDoc: mocks.setDoc,
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  where: (field: string, op: string, value: unknown): Constraint => ({ field, op, value }),
  limit: (count: number) => ({ limit: count }),
  query: (_collection: unknown, ...constraints: Constraint[]) => constraints,
  getDocs: async (constraints: Constraint[]) => {
    const asked = constraints.find((constraint) => constraint.field === "cardId")?.value;
    const cardIds = Array.isArray(asked) ? asked : [];
    mocks.reads.push(cardIds);
    return { docs: mocks.stored.filter((event) => cardIds.includes(event.data().cardId)) };
  },
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: async (promise: Promise<unknown>) => await promise,
}));

const { loadDiagramConfusionEvents, recordFlashcardReviewEvent } = await import(
  "@/services/learning/flashcard-review-events"
);

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

describe("reading a student's diagram mix-ups", () => {
  const stored = (id: string, data: Record<string, unknown>): StoredEvent => ({ id, data: () => data });
  const event = {
    schemaVersion: 1,
    deckId: "deck-1",
    studyDayKey: "2026-09-15",
    correct: false,
    rating: "again",
    reviewedAt: REVIEWED_AT,
    createdAt: REVIEWED_AT,
  };

  beforeEach(() => {
    mocks.reads = [];
    mocks.stored = [];
  });

  it("reads thirty cards at a time and keeps only well-formed mix-ups: ids and times", async () => {
    const cardIds = Array.from({ length: 31 }, (_, index) => `card-${index}`);
    mocks.stored = [
      stored("e1", { ...event, cardId: "card-0", confusedWithLabelId: "label-7" }),
      stored("e2", { ...event, cardId: "card-30", confusedWithLabelId: "label-2", reviewedAt: REVIEWED_AT + 5 }),
      stored("e3", { ...event, cardId: "card-1" }),
      stored("e4", { ...event, schemaVersion: 9, cardId: "card-2", confusedWithLabelId: "label-1" }),
    ];

    await expect(loadDiagramConfusionEvents("user-1", cardIds)).resolves.toEqual([
      { cardId: "card-0", confusedWithLabelId: "label-7", reviewedAt: REVIEWED_AT },
      { cardId: "card-30", confusedWithLabelId: "label-2", reviewedAt: REVIEWED_AT + 5 },
    ]);
    expect(mocks.reads.map((read) => read.length)).toEqual([30, 1]);
  });

  it("asks nothing for no cards, and answers a failed read with no mix-ups", async () => {
    await expect(loadDiagramConfusionEvents("user-1", [])).resolves.toEqual([]);
    expect(mocks.reads).toEqual([]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.stored = [{ id: "bad", data: () => ({ cardId: "card-0" }) }];
    mocks.stored.push({
      id: "unreadable",
      data: () => {
        throw new Error("offline");
      },
    });
    await expect(loadDiagramConfusionEvents("user-1", ["card-0"])).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
