export function toggleCardIdSelection(selectedIds: string[], cardId: string) {
  return selectedIds.includes(cardId)
    ? selectedIds.filter((selectedId) => selectedId !== cardId)
    : [...selectedIds, cardId];
}

export function addCardIdsToSelection(selectedIds: string[], cardIds: string[]) {
  return Array.from(new Set([...selectedIds, ...cardIds]));
}

export function selectCardRange(
  selectedIds: string[],
  visibleCardIds: string[],
  anchorCardId: string | null,
  targetCardId: string
) {
  const targetIndex = visibleCardIds.indexOf(targetCardId);
  const anchorIndex = anchorCardId ? visibleCardIds.indexOf(anchorCardId) : -1;

  if (targetIndex === -1) {
    return selectedIds;
  }

  if (anchorIndex === -1) {
    return addCardIdsToSelection(selectedIds, [targetCardId]);
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return addCardIdsToSelection(selectedIds, visibleCardIds.slice(start, end + 1));
}
