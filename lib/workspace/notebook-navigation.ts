export function getNotebookPageIdFromSearch(search: string) {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(normalizedSearch).get("page");
}

export function buildNotebookPageSearch(search: string, pageId: string | null) {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  if (pageId) {
    params.set("page", pageId);
  } else {
    params.delete("page");
  }
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}
