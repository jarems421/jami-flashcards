import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

const firestore = vi.hoisted(() => {
  type FakeDoc = {
    id: string;
    index: number;
    data: () => Record<string, unknown>;
  };
  type Constraint =
    | { kind: "startAfter"; cursor: FakeDoc }
    | { kind: "limit"; count: number }
    | { kind: "other" };
  let documents: FakeDoc[] = [];
  const getDocs = vi.fn(
    async (request: { constraints?: Constraint[] }) => {
      const constraints = request.constraints ?? [];
      const cursor = constraints.find(
        (constraint): constraint is Extract<Constraint, { kind: "startAfter" }> =>
          constraint.kind === "startAfter"
      )?.cursor;
      const pageSize =
        constraints.find(
          (constraint): constraint is Extract<Constraint, { kind: "limit" }> =>
            constraint.kind === "limit"
        )?.count ?? documents.length;
      const start = cursor ? cursor.index + 1 : 0;
      return { docs: documents.slice(start, start + pageSize) };
    }
  );

  return {
    setDocuments(next: Array<{ id: string; reviewCount?: number }>) {
      documents = next.map((entry, index) => ({
        id: entry.id,
        index,
        data: () => ({
          dayKey: entry.id,
          reviewCount: entry.reviewCount ?? 1,
          updatedAt: 1,
        }),
      }));
    },
    getDocs,
  };
});

vi.mock("firebase/firestore", () => ({
  collection: (...path: unknown[]) => ({ path }),
  doc: (...path: unknown[]) => ({ path }),
  documentId: () => "__name__",
  getDocs: firestore.getDocs,
  increment: (value: number) => value,
  limit: (count: number) => ({ kind: "limit", count }),
  orderBy: () => ({ kind: "other" }),
  query: (_collection: unknown, ...constraints: unknown[]) => ({ constraints }),
  setDoc: vi.fn(),
  startAfter: (cursor: unknown) => ({ kind: "startAfter", cursor }),
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: <T>(request: Promise<T>) => request,
}));
vi.mock("@/services/dashboard/cache", () => ({
  invalidateDashboardData: vi.fn(),
}));

const { loadDashboardStudyActivity } = await import(
  "@/services/study/activity"
);

const NOW = Date.parse("2026-08-01T18:00:00.000Z");

beforeEach(() => {
  firestore.getDocs.mockClear();
});

describe("loadDashboardStudyActivity", () => {
  it("continues across cursor pages while the streak remains contiguous", async () => {
    const todayKey = getStudyDayKey(NOW);
    firestore.setDocuments(
      Array.from({ length: 40 }, (_, index) => ({
        id: shiftStudyDayKey(todayKey, -index),
      }))
    );

    const activity = await loadDashboardStudyActivity("user-1", NOW);

    expect(activity).toHaveLength(40);
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
  });

  it("stops after the first page once a missing study day ends the streak", async () => {
    const todayKey = getStudyDayKey(NOW);
    firestore.setDocuments(
      [0, 1, 2, 4, 5, 6].map((offset) => ({
        id: shiftStudyDayKey(todayKey, -offset),
      }))
    );

    const activity = await loadDashboardStudyActivity("user-1", NOW);

    expect(activity).toHaveLength(6);
    expect(firestore.getDocs).toHaveBeenCalledOnce();
  });
});
