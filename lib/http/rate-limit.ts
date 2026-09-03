/**
 * A small per-instance rate limit, for authenticated routes that are cheap
 * enough not to deserve a round trip to enforce one.
 *
 * Honest about what it is. The state lives in the memory of whichever serverless
 * instance answered, so a caller spread across instances gets a higher effective
 * limit, and a cold start forgets everything. What it reliably stops is one
 * client hammering one instance -- a retry loop that lost its backoff, a page
 * stuck re-requesting -- which is the failure these routes actually see.
 *
 * It is deliberately not the tool for anything expensive. The AI paths are
 * metered and capped in Firestore precisely because their limits have to hold
 * across instances and survive a restart; this trades that guarantee away to
 * cost nothing on a hot path.
 */

export type RateLimitDecision = {
  allowed: boolean;
  /** Whole seconds until the caller may retry, when refused. */
  retryAfterSeconds: number;
  remaining: number;
};

export type RateLimiter = {
  check: (key: string, now?: number) => RateLimitDecision;
};

/**
 * A fixed window per key.
 *
 * Fixed rather than sliding because the difference only matters at a burst
 * across a window boundary, and a sliding window costs a timestamp list per
 * caller -- unbounded memory in exactly the case being defended against.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  /** Stops a flood of distinct keys from becoming the memory leak. */
  maxKeys?: number;
}): RateLimiter {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1, Math.floor(options.windowMs));
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? 5_000));
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    check(key, now = Date.now()) {
      const existing = windows.get(key);
      const current =
        existing && now - existing.startedAt < windowMs
          ? existing
          : { startedAt: now, count: 0 };

      if (current.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((current.startedAt + windowMs - now) / 1000)
          ),
          remaining: 0,
        };
      }

      current.count += 1;
      // Re-inserting moves the key to the end of the Map's insertion order,
      // which is what makes the eviction below drop the least recently used.
      windows.delete(key);
      windows.set(key, current);

      if (windows.size > maxKeys) {
        const oldest = windows.keys().next();
        if (!oldest.done) windows.delete(oldest.value);
      }

      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: limit - current.count,
      };
    },
  };
}
