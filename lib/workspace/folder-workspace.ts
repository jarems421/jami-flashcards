/** How many notebooks, decks or sources a folder page reads at a time. */
export const FOLDER_ASSET_PAGE_SIZE = 30;

/** "Edited recently", "Edited 3h ago", "Edited 2d ago", then the date. */
export function formatEditedLabel(updatedAt: number, now = Date.now()) {
  const elapsed = Math.max(0, now - updatedAt);
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Edited recently";
  if (hours < 24) return `Edited ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Edited ${days}d ago`;
  return `Edited ${new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(updatedAt)}`;
}

/**
 * A further page folded into a list already shown: one entry per id, the
 * page's copy winning, newest first by `timeOf`.
 */
export function mergeNewestFirst<T extends { id: string }>(
  current: T[],
  page: T[],
  timeOf: (item: T) => number
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of page) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => timeOf(right) - timeOf(left));
}
