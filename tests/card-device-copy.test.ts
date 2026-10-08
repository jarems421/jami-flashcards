import { beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({ copies: new Map<string, unknown>() }));
const server = vi.hoisted(() => ({
  reads: 0,
  cards: [] as Array<{ id: string; front: string }>,
  release: null as (() => void) | null,
}));

vi.mock("@/services/cache/device-store", () => ({
  readDeviceCopy: async (key: string) => device.copies.get(key) ?? null,
  writeDeviceCopy: async (key: string, value: unknown) => {
    device.copies.set(key, value);
  },
  clearDeviceCopies: async (prefix = "") => {
    for (const key of [...device.copies.keys()]) if (key.startsWith(prefix)) device.copies.delete(key);
  },
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({ withTimeout: <T,>(promise: Promise<T>) => promise }));
vi.mock("firebase/firestore", () => {
  const passthrough = (...args: unknown[]) => ({ args });
  return {
    collection: passthrough, query: passthrough, where: passthrough, orderBy: passthrough,
    limit: passthrough, documentId: passthrough, startAfter: passthrough, doc: passthrough,
    getDocs: async () => {
      server.reads += 1;
      if (server.release) await new Promise<void>((resolve) => { server.release = resolve; });
      return {
        docs: server.cards.map((card) => ({ id: card.id, data: () => ({ userId: "student", deckId: "deck", front: card.front, back: "", createdAt: 1 }) })),
      };
    },
  };
});

const { readDeviceCardSet, keepDeviceCardSet, forgetDeviceCardSets } = await import("@/services/study/card-device-copy");
const { loadUserCards } = await import("@/services/study/cards");
const { invalidateDashboardData } = await import("@/services/dashboard/cache");
const { DEVICE_COPY_REFRESH_DELAY_MS, resetCachedReadsForTests } = await import("@/services/cache/read-through");

const card = (id: string, front: string) => ({ id, deckId: "deck", userId: "student", front, back: "", createdAt: 1, tags: [], topicIds: [] });

beforeEach(() => {
  device.copies.clear();
  server.reads = 0;
  server.cards = [{ id: "c1", front: "From the server" }];
  server.release = null;
  resetCachedReadsForTests();
});

describe("the device's copy of a student's cards", () => {
  it("is read back for the same student only, and not once it is a week old", async () => {
    const now = Date.now();
    device.copies.set("cards:student", { userId: "student", savedAt: now - 1_000, cards: [card("c1", "Kept")] });
    expect((await readDeviceCardSet("student", now))?.map((kept) => kept.front)).toEqual(["Kept"]);
    expect(await readDeviceCardSet("someone-else", now)).toBeNull();
    expect(await readDeviceCardSet("student", now + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("drops anything in it that is not a card", async () => {
    device.copies.set("cards:student", { userId: "student", savedAt: Date.now(), cards: [card("c1", "Kept"), "junk", { front: "no id" }] });
    expect((await readDeviceCardSet("student"))?.map((kept) => kept.id)).toEqual(["c1"]);
  });

  it("draws a page at once from the copy, and asks the server once the page's own reads have gone", async () => {
    vi.useFakeTimers();
    try {
      await keepDeviceCardSet("student", [card("c1", "From the device")]);

      const first = await loadUserCards("student");
      expect(first.map((shown) => shown.front)).toEqual(["From the device"]);
      expect((await loadUserCards("student")).map((shown) => shown.front)).toEqual(["From the device"]);
      expect(server.reads).toBe(0);

      await vi.advanceTimersByTimeAsync(DEVICE_COPY_REFRESH_DELAY_MS);
      expect(server.reads).toBe(1);
      expect((await loadUserCards("student")).map((shown) => shown.front)).toEqual(["From the server"]);
      expect((await readDeviceCardSet("student"))?.map((kept) => kept.front)).toEqual(["From the server"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes straight to the server for anything that grades or edits", async () => {
    await keepDeviceCardSet("student", [card("c1", "From the device")]);
    expect((await loadUserCards("student", { force: true })).map((shown) => shown.front)).toEqual(["From the server"]);
  });

  it("is forgotten when the student writes, so a page never shows their edit undone", async () => {
    await keepDeviceCardSet("student", [card("c1", "Before the edit")]);
    invalidateDashboardData("student");
    await vi.waitFor(async () => expect(await readDeviceCardSet("student")).toBeNull());
  });

  it("does not keep a set read while a write landed", async () => {
    server.release = () => undefined;
    const reading = loadUserCards("student", { force: true });
    await vi.waitFor(() => expect(server.reads).toBe(1));
    invalidateDashboardData("student");
    server.release?.();
    await reading;
    expect(await readDeviceCardSet("student")).toBeNull();
  });

  it("can be forgotten for everyone on the device", async () => {
    await keepDeviceCardSet("student", [card("c1", "One")]);
    await keepDeviceCardSet("other", [card("c2", "Two")]);
    await forgetDeviceCardSets();
    expect(device.copies.size).toBe(0);
  });
});
