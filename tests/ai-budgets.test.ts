import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The in-memory transaction serializes writers like Firestore does. This lets
 * the boundary tests prove concurrent requests cannot all consume the same
 * final allowance.
 */
const mocks = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  let transactionInFlight = false;

  const db = {
    collection: (collectionName: string) => ({
      doc: (docId: string) => ({ path: `${collectionName}/${docId}` }),
    }),
    runTransaction: async <T>(
      run: (transaction: {
        get: (ref: { path: string }) => Promise<{
          data: () => Record<string, unknown> | undefined;
        }>;
        set: (ref: { path: string }, value: Record<string, unknown>) => void;
      }) => Promise<T>
    ): Promise<T> => {
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

const { AI_BUDGETS, getAiTokenCap } = await import("@/lib/ai/budgets");
const { checkAiBudget, createAiBudgetLimitResponse } = await import(
  "@/services/ai/budgets"
);

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  mocks.store.clear();
});

describe("AI budget configuration", () => {
  it("covers every route that calls a model", () => {
    expect(Object.keys(AI_BUDGETS).sort()).toEqual(
      [
        "assistant",
        "autocompleteCard",
        "sourceFlashcardDrafts",
        "sourcePracticeDrafts",
      ].sort()
    );
  });

  it("uses the agreed daily and burst allowances", () => {
    expect(AI_BUDGETS.assistant).toMatchObject({
      dailyRequestLimit: 40,
      burstRequestLimit: 6,
      burstWindowMs: MINUTE_MS,
    });
    expect(AI_BUDGETS.autocompleteCard.burstRequestLimit).toBe(6);
    expect(AI_BUDGETS.autocompleteCard.burstScope).toBe(
      AI_BUDGETS.assistant.burstScope
    );
    expect(AI_BUDGETS.sourceFlashcardDrafts).toMatchObject({
      dailyRequestLimit: 10,
      burstRequestLimit: 2,
      burstScope: "sourceDrafts",
    });
    expect(AI_BUDGETS.sourcePracticeDrafts.burstScope).toBe("sourceDrafts");
  });

  it("exposes a token cap for each action", () => {
    for (const action of Object.keys(AI_BUDGETS) as (keyof typeof AI_BUDGETS)[]) {
      expect(getAiTokenCap(action)).toBeGreaterThan(0);
    }
  });
});

describe("checkAiBudget", () => {
  it("allows requests up to the daily limit and refuses the next one", async () => {
    const now = 1_700_000_000_000;
    for (
      let index = 0;
      index < AI_BUDGETS.sourceFlashcardDrafts.dailyRequestLimit;
      index += 1
    ) {
      await expect(
        checkAiBudget({
          uid: "user-1",
          action: "sourceFlashcardDrafts",
          now: now + index * MINUTE_MS,
        })
      ).resolves.toMatchObject({ allowed: true, reason: null });
    }

    await expect(
      checkAiBudget({
        uid: "user-1",
        action: "sourceFlashcardDrafts",
        now: now + 10 * MINUTE_MS,
      })
    ).resolves.toMatchObject({ allowed: false, reason: "daily_limit" });
  });

  it("cannot exceed a burst allowance under concurrency", async () => {
    const now = 1_700_000_000_000;
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        checkAiBudget({ uid: "user-1", action: "assistant", now })
      )
    );

    expect(results.filter((decision) => decision.allowed)).toHaveLength(6);
    expect(
      results.filter(
        (decision) => !decision.allowed && decision.reason === "burst_limit"
      )
    ).toHaveLength(24);
  });

  it("shares six interactive requests across assistant and autocomplete", async () => {
    const now = 1_700_000_000_000;
    const actions = [
      "assistant",
      "autocompleteCard",
      "assistant",
      "autocompleteCard",
      "assistant",
      "autocompleteCard",
      "assistant",
      "autocompleteCard",
    ] as const;
    const results = await Promise.all(
      actions.map((action) => checkAiBudget({ uid: "user-1", action, now }))
    );

    expect(results.filter((decision) => decision.allowed)).toHaveLength(6);
    expect(
      results.filter(
        (decision) => !decision.allowed && decision.reason === "burst_limit"
      )
    ).toHaveLength(2);
  });

  it("cannot exceed the final daily allowance under concurrency", async () => {
    const now = 1_700_000_000_000;
    const dayKey = Math.floor(now / DAY_MS).toString();
    mocks.store.set(`aiBudgets/user-1:assistant:${dayKey}`, {
      count: AI_BUDGETS.assistant.dailyRequestLimit - 1,
      burstCount: 0,
      burstWindowStartedAt: now,
    });

    const results = await Promise.all([
      checkAiBudget({ uid: "user-1", action: "assistant", now }),
      checkAiBudget({ uid: "user-1", action: "assistant", now }),
    ]);

    expect(results.filter((decision) => decision.allowed)).toHaveLength(1);
    expect(results.filter((decision) => decision.reason === "daily_limit")).toHaveLength(1);
  });

  it("shares the two-request source burst across both draft kinds", async () => {
    const now = 1_700_000_000_000;
    await expect(
      checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now })
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      checkAiBudget({ uid: "user-1", action: "sourcePracticeDrafts", now })
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now })
    ).resolves.toMatchObject({ allowed: false, reason: "burst_limit" });
  });

  it("keeps the daily allowance separate for each source draft kind", async () => {
    const now = 1_700_000_000_000;
    for (
      let index = 0;
      index < AI_BUDGETS.sourceFlashcardDrafts.dailyRequestLimit;
      index += 1
    ) {
      await checkAiBudget({
        uid: "user-1",
        action: "sourceFlashcardDrafts",
        now: now + index * MINUTE_MS,
      });
    }

    await expect(
      checkAiBudget({
        uid: "user-1",
        action: "sourceFlashcardDrafts",
        now: now + 10 * MINUTE_MS,
      })
    ).resolves.toMatchObject({ allowed: false, reason: "daily_limit" });
    await expect(
      checkAiBudget({
        uid: "user-1",
        action: "sourcePracticeDrafts",
        now: now + 10 * MINUTE_MS,
      })
    ).resolves.toMatchObject({ allowed: true });
  });

  it("budgets each user separately", async () => {
    const now = 1_700_000_000_000;
    await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now });
    await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now });

    await expect(
      checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now })
    ).resolves.toMatchObject({ allowed: false, reason: "burst_limit" });
    await expect(
      checkAiBudget({ uid: "user-2", action: "sourceFlashcardDrafts", now })
    ).resolves.toMatchObject({ allowed: true });
  });

  it("resets burst and daily windows at their boundaries", async () => {
    const now = 1_700_000_000_000;
    await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now });
    await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now });
    await expect(
      checkAiBudget({
        uid: "user-1",
        action: "sourceFlashcardDrafts",
        now: now + MINUTE_MS,
      })
    ).resolves.toMatchObject({ allowed: true });

    const nextDay = now + DAY_MS;
    await expect(
      checkAiBudget({
        uid: "user-1",
        action: "sourceFlashcardDrafts",
        now: nextDay,
      })
    ).resolves.toMatchObject({ allowed: true });
  });

  it("returns a whole-second retry delay for a burst rejection", async () => {
    const now = 1_700_000_000_000;
    await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now });
    await checkAiBudget({ uid: "user-1", action: "sourceFlashcardDrafts", now });

    await expect(
      checkAiBudget({
        uid: "user-1",
        action: "sourceFlashcardDrafts",
        now: now + 30_001,
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "burst_limit",
      retryAfterSeconds: 30,
    });
  });
});

describe("AI budget route responses", () => {
  it("adds a stable daily code without a short-window retry header", async () => {
    const response = createAiBudgetLimitResponse("assistant", {
      allowed: false,
      reason: "daily_limit",
      retryAfterSeconds: 3_600,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      code: "daily_limit",
      retryAfterSeconds: 3_600,
    });
  });

  it("adds Retry-After for a burst rejection", async () => {
    const response = createAiBudgetLimitResponse("sourceFlashcardDrafts", {
      allowed: false,
      reason: "burst_limit",
      retryAfterSeconds: 23,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("23");
    await expect(response.json()).resolves.toMatchObject({
      code: "burst_limit",
      retryAfterSeconds: 23,
    });
  });
});
