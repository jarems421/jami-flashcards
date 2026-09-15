import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a deck takes its learning history with it.
 *
 * Best-effort by design: the learner profile already ignores history for cards
 * that no longer exist, so a failure clearing it must never be the reason a
 * student cannot delete a deck.
 */

type Ref = { path: string };

const mocks = vi.hoisted(() => {
  const state = { failHistory: false, deleted: [] as string[] };
  const snapshot = (path: string) => ({ id: path.split("/").pop() ?? path, ref: { path }, data: () => ({}) });
  return {
    state,
    collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
    query: vi.fn((ref: Ref, ...constraints: unknown[]) => ({ path: ref.path, constraints })),
    where: vi.fn((field: string, operator: string, value: unknown) => ({ field, operator, value })),
    getDoc: vi.fn(async () => ({
      id: "deck-1",
      exists: () => true,
      data: () => ({ userId: "user-1", name: "Deck" }),
    })),
    getDocs: vi.fn(async (ref: Ref) => {
      if (ref.path === "cards") return { docs: [snapshot("cards/card-1")] };
      if (ref.path.endsWith("/flashcardReviewEvents")) {
        if (state.failHistory) throw new Error("permission-denied");
        return {
          docs: [
            snapshot("users/user-1/flashcardReviewEvents/commit-1"),
            snapshot("users/user-1/flashcardReviewEvents/commit-2"),
          ],
        };
      }
      return { docs: [] };
    }),
    writeBatch: vi.fn(() => {
      const pending: string[] = [];
      return {
        delete: (ref: Ref) => pending.push(ref.path),
        commit: async () => {
          state.deleted.push(...pending);
        },
      };
    }),
    deleteDoc: vi.fn(async (ref: Ref) => {
      state.deleted.push(ref.path);
    }),
  };
});

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: mocks.collection,
  deleteDoc: mocks.deleteDoc,
  doc: mocks.doc,
  documentId: vi.fn(),
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: mocks.query,
  startAfter: vi.fn(),
  updateDoc: vi.fn(),
  where: mocks.where,
  writeBatch: mocks.writeBatch,
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: async (promise: Promise<unknown>) => await promise,
}));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardData: vi.fn() }));
vi.mock("@/services/cache/read-through", () => ({ readThroughCache: vi.fn() }));
vi.mock("@/services/study/card-images", () => ({ deleteCardImageFiles: vi.fn(async () => undefined) }));
vi.mock("@/lib/onboarding/tutorial", () => ({ reportTutorialAction: vi.fn() }));

const { deleteDeck } = await import("@/services/study/decks");

beforeEach(() => {
  mocks.state.failHistory = false;
  mocks.state.deleted = [];
  mocks.where.mockClear();
});

describe("deleting a deck", () => {
  it("deletes the deck's flashcard review history", async () => {
    await deleteDeck("user-1", "deck-1");

    expect(mocks.where).toHaveBeenCalledWith("deckId", "==", "deck-1");
    expect(mocks.state.deleted).toEqual(
      expect.arrayContaining([
        "users/user-1/flashcardReviewEvents/commit-1",
        "users/user-1/flashcardReviewEvents/commit-2",
        "decks/deck-1",
      ])
    );
  });

  it("still deletes the deck when its history cannot be cleared", async () => {
    mocks.state.failHistory = true;

    await expect(deleteDeck("user-1", "deck-1")).resolves.toBeUndefined();
    expect(mocks.state.deleted).toContain("decks/deck-1");
  });
});
