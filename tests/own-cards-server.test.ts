import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; args: unknown[] };

const store = vi.hoisted(() => ({
  ids: [] as string[],
  calls: [] as Call[],
}));

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", () => ({ FieldPath: { documentId: () => "__name__" } }));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => {
    const state = { uid: "", after: null as string | null, limit: Infinity };
    const query = {
      where: (field: string, op: string, value: string) => {
        store.calls.push({ method: "where", args: [field, op, value] });
        state.uid = value;
        return query;
      },
      orderBy: (...args: unknown[]) => {
        store.calls.push({ method: "orderBy", args });
        return query;
      },
      limit: (count: number) => {
        state.limit = count;
        return query;
      },
      startAfter: (id: string) => {
        state.after = id;
        return query;
      },
      get: async () => {
        const start = state.after === null ? 0 : store.ids.indexOf(state.after) + 1;
        return {
          docs: store.ids.slice(start, start + state.limit).map((id) => ({
            id,
            data: () => ({ userId: state.uid, deckId: "deck", front: id, back: "", createdAt: 1 }),
          })),
        };
      },
    };
    return { collection: () => query };
  },
}));

const { readOwnCardsPage } = await import("@/services/study/own-cards.server");

beforeEach(() => {
  store.ids = Array.from({ length: 5 }, (_, index) => `card-${index}`);
  store.calls = [];
});

describe("readOwnCardsPage", () => {
  it("reads only the caller's cards", async () => {
    await readOwnCardsPage("student", { limit: 2 });
    expect(store.calls).toContainEqual({ method: "where", args: ["userId", "==", "student"] });
  });

  it("pages through in id order and says where to read on from", async () => {
    const first = await readOwnCardsPage("student", { limit: 2 });
    expect(first.cards.map((card) => card.id)).toEqual(["card-0", "card-1"]);
    expect(first.nextCursor).toBe("card-1");

    const second = await readOwnCardsPage("student", { after: first.nextCursor, limit: 2 });
    expect(second.cards.map((card) => card.id)).toEqual(["card-2", "card-3"]);

    const last = await readOwnCardsPage("student", { after: second.nextCursor, limit: 2 });
    expect(last.cards.map((card) => card.id)).toEqual(["card-4"]);
    expect(last.nextCursor).toBeNull();
  });

  it("knows a full last page is the last, without an empty page after it", async () => {
    store.ids = ["a", "b"];
    expect(await readOwnCardsPage("student", { limit: 2 })).toMatchObject({ nextCursor: null });
  });
});
