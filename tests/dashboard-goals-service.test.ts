import { beforeEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => ({
  addDoc: vi.fn(),
  collection: vi.fn(
    (_db: unknown, ...segments: string[]) => ({
      kind: "collection",
      path: segments.join("/"),
    })
  ),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({
    kind: "document",
    path: segments.join("/"),
  })),
  documentId: vi.fn(() => "__name__"),
  getCountFromServer: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ kind: "limit", value })),
  orderBy: vi.fn((field: string, direction: string) => ({
    kind: "orderBy",
    field,
    direction,
  })),
  query: vi.fn((base: unknown, ...constraints: unknown[]) => ({
    kind: "query",
    base,
    constraints,
  })),
  startAfter: vi.fn((...values: unknown[]) => ({ kind: "startAfter", values })),
  updateDoc: vi.fn(),
  where: vi.fn((field: string, operator: string, value: unknown) => ({
    kind: "where",
    field,
    operator,
    value,
  })),
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: vi.fn(async (promise: Promise<unknown>) => await promise),
}));
vi.mock("@/services/dashboard/cache", () => ({
  invalidateDashboardData: vi.fn(),
}));
vi.mock("@/services/constellation/stars", () => ({
  createStarForGoalIfMissing: vi.fn(),
}));

function goalDocument(
  id: string,
  data: Record<string, unknown>
) {
  return { id, data: () => data };
}

function snapshot(docs: ReturnType<typeof goalDocument>[]) {
  return { docs, empty: docs.length === 0 };
}

function queryStatus(target: unknown) {
  if (!target || typeof target !== "object" || !("constraints" in target)) {
    return null;
  }
  const constraints = (target as { constraints: unknown[] }).constraints;
  const status = constraints.find(
    (constraint) =>
      constraint &&
      typeof constraint === "object" &&
      (constraint as { kind?: unknown }).kind === "where" &&
      (constraint as { field?: unknown }).field === "status"
  ) as { value?: unknown } | undefined;
  return status?.value ?? null;
}

/**
 * The summary now asks whether a star exists rather than whether a goal was
 * completed, because a goal finished against a full constellation mints no
 * star. That read goes to a different collection, and the mocks route on goal
 * status, so without this it fell through to the legacy-compatibility branch
 * and was counted as one.
 */
function isStarsQuery(target: unknown) {
  const base =
    target && typeof target === "object" && "base" in target
      ? (target as { base?: { path?: unknown } }).base
      : (target as { path?: unknown } | null);
  return typeof base?.path === "string" && base.path.endsWith("/stars");
}

describe("dashboard goal summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.updateDoc.mockResolvedValue(undefined);
  });

  it("loads only active/current goal states while retaining missing-status legacy goals", async () => {
    let compatibilityReads = 0;
    firestore.getDocs.mockImplementation(async (target: unknown) => {
      if (isStarsQuery(target)) return snapshot([goalDocument("star-1", {})]);
      const status = queryStatus(target);
      if (status === "active") {
        return snapshot([
          goalDocument("current", {
            name: "Current goal",
            status: "active",
            deadline: 2_000,
            createdAt: 30,
          }),
        ]);
      }
      if (status === "completed") {
        return snapshot([
          goalDocument("completed", {
            name: "Completed goal",
            status: "completed",
          }),
        ]);
      }

      compatibilityReads += 1;
      return snapshot([
        goalDocument("legacy", {
          name: "Legacy goal",
          deadline: 3_000,
          createdAt: 20,
        }),
        goalDocument("legacy-expired", {
          name: "Expired legacy goal",
          deadline: 900,
          createdAt: 10,
        }),
      ]);
    });

    const { getDashboardGoalSummary } = await import(
      "@/services/study/goals"
    );
    const first = await getDashboardGoalSummary("dashboard-goals-user", 1_000);
    const second = await getDashboardGoalSummary("dashboard-goals-user", 1_000);

    expect(first.activeGoals.map((goal) => goal.id)).toEqual([
      "current",
      "legacy",
    ]);
    expect(first.hasEarnedStars).toBe(true);
    expect(second).toEqual(first);
    expect(compatibilityReads).toBe(1);
    expect(firestore.where).toHaveBeenCalledWith("status", "==", "active");
    /*
     * The summary reads stars, not completed goals. It used to ask for one
     * completed goal and report it as an earned star, so a goal finished
     * against a full constellation -- which mints nothing -- still told the
     * student on Today that a reward was waiting.
     */
    expect(firestore.collection).toHaveBeenCalledWith(
      expect.anything(),
      "users",
      "dashboard-goals-user",
      "stars"
    );
    expect(firestore.where).not.toHaveBeenCalledWith("status", "==", "completed");
    expect(firestore.limit).toHaveBeenCalledWith(1);
  });

  it("invalidates the legacy compatibility snapshot after a goal write", async () => {
    let compatibilityReads = 0;
    firestore.getDocs.mockImplementation(async (target: unknown) => {
      if (isStarsQuery(target)) return snapshot([]);
      if (queryStatus(target) !== null) return snapshot([]);
      compatibilityReads += 1;
      return snapshot([]);
    });

    const { getDashboardGoalSummary, updateGoal } = await import(
      "@/services/study/goals"
    );
    await getDashboardGoalSummary("dashboard-goals-write-user", 1_000);
    await updateGoal("dashboard-goals-write-user", "goal-1", {
      status: "completed",
    });
    await getDashboardGoalSummary("dashboard-goals-write-user", 1_000);

    expect(compatibilityReads).toBe(2);
  });

  it("pages current goal history and appends readable legacy history records", async () => {
    firestore.getDocs.mockImplementation(async (target: unknown) => {
      if (isStarsQuery(target)) return snapshot([goalDocument("star-1", {})]);
      const status = queryStatus(target);
      if (Array.isArray(status)) {
        return snapshot([
          goalDocument("current", {
            name: "Current history",
            status: "completed",
            createdAt: 30,
          }),
        ]);
      }

      return snapshot([
        goalDocument("legacy-history", {
          name: "Legacy history",
          status: "cancelled",
        }),
        goalDocument("active", {
          name: "Not history",
          status: "active",
        }),
      ]);
    });

    const { getGoalHistoryPage } = await import("@/services/study/goals");
    const page = await getGoalHistoryPage("dashboard-goals-history-user", {
      pageSize: 2,
    });

    expect(page.items.map((goal) => goal.id)).toEqual([
      "current",
      "legacy-history",
    ]);
    expect(page.nextCursor).toBeNull();
    expect(firestore.where).toHaveBeenCalledWith(
      "status",
      "in",
      ["completed", "failed", "cancelled"]
    );
    expect(firestore.orderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(firestore.orderBy).toHaveBeenCalledWith("__name__", "desc");
    expect(firestore.limit).toHaveBeenCalledWith(3);
  });

  it("applies answer progress to a displayed legacy-active goal", async () => {
    firestore.getDocs.mockImplementation(async (target: unknown) => {
      if (queryStatus(target) === "active") return snapshot([]);
      return snapshot([
        goalDocument("legacy-active", {
          name: "Legacy active goal",
          targetCards: 1,
          targetAccuracy: 0.8,
          deadline: 5_000,
          createdAt: 10,
          progress: {
            cardsCompleted: 0,
            correctAnswers: 0,
            totalAnswers: 0,
          },
        }),
      ]);
    });

    const { applyGoalProgressForAnswer } = await import(
      "@/services/study/goals"
    );
    const result = await applyGoalProgressForAnswer(
      "dashboard-goals-progress-user",
      true,
      1_000
    );

    expect(result.completedGoals).toBe(1);
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "users/dashboard-goals-progress-user/goals/legacy-active",
      }),
      expect.objectContaining({
        progress: {
          cardsCompleted: 1,
          correctAnswers: 1,
          totalAnswers: 1,
        },
        status: "completed",
      })
    );
  });
});
