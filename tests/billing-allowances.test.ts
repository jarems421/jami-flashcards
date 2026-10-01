import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The monthly allowance inside `checkAiBudget`, against an in-memory store that
 * serialises transactions the way Firestore does.
 */
const mocks = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  let transactionInFlight = false;
  const ref = (path: string) => ({ path });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    doc: (path: string) => ref(path),
    runTransaction: async <T>(
      run: (transaction: {
        get: (target: { path: string }) => Promise<{ data: () => Record<string, unknown> | undefined }>;
        set: (target: { path: string }, value: Record<string, unknown>) => void;
      }) => Promise<T>
    ): Promise<T> => {
      while (transactionInFlight) await new Promise((resolve) => setImmediate(resolve));
      transactionInFlight = true;
      try {
        return await run({
          get: async (target) => ({ data: () => store.get(target.path) }),
          set: (target, value) => store.set(target.path, { ...store.get(target.path), ...value }),
        });
      } finally {
        transactionInFlight = false;
      }
    },
  };
  return {
    store,
    db,
    entitlement: null as null | { plan: string; source: string; anchor: number },
  };
});

vi.mock("@/services/firebase/admin", () => ({ getAdminDb: () => mocks.db }));
vi.mock("@/services/auth/email-confirmation.server", () => ({ emailAllowsAi: async () => true }));
vi.mock("@/services/billing/entitlements.server", () => ({
  getEntitlement: async () => mocks.entitlement,
}));

const { checkAiBudget, refundAiBudget, createAiBudgetLimitResponse } = await import(
  "@/services/ai/budgets"
);
const { chargeAllowance, recordAllowanceUsage } = await import(
  "@/services/billing/allowances.server"
);

const ANCHOR = Date.parse("2026-10-01T09:00:00Z");
const NOW = Date.parse("2026-10-10T12:00:00Z");
const USAGE_PATH = "users/user-1/allowanceUsage/2026-10-01";

function usedOf(key: string) {
  const used = mocks.store.get(USAGE_PATH)?.used as Record<string, number> | undefined;
  return used?.[key] ?? 0;
}

beforeEach(() => {
  mocks.store.clear();
  mocks.entitlement = { plan: "plus", source: "subscription", anchor: ANCHOR };
});

describe("monthly allowances in the budget check", () => {
  it("charges the allowance an action spends", async () => {
    const decision = await checkAiBudget({ uid: "user-1", action: "practicePaperGeneration", now: NOW });
    expect(decision.allowed).toBe(true);
    expect(usedOf("papers")).toBe(1);
    if (decision.allowed) {
      expect(decision.grant.allowance).toEqual({ periodKey: "2026-10-01", key: "papers", amount: 1 });
    }
  });

  it("refuses once the month's allowance is used, and says when it resets", async () => {
    mocks.store.set(USAGE_PATH, { used: { papers: 6 } });
    const decision = await checkAiBudget({ uid: "user-1", action: "practicePaperGeneration", now: NOW });
    expect(decision).toMatchObject({ allowed: false, reason: "allowance_used" });
    if (!decision.allowed) {
      expect(decision.message).toContain("Jami papers");
      expect(decision.message).toContain("1 November");
      const response = createAiBudgetLimitResponse("practicePaperGeneration", decision);
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: "allowance_used" });
    }
    // A refusal spends nothing, not even the day's count.
    expect(mocks.store.get(`aiBudgets/user-1:practicePaperGeneration:${Math.floor(NOW / 86_400_000)}`)).toBeUndefined();
  });

  it("cannot hand the last one to two requests at once", async () => {
    mocks.store.set(USAGE_PATH, { used: { papers: 5 } });
    const [first, second] = await Promise.all([
      checkAiBudget({ uid: "user-1", action: "practicePaperGeneration", now: NOW, skipBurstLimit: true }),
      checkAiBudget({ uid: "user-1", action: "practicePaperGeneration", now: NOW, skipBurstLimit: true }),
    ]);
    expect([first.allowed, second.allowed].filter(Boolean)).toHaveLength(1);
    expect(usedOf("papers")).toBe(6);
  });

  it("gives the allowance back when the work fails", async () => {
    const decision = await checkAiBudget({ uid: "user-1", action: "examQuestionMarking", now: NOW });
    expect(usedOf("answers")).toBe(1);
    if (decision.allowed) await refundAiBudget(decision.grant);
    expect(usedOf("answers")).toBe(0);
  });

  it("spends nothing when told the work came with something already paid for", async () => {
    // A Jami paper's first marking.
    const decision = await checkAiBudget({
      uid: "user-1",
      action: "practicePaperMarking",
      now: NOW,
      allowance: null,
    });
    expect(decision.allowed).toBe(true);
    expect(usedOf("paperMarkings")).toBe(0);
  });

  it("leaves lifetime accounts and billing-off exactly as before", async () => {
    mocks.store.set(USAGE_PATH, { used: { papers: 999 } });
    mocks.entitlement = { plan: "lifetime", source: "lifetime", anchor: 0 };
    expect((await checkAiBudget({ uid: "user-1", action: "practicePaperGeneration", now: NOW })).allowed).toBe(true);
    mocks.entitlement = null;
    expect((await checkAiBudget({ uid: "user-1", action: "practicePaperGeneration", now: NOW })).allowed).toBe(true);
    expect(usedOf("papers")).toBe(999);
  });

  it("checks pages are left without counting them until the source is read", async () => {
    mocks.entitlement = { plan: "free", source: "free", anchor: ANCHOR };
    const decision = await checkAiBudget({
      uid: "user-1",
      action: "sourceIndexing",
      now: NOW,
      allowance: { key: "pages", amount: 0 },
    });
    expect(decision.allowed).toBe(true);
    expect(usedOf("pages")).toBe(0);
    await recordAllowanceUsage({ uid: "user-1", key: "pages", amount: 120, now: NOW });
    expect(usedOf("pages")).toBe(120);
  });
});

describe("charging an allowance part-way through a request", () => {
  it("charges a web search, refuses past the limit, and can refund", async () => {
    mocks.store.set(USAGE_PATH, { used: { searches: 29 } });
    const first = await chargeAllowance({ uid: "user-1", key: "searches", now: NOW });
    expect(first.allowed).toBe(true);
    const second = await chargeAllowance({ uid: "user-1", key: "searches", now: NOW });
    expect(second).toMatchObject({ allowed: false });
    if (first.allowed) await first.refund();
    expect(usedOf("searches")).toBe(29);
  });

  it("never lets Free make a generated photo", async () => {
    mocks.entitlement = { plan: "free", source: "free", anchor: ANCHOR };
    const charge = await chargeAllowance({ uid: "user-1", key: "photos", now: NOW });
    expect(charge.allowed).toBe(false);
  });
});
