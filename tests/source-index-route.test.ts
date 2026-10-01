import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  checkAiBudget: vi.fn(),
  refundAiBudget: vi.fn(),
  rebuildSourceIndex: vi.fn(),
  deleteSourceIndex: vi.fn(),
  afterTasks: [] as Array<() => Promise<void>>,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: () => Promise<void>) => {
      mocks.afterTasks.push(task);
    },
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));

vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: mocks.checkAiBudget,
  refundAiBudget: mocks.refundAiBudget,
  createAiBudgetLimitResponse: (action: string, decision: { reason: string }) =>
    Response.json({ code: decision.reason, action }, { status: 429 }),
}));

vi.mock("@/services/ai/source-index.server", () => ({
  rebuildSourceIndex: mocks.rebuildSourceIndex,
  deleteSourceIndex: mocks.deleteSourceIndex,
}));

const { POST } = await import("@/app/api/ai/source-index/route");

const grant = {
  uid: "user-1",
  action: "sourceIndexing",
  dayKey: "1",
  burstWindowStartedAt: 0,
};

function request(sourceId = "source-1") {
  return new NextRequest(new URL("http://localhost/api/ai/source-index"), {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId }),
  });
}

async function runAfterTasks() {
  const tasks = mocks.afterTasks.splice(0);
  for (const task of tasks) await task();
}

describe("source index route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterTasks.length = 0;
    mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
    mocks.checkAiBudget.mockResolvedValue({ allowed: true, reason: null, retryAfterSeconds: 0, grant });
    mocks.rebuildSourceIndex.mockResolvedValue({ chunkCount: 12 });
    mocks.refundAiBudget.mockResolvedValue(undefined);
  });

  it("charges the indexing budget before it indexes", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(mocks.checkAiBudget).toHaveBeenCalledWith({ uid: "user-1", action: "sourceIndexing" });
    await runAfterTasks();
    expect(mocks.rebuildSourceIndex).toHaveBeenCalledWith("user-1", "source-1");
    expect(mocks.refundAiBudget).not.toHaveBeenCalled();
  });

  it("does no work once the day's indexing is used up", async () => {
    mocks.checkAiBudget.mockResolvedValue({ allowed: false, reason: "daily_limit", retryAfterSeconds: 60 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    await runAfterTasks();
    expect(mocks.rebuildSourceIndex).not.toHaveBeenCalled();
  });

  it("gives the allowance back when indexing fails", async () => {
    mocks.rebuildSourceIndex.mockRejectedValue(new Error("embeddings down"));
    await POST(request());
    await runAfterTasks();
    expect(mocks.refundAiBudget).toHaveBeenCalledWith(grant);
  });

  it("refuses to index when the budget cannot be read", async () => {
    mocks.checkAiBudget.mockRejectedValue(new Error("firestore down"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    await runAfterTasks();
    expect(mocks.rebuildSourceIndex).not.toHaveBeenCalled();
  });
});
