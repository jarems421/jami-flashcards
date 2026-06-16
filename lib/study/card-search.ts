function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchValue(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function frontMatchesCardSearch(front: string, query: string) {
  const normalizedFront = normalizeSearchValue(front);
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, " ");
  const searchText = normalizedQuery.trim();

  if (!searchText) return true;

  if (!/\s$/.test(normalizedQuery)) {
    return normalizedFront.startsWith(searchText);
  }

  const words = searchText.split(" ").filter(Boolean);
  return words.every((word) => {
    const wordPattern = new RegExp(`(^|\\s)${escapeRegExp(word)}(?=\\s|$)`);
    return wordPattern.test(normalizedFront);
  });
}

export function shouldShowCardBrowserResults(query: string, hasActiveFilters: boolean) {
  return query.trim().length > 0 || hasActiveFilters;
}
