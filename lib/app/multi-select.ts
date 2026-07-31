/**
 * Selecting several things from a list.
 *
 * Nothing here is card-specific, though it lived under `lib/study` as
 * `card-selection` and so was never found by the pages that pick decks,
 * topics, sources, or folders — each of which wrote its own toggle.
 */

/** Adds an id if missing, removes it if present. */
export function toggleIdSelection(selectedIds: string[], id: string) {
  return selectedIds.includes(id)
    ? selectedIds.filter((selectedId) => selectedId !== id)
    : [...selectedIds, id];
}

/** Adds ids without duplicating anything already selected. */
export function addIdsToSelection(selectedIds: string[], ids: string[]) {
  return Array.from(new Set([...selectedIds, ...ids]));
}

/**
 * Selects everything between the anchor and the target, in the order the list
 * is displayed. Falls back to selecting just the target when there is no
 * anchor, or when the target is not on screen.
 */
export function selectIdRange(
  selectedIds: string[],
  visibleIds: string[],
  anchorId: string | null,
  targetId: string
) {
  const targetIndex = visibleIds.indexOf(targetId);
  const anchorIndex = anchorId ? visibleIds.indexOf(anchorId) : -1;

  if (targetIndex === -1) {
    return selectedIds;
  }

  if (anchorIndex === -1) {
    return addIdsToSelection(selectedIds, [targetId]);
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return addIdsToSelection(selectedIds, visibleIds.slice(start, end + 1));
}
