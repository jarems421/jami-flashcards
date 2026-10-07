import { beforeEach, describe, expect, it, vi } from "vitest";

type Constraint =
  | { kind: "where" | "orderBy" }
  | { kind: "limit"; count: number }
  | { kind: "startAfter"; id: string };

const store = vi.hoisted(() => ({
  ids: [] as string[],
  requests: [] as { after: string | null; limit: number }[],
}));

vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: <T,>(promise: Promise<T>) => promise,
}));
vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  where: (): Constraint => ({ kind: "where" }),
  orderBy: (): Constraint => ({ kind: "orderBy" }),
  documentId: () => "__name__",
  limit: (count: number): Constraint => ({ kind: "limit", count }),
  startAfter: (snapshot: { id: string }): Constraint => ({ kind: "startAfter", id: snapshot.id }),
  query: (_collection: unknown, ...constraints: Constraint[]) => constraints,
  getDocs: async (constraints: Constraint[]) => {
    const size = constraints.find((item) => item.kind === "limit");
    const cursor = constraints.find((item) => item.kind === "startAfter");
    const count = size && "count" in size ? size.count : Infinity;
    const after = cursor && "id" in cursor ? cursor.id : null;
    store.requests.push({ after, limit: count });
    const start = after === null ? 0 : store.ids.indexOf(after) + 1;
    const docs = store.ids.slice(start, start + count).map((id) => ({
      id,
      data: () => ({ userId: "student", deckId: "deck", front: id, back: "", createdAt: 1 }),
    }));
    return { docs };
  },
}));

const { loadUserCards } = await import("@/services/study/cards");

function seed(count: number) {
  store.ids = Array.from({ length: count }, (_, index) => `card-${String(index).padStart(5, "0")}`);
}

beforeEach(() => {
  store.requests = [];
});

describe("loadUserCards", () => {
  it("reads a large account a page at a time and returns every card once", async () => {
    seed(2_500);
    const cards = await loadUserCards("student", { force: true });

    expect(cards).toHaveLength(2_500);
    expect(new Set(cards.map((card) => card.id)).size).toBe(2_500);
    expect(store.requests).toEqual([
      { after: null, limit: 1_000 },
      { after: "card-00999", limit: 1_000 },
      { after: "card-01999", limit: 1_000 },
    ]);
  });

  it("stops after one request when the account fits in a page", async () => {
    seed(12);
    const cards = await loadUserCards("student", { force: true });

    expect(cards.map((card) => card.front)).toEqual(store.ids);
    expect(store.requests).toHaveLength(1);
  });

  it("asks once more when the last page is exactly full, and finds it empty", async () => {
    seed(2_000);
    const cards = await loadUserCards("student", { force: true });

    expect(cards).toHaveLength(2_000);
    expect(store.requests).toHaveLength(3);
  });
});
