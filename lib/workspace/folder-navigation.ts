export type FolderWorkspaceTab = "notebooks" | "decks" | "sources" | "progress";

const DEFAULT_FOLDER_TAB: FolderWorkspaceTab = "notebooks";

export function getFolderTabFromSearch(search: string): FolderWorkspaceTab {
  const value = new URLSearchParams(search).get("tab");
  return value === "decks" ||
    value === "sources" ||
    value === "progress" ||
    value === "notebooks"
    ? value
    : DEFAULT_FOLDER_TAB;
}

export function buildFolderTabSearch(
  search: string,
  tab: FolderWorkspaceTab
): string {
  const params = new URLSearchParams(search);
  if (tab === DEFAULT_FOLDER_TAB) {
    params.delete("tab");
  } else {
    params.set("tab", tab);
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}
