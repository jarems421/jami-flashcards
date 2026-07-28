import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Budget enforcement for every AI route.
 *
 * The predecessor, lib/ai/rate-limit.ts, read the counter and wrote it back as
 * two separate operations, so concurrent requests all read the same value and
 * each wrote count + 1: a burst of N requests consumed one unit of quota. The
 * decisive test here is the concurrency one.
 */

const mocks = vi.hoisted(() => {
  const store = new Map<string, { count?: number }>();
  let transactionInFlight = false;

  const db = {
    collection: (collectionName: string) => ({
      doc: (docId: string) => ({ path: `${collectionName}/${docId}` }),
    }),
    runTransaction: async <T>(
      run: (transaction: {
        get: (ref: { path: string }) => Promise<{ data: () => { count?: number } | undefined }>;
        set: (ref: { path: string }, value: Record<string, unknown>) => void;
      }) => Promise<T>
    ): Promise<T> => {
      // Firestore retries contended transactions until they commit serially.
      // Modelling that is what makes the concurrency test meaningful.
      while (transactionInFlight) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      transactionInFlight = true;
      try {
        return await run({
          get: async (ref) => ({ data: () => store.get(ref.path) }),
          set: (ref, value) => {
            store.set(ref.path, { ...store.get(ref.path), ...value });
          },
        });
      } finally {
        transactionInFlight = false;
      }
    },
  };

  return { store, db };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => mocks.db,
}));

const { AI_BUDGETS, checkAiBudget, getAiTokenCap } = await import("@/lib/ai/budgets");

beforeEach(() => {
  mocks.store.clear();
});

describe("AI budget configuration", () => {
  it("covers every route that calls a model, and nothing that no longer exists", () => {
    expect(Object.keys(AI_BUDGETS).sort()).toEqual(
      [
        "assistant",
        "autocompleteCard",
        "sourceFlashcardDrafts",
        "sourcePracticeDrafts",
      ].sort()
    );
  });

  it("uses the agreed daily allowances", () => {
    expect(AI_BUDGETS.assistant.dailyRequestLimit).toBe(40);
    expect(AI_BUDGETS.autocompleteCard.dailyRequestLimit).toBe(40);
    expect(AI_BUDGETS.sourceFlashcardDrafts.dailyRequestLimit).toBe(10);
  });

  it("exposes a token cap for each action", () => {
    for (const action of Object.keys(AI_BUDGETS) as (keyof typeof AI_BUDGETS)[]) {
      expect(getAiTokenCap(action)).toBeGreaterThan(0);
    }
  });
});

describe("checkAiBudget", () => {
  it("allows requests up to the daily limit and refuses the next one", async () => {
    for (let index = 0; index < AI_BUDGETS.sourceFlashcardDrafts.dailyRequestLimit; index += 1) {
      expect(await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts" })).toBe(true);
    }

    expect(await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts" })).toBe(false);
  });

  it("cannot be exceeded by concurrent requests", async () => {
    const limit = AI_BUDGETS.assistant.dailyRequestLimit;
    const results = await Promise.all(
      Array.from({ length: limit + 25 }, () =>
        checkAiBudget({ uid: "user-1", action: "assistant" })
      )
    );

    expect(results.filter(Boolean)).toHaveLength(limit);
  });

  it("budgets each action separately", async () => {
    for (let index = 0; index < AI_BUDGETS.sourceFlashcardDrafts.dailyRequestLimit; index += 1) {
      await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts" });
    }

    expect(await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts" })).toBe(false);
    expect(await checkAiBudget({ uid: "user-1", action: "assistant" })).toBe(true);
  });

  it("budgets each user separately", async () => {
    for (let index = 0; index < AI_BUDGETS.sourceFlashcardDrafts.dailyRequestLimit; index += 1) {
      await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts" });
    }

    expect(await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts" })).toBe(false);
    expect(await checkAiBudget({ uid: "user-2", action: "sourceFlashcardDrafts" })).toBe(true);
  });

  it("resets when the day rolls over", async () => {
    const day = 1_700_000_000_000;
    const nextDay = day + 24 * 60 * 60 * 1000;

    for (let index = 0; index < AI_BUDGETS.sourceFlashcardDrafts.dailyRequestLimit; index += 1) {
      await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now: day });
    }

    expect(await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now: day })).toBe(false);
    expect(await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now: nextDay })).toBe(true);
  });
});
