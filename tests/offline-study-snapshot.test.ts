// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({ copies: new Map<string, unknown>() }));
vi.mock("@/services/cache/device-store", () => ({
  readDeviceCopy: async (key: string) => device.copies.get(key) ?? null,
  writeDeviceCopy: async (key: string, value: unknown) => {
    device.copies.set(key, value);
  },
}));

const { keepOfflineStudySnapshot, readOfflineStudySnapshot } = await import("@/services/study/offline-study-snapshot");

const card = (id: string, front: string) => ({ id, deckId: "deck", userId: "student", front, back: "", createdAt: 1, tags: [], topicIds: [] });
const deck = { id: "deck", name: "Biology", userId: "student", createdAt: 1, colorPreset: "sky" as const, iconPreset: "none" as const, folderIds: [] };
const legacyKey = "jami:offline-study:snapshot:student";

beforeEach(() => {
  device.copies.clear();
  window.localStorage.clear();
  vi.stubGlobal("indexedDB", {});
  vi.useFakeTimers();
});

afterEach(async () => {
  // Writes still waiting belong to the test that made them.
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the offline study snapshot", () => {
  it("is written once, shortly after the last of several quick changes", async () => {
    keepOfflineStudySnapshot("student", { cards: [card("c1", "First")], decks: [deck] });
    keepOfflineStudySnapshot("student", { cards: [card("c1", "Second")], decks: [deck] });
    expect(device.copies.size).toBe(0);

    await vi.advanceTimersByTimeAsync(1_500);

    expect(device.copies.size).toBe(1);
    expect((await readOfflineStudySnapshot("student"))?.cards.map((kept) => kept.front)).toEqual(["Second"]);
  });

  it("answers with a change still waiting to be written", async () => {
    keepOfflineStudySnapshot("student", { cards: [card("c1", "Waiting")], decks: [deck] });
    expect((await readOfflineStudySnapshot("student"))?.cards.map((kept) => kept.front)).toEqual(["Waiting"]);
  });

  it("reads back cards and decks checked one by one, dropping anything malformed", async () => {
    device.copies.set("offline-study:student", {
      userId: "student",
      savedAt: 5,
      cards: [card("c1", "Kept"), "junk"],
      decks: [deck, { name: "no id" }],
    });

    const snapshot = await readOfflineStudySnapshot("student");

    expect(snapshot?.cards.map((kept) => kept.id)).toEqual(["c1"]);
    expect(snapshot?.decks.map((kept) => kept.name)).toEqual(["Biology"]);
    expect(snapshot?.savedAt).toBe(5);
  });

  it("still finds a snapshot an older version left in localStorage, and frees that space once written anew", async () => {
    window.localStorage.setItem(legacyKey, JSON.stringify({ userId: "student", savedAt: 1, cards: [card("c1", "Old")], decks: [] }));
    expect((await readOfflineStudySnapshot("student"))?.cards.map((kept) => kept.front)).toEqual(["Old"]);

    keepOfflineStudySnapshot("student", { cards: [card("c1", "New")], decks: [] });
    await vi.advanceTimersByTimeAsync(1_500);

    expect(window.localStorage.getItem(legacyKey)).toBeNull();
  });

  it("keeps using localStorage on a device with no IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    keepOfflineStudySnapshot("student", { cards: [card("c1", "Here")], decks: [] });
    await vi.advanceTimersByTimeAsync(1_500);

    expect(device.copies.size).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(legacyKey) ?? "null")?.cards?.[0]?.front).toBe("Here");
  });
});
