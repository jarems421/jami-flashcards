import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMock = vi.hoisted(() => ({
  addDoc: vi.fn(),
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(() => "DELETE_FIELD"),
  doc: vi.fn(),
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

const {
  CardBatchCreateError,
  createCard,
  createCardsInBatches,
  recordSimpleStudyResult,
  updateCardAfterReview,
} = await import("@/services/study/cards");

type BatchMock = {
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
};

let nextCardId = 0;
let batches: BatchMock[] = [];

function makeBatch(commit: () => Promise<void> = async () => {}) {
  const batch: BatchMock = {
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(commit),
  };
  batches.push(batch);
  return batch;
}

beforeEach(() => {
  vi.clearAllMocks();
  nextCardId = 0;
  batches = [];
  firestoreMock.collection.mockReturnValue({ path: "cards" });
  firestoreMock.doc.mockImplementation((...args: unknown[]) =>
    args.length >= 3
      ? { id: String(args[2]) }
      : { id: `card-${++nextCardId}` }
  );
  firestoreMock.addDoc.mockResolvedValue({ id: "single-card" });
  firestoreMock.updateDoc.mockResolvedValue(undefined);
  firestoreMock.writeBatch.mockImplementation(() => makeBatch());
});

describe("cards service creation", () => {
  it("creates one normalized card and returns its generated id", async () => {
    const card = await createCard({
      userId: "user-1",
      deckId: "deck-1",
      front: "  Front  ",
      back: "  Back  ",
      topicIds: ["topic-1"],
      createdAt: 1_000,
    });

    expect(firestoreMock.addDoc).toHaveBeenCalledWith(
      { path: "cards" },
      {
        userId: "user-1",
        deckId: "deck-1",
        front: "Front",
        back: "Back",
        tags: [],
        topicIds: ["topic-1"],
        createdAt: 1_000,
      }
    );
    expect(card).toEqual({
      id: "single-card",
      userId: "user-1",
      deckId: "deck-1",
      front: "Front",
      back: "Back",
      tags: [],
      topicIds: ["topic-1"],
      createdAt: 1_000,
    });
  });

  it("chunks 451 cards, preserves ordering, and reports committed progress", async () => {
    const progress = vi.fn();
    const drafts = Array.from({ length: 451 }, (_, index) => ({
      front: ` Front ${index} `,
      back: ` Back ${index} `,
    }));

    const cards = await createCardsInBatches(
      {
        userId: "user-2",
        deckId: "deck-2",
        drafts,
        topicIds: ["topic-2"],
        createdAtBase: 10_000,
      },
      progress
    );

    expect(batches).toHaveLength(2);
    expect(batches[0].set).toHaveBeenCalledTimes(450);
    expect(batches[1].set).toHaveBeenCalledTimes(1);
    expect(batches[0].commit).toHaveBeenCalledTimes(1);
    expect(batches[1].commit).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls).toEqual([
      [450, 451],
      [451, 451],
    ]);
    expect(cards).toHaveLength(451);
    expect(cards[0]).toMatchObject({
      id: "card-1",
      front: "Front 0",
      back: "Back 0",
      createdAt: 10_000,
    });
    expect(cards[450]).toMatchObject({
      id: "card-451",
      front: "Front 450",
      back: "Back 450",
      createdAt: 9_550,
    });
    expect(batches[0].set).toHaveBeenCalledWith(
      { id: "card-1" },
      {
        userId: "user-2",
        deckId: "deck-2",
        front: "Front 0",
        back: "Back 0",
        tags: [],
        topicIds: ["topic-2"],
        createdAt: 10_000,
      }
    );
  });

  it("reports only committed cards when a later batch fails", async () => {
    const progress = vi.fn();
    const failure = new Error("Connection lost");
    let batchNumber = 0;
    firestoreMock.writeBatch.mockImplementation(() => {
      batchNumber += 1;
      return makeBatch(
        batchNumber === 2
          ? async () => {
              throw failure;
            }
          : async () => {}
      );
    });

    let caught: unknown;
    try {
      await createCardsInBatches(
        {
          userId: "user-3",
          deckId: "deck-3",
          drafts: Array.from({ length: 451 }, (_, index) => ({
            front: `Front ${index}`,
            back: `Back ${index}`,
          })),
          createdAtBase: 20_000,
        },
        progress
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CardBatchCreateError);
    expect(caught).toMatchObject({
      message: "Connection lost",
      cause: failure,
    });
    expect((caught as InstanceType<typeof CardBatchCreateError>).createdCards).toHaveLength(
      450
    );
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(450, 451);
  });

  it("wraps unknown failures in a typed error without claiming cards committed", async () => {
    firestoreMock.writeBatch.mockImplementation(() =>
      makeBatch(async () => {
        throw "offline";
      })
    );

    await expect(
      createCardsInBatches({
        userId: "user-4",
        deckId: "deck-4",
        drafts: [{ front: "Front", back: "Back" }],
      })
    ).rejects.toMatchObject({
      name: "CardBatchCreateError",
      message: "Failed to create cards.",
      createdCards: [],
      cause: "offline",
    });
  });

  it("translates review values, increments, and field clearing in the service", async () => {
    await updateCardAfterReview("review-card", {
      values: {
        reps: 4,
        memoryRiskOverrideDayKey: "tomorrow",
      },
      increments: {
        customStruggleCount: 1,
        simpleStudyWrongCount: 1,
      },
      clearMemoryRiskOverrideDayKey: true,
    });

    expect(firestoreMock.updateDoc).toHaveBeenCalledWith(
      { id: "review-card" },
      {
        reps: 4,
        customStruggleCount: { increment: 1 },
        simpleStudyWrongCount: { increment: 1 },
        memoryRiskOverrideDayKey: "DELETE_FIELD",
      }
    );
  });

  it("records Simple Study results with the matching atomic counter", async () => {
    await recordSimpleStudyResult("correct-card", "correct", 2_000);
    await recordSimpleStudyResult("wrong-card", "wrong", 3_000);

    expect(firestoreMock.updateDoc).toHaveBeenNthCalledWith(
      1,
      { id: "correct-card" },
      {
        simpleStudyLastResult: "correct",
        simpleStudyLastReviewedAt: 2_000,
        simpleStudyCorrectCount: { increment: 1 },
      }
    );
    expect(firestoreMock.updateDoc).toHaveBeenNthCalledWith(
      2,
      { id: "wrong-card" },
      {
        simpleStudyLastResult: "wrong",
        simpleStudyLastReviewedAt: 3_000,
        simpleStudyWrongCount: { increment: 1 },
      }
    );
  });

  it("skips empty review updates", async () => {
    await updateCardAfterReview("unchanged-card", {});

    expect(firestoreMock.updateDoc).not.toHaveBeenCalled();
  });
});
