import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  user: { uid: "student", getIdToken: async () => "token" } as { uid: string; getIdToken: () => Promise<string> } | null,
  directReads: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          select: () => ({
            get: async () => ({ docs: store.events.map((data) => ({ data: () => data })) }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/services/firebase/client", () => ({
  db: {},
  get auth() {
    return { currentUser: store.user };
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
    collection: passthrough, query: passthrough, orderBy: passthrough,
    getDocs: async () => {
      store.directReads += 1;
      return { docs: [{ id: "e1", data: () => ({ topicId: "t1", scoreDelta: -2 }) }] };
    },
  };
});

const { readTopicMasterySums } = await import("@/services/study/mastery-summary.server");
const { getMasteryEvents } = await import("@/services/study/mastery");
const { resetCachedReadsForTests } = await import("@/services/cache/read-through");
const { buildTopicProgress } = await import("@/lib/material/progress");

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  store.events = [];
  store.user = { uid: "student", getIdToken: async () => "token" };
  store.directReads = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetCachedReadsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readTopicMasterySums", () => {
  it("adds up each topic's events, counting a missing score as nothing", async () => {
    store.events = [
      { topicId: "t1", scoreDelta: 4, createdAt: 10 },
      { topicId: "t1", scoreDelta: -6, createdAt: 30 },
      { topicId: "t2", createdAt: 20 },
      { scoreDelta: 9 },
    ];

    expect(await readTopicMasterySums("student")).toEqual([
      { topicId: "t1", scoreDelta: -2, lastAt: 30 },
      { topicId: "t2", scoreDelta: 0, lastAt: 20 },
    ]);
  });
});

describe("getMasteryEvents through the route", () => {
  it("gives Today the same topic scores as the events themselves would", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ topics: [{ topicId: "t1", scoreDelta: -2, lastAt: 30 }] })
    );

    const events = await getMasteryEvents("student");
    const [progress] = buildTopicProgress({
      topics: [{ id: "t1", name: "Cells", status: "active" } as never],
      cards: [],
      masteryEvents: events,
    });

    expect(progress?.masteryScore).toBe(-2);
    expect(store.directReads).toBe(0);
  });

  it("reads the events directly when the route cannot answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));

    const events = await getMasteryEvents("student");

    expect(events.map((event) => event.scoreDelta)).toEqual([-2]);
    expect(store.directReads).toBe(1);
    warn.mockRestore();
  });
});
