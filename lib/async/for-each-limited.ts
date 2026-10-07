/**
 * Runs `task` over `items` with at most `limit` in flight, in order of the list.
 *
 * Each task settles on its own: one that rejects does not stop the rest, and
 * the caller handles its own failures inside `task`. Resolves when every task
 * has settled, or stops starting new ones once `shouldStop` says so.
 */
export async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !shouldStop()) {
      const item = items[next];
      next += 1;
      try {
        await task(item);
      } catch {
        // The task owns its failure; one bad item never stops the others.
      }
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: workers }, worker));
}
