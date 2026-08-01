export type ActiveCompatibilityRecord = {
  id: string;
  data: Record<string, unknown>;
};

type ActiveCompatibilityCacheEntry = {
  expiresAt: number;
  records: Promise<readonly ActiveCompatibilityRecord[]>;
};

const LEGACY_ACTIVE_CACHE_MS = 60_000;
const legacyActiveCache = new Map<string, ActiveCompatibilityCacheEntry>();

function getCacheKey(userId: string, collectionName: string) {
  return `${collectionName}:${userId}`;
}

/**
 * Firestore equality filters exclude documents where the filtered field is
 * absent. Early Jami records did not always persist their lifecycle field, so
 * active-list services retain a short-lived, in-flight-deduplicated fallback
 * while those legacy shapes remain readable without a destructive migration.
 */
export async function loadCachedLegacyActiveRecords(
  userId: string,
  collectionName: string,
  load: () => Promise<readonly ActiveCompatibilityRecord[]>
) {
  const cacheKey = getCacheKey(userId, collectionName);
  const now = Date.now();
  const cached = legacyActiveCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.records;

  const records = load();
  const entry = {
    expiresAt: now + LEGACY_ACTIVE_CACHE_MS,
    records,
  };
  legacyActiveCache.set(cacheKey, entry);

  try {
    return await records;
  } catch (error) {
    if (legacyActiveCache.get(cacheKey) === entry) {
      legacyActiveCache.delete(cacheKey);
    }
    throw error;
  }
}

export function invalidateLegacyActiveRecords(
  userId: string,
  collectionName: string
) {
  const exactKey = getCacheKey(userId, collectionName);
  legacyActiveCache.delete(exactKey);
  // A domain write must also invalidate membership-scoped compatibility
  // snapshots such as `notebooks:folder:<id>:<userId>`.
  for (const key of legacyActiveCache.keys()) {
    if (
      key.startsWith(`${collectionName}:`) &&
      key.endsWith(`:${userId}`)
    ) {
      legacyActiveCache.delete(key);
    }
  }
}

export function mergeActiveItems<
  T extends { id: string; updatedAt: number },
>(
  currentItems: readonly T[],
  legacyItems: readonly T[],
  maximum = Number.POSITIVE_INFINITY
): T[] {
  const byId = new Map<string, T>();
  legacyItems.forEach((item) => byId.set(item.id, item));
  // The direct lifecycle-filtered query is always fresher than the cached
  // compatibility result if a record appears in both during a transition.
  currentItems.forEach((item) => byId.set(item.id, item));

  return Array.from(byId.values())
    .sort((left, right) => {
      const updatedAtDifference = right.updatedAt - left.updatedAt;
      if (updatedAtDifference !== 0) return updatedAtDifference;
      if (left.id === right.id) return 0;
      return left.id < right.id ? 1 : -1;
    })
    .slice(0, maximum);
}

export function isAfterActiveCursor(
  item: { id: string; updatedAt: number },
  cursor: { id: string; updatedAt: number }
) {
  return (
    item.updatedAt < cursor.updatedAt ||
    (item.updatedAt === cursor.updatedAt && item.id < cursor.id)
  );
}
