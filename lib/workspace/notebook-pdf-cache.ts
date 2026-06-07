export function createNotebookPdfDocumentCache<T>(
  load: (storagePath: string) => Promise<T>,
  maxEntries = 6
) {
  const entries = new Map<string, Promise<T>>();

  return {
    get(storagePath: string) {
      const cached = entries.get(storagePath);
      if (cached) {
        entries.delete(storagePath);
        entries.set(storagePath, cached);
        return cached;
      }

      const pending = load(storagePath);
      entries.set(storagePath, pending);
      pending.catch(() => {
        if (entries.get(storagePath) === pending) entries.delete(storagePath);
      });

      while (entries.size > Math.max(1, maxEntries)) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }

      return pending;
    },
    invalidate(storagePath: string) {
      entries.delete(storagePath);
    },
  };
}
