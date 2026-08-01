type DashboardCacheEntry<T> = {
  value: T;
  fetchedAt: number;
  hasDegradedSections: boolean;
  invalidated?: boolean;
};

const entries = new Map<string, DashboardCacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const userRevisions = new Map<string, number>();
let globalRevision = 0;

export function getDashboardCacheRevision(userId: string) {
  return `${globalRevision}:${userRevisions.get(userId) ?? 0}`;
}

export function getDashboardCacheEntry<T>(userId: string) {
  return entries.get(userId) as DashboardCacheEntry<T> | undefined;
}

export function setDashboardCacheEntry<T>(
  userId: string,
  entry: DashboardCacheEntry<T>
) {
  entries.set(userId, entry as DashboardCacheEntry<unknown>);
}

export function getDashboardInFlight<T>(userId: string) {
  return inFlight.get(userId) as Promise<T> | undefined;
}

export function setDashboardInFlight<T>(userId: string, request: Promise<T>) {
  inFlight.set(userId, request as Promise<unknown>);
}

export function clearDashboardInFlight(userId: string, request: Promise<unknown>) {
  if (inFlight.get(userId) === request) {
    inFlight.delete(userId);
  }
}

/**
 * Domain writes call this after they commit so Today never treats an older
 * in-memory snapshot as fresh. The value remains available as stale UI while
 * the next request refreshes it.
 */
export function invalidateDashboardData(userId: string) {
  userRevisions.set(userId, (userRevisions.get(userId) ?? 0) + 1);
  const entry = entries.get(userId);
  if (!entry) return;
  entries.set(userId, { ...entry, invalidated: true });
}

/** Used by legacy card operations whose public API predates a userId input. */
export function invalidateAllDashboardData() {
  globalRevision += 1;
  entries.forEach((entry, userId) => {
    entries.set(userId, { ...entry, invalidated: true });
  });
}

export function clearDashboardData(userId: string) {
  entries.delete(userId);
  inFlight.delete(userId);
  userRevisions.delete(userId);
}
