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
