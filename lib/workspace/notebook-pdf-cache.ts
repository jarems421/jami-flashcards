export function createNotebookPdfDocumentCache<T>(
  load: (storagePath: string) => Promise<T>,
  maxEntries = 6,
  dispose?: (value: T) => void | Promise<void>
) {
  type CacheEntry = { promise: Promise<T>; disposeRequested: boolean };
  const entries = new Map<string, CacheEntry>();

  const disposeEntry = (entry: CacheEntry) => {
    if (!dispose || entry.disposeRequested) return;
    entry.disposeRequested = true;
    void entry.promise.then(dispose).catch(() => undefined);
  };

  return {
    get(storagePath: string) {
      const cached = entries.get(storagePath);
      if (cached) {
        entries.delete(storagePath);
        entries.set(storagePath, cached);
        return cached.promise;
      }

      const pending = load(storagePath);
      const entry: CacheEntry = { promise: pending, disposeRequested: false };
      entries.set(storagePath, entry);
      pending.catch(() => {
        if (entries.get(storagePath) === entry) entries.delete(storagePath);
      });

      while (entries.size > Math.max(1, maxEntries)) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        const oldest = entries.get(oldestKey);
        entries.delete(oldestKey);
        if (oldest) disposeEntry(oldest);
      }

      return pending;
    },
    invalidate(storagePath: string) {
      const entry = entries.get(storagePath);
      entries.delete(storagePath);
      if (entry) disposeEntry(entry);
    },
    clear() {
      entries.forEach(disposeEntry);
      entries.clear();
    },
  };
}
