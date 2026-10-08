import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  user: { uid: "student", getIdToken: async () => "token" } as { uid: string; getIdToken: () => Promise<string> } | null,
  firestoreReads: 0,
}));

vi.mock("@/services/firebase/client", () => ({
  db: {},
  get auth() {
    return { currentUser: session.user };
  },
}));
vi.mock("@/services/firebase/firestore", () => ({ withTimeout: <T,>(promise: Promise<T>) => promise }));
vi.mock("@/services/cache/device-store", () => ({
  readDeviceCopy: async () => null,
  writeDeviceCopy: async () => undefined,
  clearDeviceCopies: async () => undefined,
}));
vi.mock("firebase/firestore", () => {
  const passthrough = (...args: unknown[]) => ({ args });
  return {
    collection: passthrough, query: passthrough, where: passthrough, orderBy: passthrough,
    limit: passthrough, documentId: passthrough, startAfter: passthrough, doc: passthrough,
    getDocs: async () => {
      session.firestoreReads += 1;
      return { docs: [{ id: "direct", data: () => ({ userId: "student", deckId: "d", front: "Read directly", back: "", createdAt: 1 }) }] };
    },
  };
});

const { loadUserCards } = await import("@/services/study/cards");
const { resetCachedReadsForTests } = await import("@/services/cache/read-through");

const page = (ids: string[], nextCursor: string | null) =>
  new Response(
    JSON.stringify({ cards: ids.map((id) => ({ id, deckId: "d", userId: "student", front: id, back: "", createdAt: 1 })), nextCursor }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  session.user = { uid: "student", getIdToken: async () => "token" };
  session.firestoreReads = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetCachedReadsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadUserCards through the cards route", () => {
  it("reads every page through the route, with the student's token", async () => {
    fetchMock.mockResolvedValueOnce(page(["a", "b"], "b")).mockResolvedValueOnce(page(["c"], null));

    const cards = await loadUserCards("student", { force: true });

    expect(cards.map((card) => card.id)).toEqual(["a", "b", "c"]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/study/cards", "/api/study/cards?after=b"]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer token" });
    expect(session.firestoreReads).toBe(0);
  });

  it("falls back to reading directly when the route cannot answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));

    const cards = await loadUserCards("student", { force: true });

    expect(cards.map((card) => card.front)).toEqual(["Read directly"]);
    expect(session.firestoreReads).toBe(1);
    warn.mockRestore();
  });

  it("reads directly, without asking the route, for anyone but the signed-in student", async () => {
    session.user = null;

    await loadUserCards("student", { force: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.firestoreReads).toBe(1);
  });
});
