const MAX_FOLDER_LINKS = 12;
const MAX_FOLDER_ID_LENGTH = 160;

export function normalizeFolderIds(folderIds: readonly string[] = []) {
  return Array.from(
    new Set(
      folderIds
        .map((folderId) => folderId.trim().slice(0, MAX_FOLDER_ID_LENGTH))
        .filter(Boolean)
    )
  ).slice(0, MAX_FOLDER_LINKS);
}

export function addFolderId(folderIds: readonly string[], folderId: string) {
  return normalizeFolderIds([...folderIds, folderId]);
}

export function removeFolderId(folderIds: readonly string[], folderId: string) {
  const normalizedFolderId = folderId.trim().slice(0, MAX_FOLDER_ID_LENGTH);
  return normalizeFolderIds(folderIds).filter((id) => id !== normalizedFolderId);
}
