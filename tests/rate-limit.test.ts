import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/http/rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit and then refuses", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1_000 });
    const results = [0, 0, 0, 0].map(() => limiter.check("user", 0));

    expect(results.map((entry) => entry.allowed)).toEqual([true, true, true, false]);
    expect(results[2].remaining).toBe(0);
  });

  it("says how long to wait, in whole seconds", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.check("user", 0);
    expect(limiter.check("user", 10_000).retryAfterSeconds).toBe(50);
  });

  it("starts a fresh window once the old one has passed", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    limiter.check("user", 0);
    expect(limiter.check("user", 999).allowed).toBe(false);
    expect(limiter.check("user", 1_000).allowed).toBe(true);
  });

  it("keeps callers apart", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
  });

  /*
   * A flood of distinct keys is the thing being defended against, so it must
   * not be the thing that exhausts memory.
   */
  it("evicts the least recently seen key rather than growing without bound", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    limiter.check("first", 0);
    limiter.check("second", 0);
    limiter.check("third", 0);

    // "first" was evicted, so its window starts again rather than staying full.
    expect(limiter.check("first", 0).allowed).toBe(true);
    expect(limiter.check("third", 0).allowed).toBe(false);
  });
});
