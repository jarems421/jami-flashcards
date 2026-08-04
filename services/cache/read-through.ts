/**
 * One read-through cache for owned data, shared by every page.
 *
 * The dashboard pages issue largely the same reads: decks are fetched by six of
 * them, cards by six, topics by six. Today kept a snapshot cache and nobody else
 * kept anything, so moving between tabs re-fetched the same documents every
 * time. What that costs is round trips rather than documents -- which is why it
 * is felt on a phone regardless of how little is stored.
 *
 * This caches at the *service* layer rather than the page layer. A page calls
 * `getDecks(uid)` exactly as before and never learns there is a cache; every
 * caller of that read shares one result.
 *
 * Two partial caches already existed with the right ingredients:
 * `services/dashboard/cache.ts`, which had the windows and the revision
 * invalidation but was keyed by user alone so it could hold only Today's
 * snapshot, and `services/study/active-compatibility.ts`, which was properly
 * keyed but covered only the legacy fallback beside the real query. This is
 * those two generalised, and it is invalidated by the write sites that already
 * call `invalidateDashboardData`.
 */

/** How long a value is served without going back to the server. */
export const CACHED_READ_FRESH_MS = 60_000;
/**
 * How long a value may still be shown while a refresh runs behind it. Past
 * this it is not shown at all: a page waits rather than paint something from
 * ten minutes ago.
 */
export const CACHED_READ_STALE_MS = 5 * 60_000;

/**
 * Why a value can or cannot be trusted, which is not the same question as how
 * old it is.
 *
 * `aged` has merely passed its window: nothing is known to have changed, so it
 * is worth showing while a refresh runs. `superseded` means a write landed
 * after it was read, so it is known to be wrong and is only ever a placeholder
 * -- serving it would show the student their own edit being undone.
 */
export type CachedReadFreshness = "fresh" | "aged" | "superseded";

export type CachedRead<T> = {
  value: T;
  freshness: CachedReadFreshness;
};

type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
  /** The revision in force when this was stored. */
  revision: string;
  userId: string;
};

type CachedReadKey = {
  collection: string;
  /** Distinguishes reads of the same collection with different arguments. */
  params?: string;
  userId: string;
};

const entries = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const userRevisions = new Map<string, number>();
let globalRevision = 0;

function revisionOf(userId: string) {
  return `${globalRevision}:${userRevisions.get(userId) ?? 0}`;
}

export function getCachedReadKey({ collection, params, userId }: CachedReadKey) {
  return params
    ? `${collection}:${params}:${userId}`
    : `${collection}:${userId}`;
}

/**
 * The cached value and how much it can be trusted, or null if there is nothing
 * worth showing. A value stored before an invalidation is never fresh, however
 * recently it was fetched.
 */
export function peekCachedRead<T>(
  key: CachedReadKey,
  options: { now?: number; staleMs?: number } = {}
): CachedRead<T> | null {
  const entry = entries.get(getCachedReadKey(key)) as CacheEntry<T> | undefined;
  if (!entry) return null;

  const now = options.now ?? Date.now();
  const age = now - entry.fetchedAt;
  if (age > (options.staleMs ?? CACHED_READ_STALE_MS)) return null;

  const stillCurrent = entry.revision === revisionOf(key.userId);
  return {
    value: entry.value,
    freshness: !stillCurrent
      ? "superseded"
      : age <= CACHED_READ_FRESH_MS
        ? "fresh"
        : "aged",
  };
}

type CacheListener = () => void;

const listeners = new Map<string, Set<CacheListener>>();

/**
 * Told when a background refresh has replaced one of this user's cached reads.
 *
 * A page reloads by running the load path it already has: the reads it calls
 * are fresh in the cache by then, so it costs nothing and the page needs no
 * knowledge of which read changed.
 */
export function subscribeToCachedReads(userId: string, listener: CacheListener) {
  const forUser = listeners.get(userId) ?? new Set<CacheListener>();
  forUser.add(listener);
  listeners.set(userId, forUser);

  return () => {
    forUser.delete(listener);
    if (forUser.size === 0) listeners.delete(userId);
  };
}

const announcementPending = new Set<string>();

/**
 * Coalesced: a page usually makes several reads at once, and all of them
 * refreshing should reload it once rather than once each.
 */
function announceRefresh(userId: string) {
  if (announcementPending.has(userId)) return;
  announcementPending.add(userId);

  void Promise.resolve().then(() => {
    announcementPending.delete(userId);
    listeners.get(userId)?.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        // One page failing to reload must not stop the others hearing about it.
        console.warn("A cached-read listener failed.", error);
      }
    });
  });
}

export type CachedReadOptions = {
  /** Skip the cache and fetch. Required of any read that feeds a write. */
  force?: boolean;
};

/**
 * Serves the cached value while it is fresh, joins a request already running
 * for the same key, and otherwise fetches.
 *
 * A failed load is never cached, and it does not disturb a value already held:
 * a page that cannot reach the server keeps showing what it had rather than
 * emptying itself.
 */
export function readThroughCache<T>(
  key: CachedReadKey,
  load: () => Promise<T>,
  options: CachedReadOptions & { now?: number } = {}
): Promise<T> {
  const cacheKey = getCachedReadKey(key);
  let servedFromCache = false;

  if (options.force) stats.forced += 1;

  if (!options.force) {
    const cached = peekCachedRead<T>(key, { now: options.now });
    if (cached?.freshness === "fresh") {
      stats.hits += 1;
      return Promise.resolve(cached.value);
    }

    const existing = inFlight.get(cacheKey) as Promise<T> | undefined;
    if (existing) {
      stats.joined += 1;
      return existing;
    }

    // Nothing is known to have changed, so the page paints from what we have
    // and hears about the refresh when it lands. A superseded value is never
    // served this way: something *is* known to have changed, and showing it
    // would be showing the student their own edit being undone.
    if (cached?.freshness === "aged") servedFromCache = true;
  }

  stats.misses += 1;
  const revisionAtStart = revisionOf(key.userId);
  const request = load().then((value) => {
    // A write that landed while this was in flight must not be papered over by
    // the result it raced. The value is still stored -- it is the newest thing
    // anyone has -- but stamped with the revision it was read at, so it reads
    // back as stale and the next caller refreshes it.
    entries.set(cacheKey, {
      value,
      fetchedAt: options.now ?? Date.now(),
      revision: revisionAtStart,
      userId: key.userId,
    });
    return value;
  });

  inFlight.set(cacheKey, request);
  const forget = () => {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  };
  request.then(forget, forget);

  if (servedFromCache) {
    const stale = peekCachedRead<T>(key, { now: options.now });
    if (stale) {
      // The refresh is already running; whoever is listening reloads when it
      // lands. A failed one is swallowed here because the caller has been given
      // a value and is not waiting on this.
      void request.then(
        () => announceRefresh(key.userId),
        () => undefined
      );
      return Promise.resolve(stale.value);
    }
  }

  return request;
}

/**
 * Marks everything this user has cached as out of date.
 *
 * Coarse on purpose. A write knows which collection it touched, but it rarely
 * knows which *reads* that collection feeds -- deleting a deck changes deck
 * lists, card counts and folder contents. Being coarse costs a background
 * refresh, and being precise costs correctness the first time somebody adds a
 * read and forgets to widen an invalidation.
 */
export function invalidateCachedReads(userId: string) {
  userRevisions.set(userId, (userRevisions.get(userId) ?? 0) + 1);
}

/** For writes whose public API predates knowing which user they belong to. */
export function invalidateAllCachedReads() {
  globalRevision += 1;
}

/** Drops a user's cached data outright, as sign-out must. */
export function clearCachedReads(userId: string) {
  for (const [cacheKey, entry] of entries) {
    if (entry.userId === userId) entries.delete(cacheKey);
  }
  for (const cacheKey of inFlight.keys()) {
    if (cacheKey.endsWith(`:${userId}`)) inFlight.delete(cacheKey);
  }
  userRevisions.delete(userId);
}

export type CachedReadStats = {
  /** Reads answered without going to the server. */
  hits: number;
  /** Reads that went to the server. */
  misses: number;
  /** Callers that joined a request already on the wire. */
  joined: number;
  /** Reads that went to the server because a caller insisted. */
  forced: number;
};

const stats: CachedReadStats = { hits: 0, misses: 0, joined: 0, forced: 0 };

/**
 * What the cache has actually done this session.
 *
 * The claim this whole change rests on -- that the pages were re-reading the
 * same data -- was measured before it was believed, and this is what lets the
 * result be measured the same way rather than asserted. Exposed on `window` in
 * development so it can be read from a real device, where the round trips that
 * motivated the work actually cost something.
 */
export function getCachedReadStats(): CachedReadStats {
  return { ...stats };
}

export function resetCachedReadStats() {
  stats.hits = 0;
  stats.misses = 0;
  stats.joined = 0;
  stats.forced = 0;
}

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (
    window as Window & { jamiCacheStats?: () => CachedReadStats }
  ).jamiCacheStats = getCachedReadStats;
}

/** Test seam. Production code has no reason to empty every user's cache. */
export function resetCachedReadsForTests() {
  resetCachedReadStats();
  entries.clear();
  inFlight.clear();
  userRevisions.clear();
  listeners.clear();
  announcementPending.clear();
  globalRevision = 0;
}
