import { beforeEach, describe, expect, it, vi } from "vitest";

type CountQuery = { filters: string[] };

const firestore = vi.hoisted(() => ({
  counts: new Map<string, number | Error>(),
}));

vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string): CountQuery => ({ filters: [name] }),
  where: (field: string, op: string, value: unknown) => `${field}${op}${typeof value === "number" ? "now" : String(value)}`,
  query: (base: CountQuery, ...filters: string[]): CountQuery => ({ filters: [...base.filters, ...filters] }),
  getCountFromServer: async (target: CountQuery) => {
    const result = firestore.counts.get(target.filters.join(" "));
    if (result instanceof Error) throw result;
    if (result === undefined) throw new Error(`unexpected query ${target.filters.join(" ")}`);
    return { data: () => ({ count: result }) };
  },
}));

const { getDeckCardCount } = await import("@/services/study/deck-counts");

const TOTAL = "cards userId==student deckId==deck-1";
const LATER = `${TOTAL} dueDate>now`;

beforeEach(() => {
  firestore.counts.clear();
});

describe("getDeckCardCount", () => {
  it("counts the deck's cards and the due ones on the server", async () => {
    firestore.counts.set(TOTAL, 120);
    firestore.counts.set(LATER, 45);

    await expect(getDeckCardCount("student", "deck-1", { force: true })).resolves.toEqual({ total: 120, due: 75 });
  });

  it("keeps the total when the due count cannot be served, as before its index exists", async () => {
    firestore.counts.set(TOTAL, 120);
    firestore.counts.set(LATER, new Error("FAILED_PRECONDITION: The query requires an index."));

    await expect(getDeckCardCount("student", "deck-1", { force: true })).resolves.toEqual({ total: 120, due: null });
  });

  it("fails when the total cannot be counted, rather than showing a wrong number", async () => {
    firestore.counts.set(TOTAL, new Error("unavailable"));
    firestore.counts.set(LATER, 3);

    await expect(getDeckCardCount("student", "deck-1", { force: true })).rejects.toThrow("unavailable");
  });
});
