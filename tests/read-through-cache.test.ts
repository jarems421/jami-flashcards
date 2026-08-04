import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHED_READ_FRESH_MS,
  CACHED_READ_STALE_MS,
  clearCachedReads,
  getCachedReadKey,
  invalidateAllCachedReads,
  invalidateCachedReads,
  peekCachedRead,
  readThroughCache,
  resetCachedReadsForTests,
} from "@/services/cache/read-through";

/**
 * The behaviour every page depends on: the same read issued twice does not go
 * back to the server twice. The rule that keeps it safe rather than dangerous
 * is that a read feeding a write must force, and that is pinned here too.
 */

const decks = (userId = "student") => ({ collection: "decks", userId });

beforeEach(() => {
  resetCachedReadsForTests();
});

describe("readThroughCache", () => {
  it("issues one read for repeated callers", async () => {
    const load = vi.fn(async () => ["a"]);

    expect(await readThroughCache(decks(), load)).toEqual(["a"]);
    expect(await readThroughCache(decks(), load)).toEqual(["a"]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("joins a request already in flight rather than starting another", async () => {
    let release: (value: string[]) => void = () => {};
    const load = vi.fn(
      () => new Promise<string[]>((resolve) => (release = resolve))
    );

    const first = readThroughCache(decks(), load);
    const second = readThroughCache(decks(), load);
    release(["a"]);

    expect(await first).toEqual(["a"]);
    expect(await second).toEqual(["a"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("goes back to the server once the value is no longer fresh", async () => {
    const load = vi.fn(async () => ["a"]);
    const start = 1_000_000;

    await readThroughCache(decks(), load, { now: start });
    await readThroughCache(decks(), load, {
      now: start + CACHED_READ_FRESH_MS + 1,
    });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps different users apart", async () => {
    const load = vi.fn(async () => ["a"]);

    await readThroughCache(decks("one"), load);
    await readThroughCache(decks("two"), load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps different arguments to the same read apart", async () => {
    const load = vi.fn(async () => ["a"]);

    await readThroughCache({ ...decks(), params: "folder-1" }, load);
    await readThroughCache({ ...decks(), params: "folder-2" }, load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  /**
   * A read whose result is written back must never see a stale value: grading
   * a card computes its next state from its current one.
   */
  it("goes to the server when forced, however fresh the cache", async () => {
    const load = vi.fn(async () => ["a"]);

    await readThroughCache(decks(), load);
    await readThroughCache(decks(), load, { force: true });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure, and leaves the last good value alone", async () => {
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["a"])
      .mockRejectedValueOnce(new Error("offline"));
    const start = 1_000_000;

    await readThroughCache(decks(), load, { now: start });
    await expect(
      readThroughCache(decks(), load, { force: true, now: start })
    ).rejects.toThrow("offline");

    // Still showing what it had, rather than nothing.
    expect(peekCachedRead(decks(), { now: start })?.value).toEqual(["a"]);
  });

  it("lets a caller retry after a failure instead of joining the failed request", async () => {
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(["a"]);

    await expect(readThroughCache(decks(), load)).rejects.toThrow("offline");

    expect(await readThroughCache(decks(), load)).toEqual(["a"]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("invalidation", () => {
  it("stops a value being served as fresh once a write lands", async () => {
    const load = vi.fn(async () => ["a"]);
    const start = 1_000_000;

    await readThroughCache(decks(), load, { now: start });
    invalidateCachedReads("student");
    await readThroughCache(decks(), load, { now: start });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps showing the old value while the refresh runs", async () => {
    const load = vi.fn(async () => ["a"]);
    const start = 1_000_000;

    await readThroughCache(decks(), load, { now: start });
    invalidateCachedReads("student");

    expect(peekCachedRead(decks(), { now: start })).toEqual({
      value: ["a"],
      freshness: "stale",
    });
  });

  it("does not invalidate another user's reads", async () => {
    const load = vi.fn(async () => ["a"]);
    const start = 1_000_000;

    await readThroughCache(decks("one"), load, { now: start });
    invalidateCachedReads("two");
    await readThroughCache(decks("one"), load, { now: start });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("invalidates every user when the write does not know whose it is", async () => {
    const load = vi.fn(async () => ["a"]);
    const start = 1_000_000;

    await readThroughCache(decks("one"), load, { now: start });
    invalidateAllCachedReads();
    await readThroughCache(decks("one"), load, { now: start });

    expect(load).toHaveBeenCalledTimes(2);
  });

  /**
   * A write can land while a read of the same data is already on the wire. The
   * result is still the newest anyone has, so it is kept -- but it must not be
   * trusted as fresh, or the write would appear to have been lost until the
   * window expired.
   */
  it("does not let a read that raced a write come back fresh", async () => {
    let release: (value: string[]) => void = () => {};
    const load = () => new Promise<string[]>((resolve) => (release = resolve));
    const start = 1_000_000;

    const request = readThroughCache(decks(), load, { now: start });
    invalidateCachedReads("student");
    release(["a"]);
    await request;

    expect(peekCachedRead(decks(), { now: start })?.freshness).toBe("stale");
  });
});

describe("peekCachedRead", () => {
  it("has nothing to offer before anything is read", () => {
    expect(peekCachedRead(decks())).toBeNull();
  });

  it("refuses to offer a value old enough to be misleading", async () => {
    const load = vi.fn(async () => ["a"]);
    const start = 1_000_000;

    await readThroughCache(decks(), load, { now: start });

    expect(
      peekCachedRead(decks(), { now: start + CACHED_READ_STALE_MS + 1 })
    ).toBeNull();
  });
});

describe("clearCachedReads", () => {
  it("drops that user's data and leaves everyone else's", async () => {
    const load = vi.fn(async () => ["a"]);
    const start = 1_000_000;

    await readThroughCache(decks("one"), load, { now: start });
    await readThroughCache(decks("two"), load, { now: start });
    clearCachedReads("one");

    expect(peekCachedRead(decks("one"), { now: start })).toBeNull();
    expect(peekCachedRead(decks("two"), { now: start })?.value).toEqual(["a"]);
  });
});

describe("getCachedReadKey", () => {
  it("separates collections, users and arguments", () => {
    expect(getCachedReadKey({ collection: "decks", userId: "one" })).toBe(
      "decks:one"
    );
    expect(
      getCachedReadKey({ collection: "decks", params: "f1", userId: "one" })
    ).toBe("decks:f1:one");
  });
});
