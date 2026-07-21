export function getLinkedSourceFolders<T extends { id: string }>(
  folderIds: readonly string[],
  folders: readonly T[]
) {
  const linkedIds = new Set(folderIds);
  return folders.filter((folder) => linkedIds.has(folder.id));
}

export function canRemoveSourceFromFilteredFolder(
  folderFilter: string,
  folderIds: readonly string[]
) {
  return Boolean(folderFilter) && folderIds.includes(folderFilter);
}

export const MAX_TUTOR_SOURCE_SELECTION = 5;

export function reconcileTutorSourceSelection(
  selectedSourceIds: readonly string[],
  availableSourceIds: readonly string[],
  limit = MAX_TUTOR_SOURCE_SELECTION
) {
  const availableIds = new Set(availableSourceIds);
  return Array.from(new Set(selectedSourceIds))
    .filter((sourceId) => availableIds.has(sourceId))
    .slice(0, limit);
}

export function toggleTutorSourceSelection(
  selectedSourceIds: readonly string[],
  sourceId: string,
  limit = MAX_TUTOR_SOURCE_SELECTION
) {
  if (selectedSourceIds.includes(sourceId)) {
    return {
      sourceIds: selectedSourceIds.filter((id) => id !== sourceId),
      limitReached: false,
    };
  }

  if (selectedSourceIds.length >= limit) {
    return { sourceIds: [...selectedSourceIds], limitReached: true };
  }

  return {
    sourceIds: [...selectedSourceIds, sourceId],
    limitReached: false,
  };
}
