function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchValue(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function textMatchesSmartSearch(value: string, query: string) {
  const normalizedValue = normalizeSearchValue(value);
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, " ");
  const searchText = normalizedQuery.trim();

  if (!searchText) return true;

  if (!/\s$/.test(normalizedQuery)) {
    return normalizedValue.startsWith(searchText);
  }

  const words = searchText.split(" ").filter(Boolean);
  return words.every((word) => {
    const wordPattern = new RegExp(`(^|\\s)${escapeRegExp(word)}(?=\\s|$)`);
    return wordPattern.test(normalizedValue);
  });
}

export function frontMatchesCardSearch(front: string, query: string) {
  return textMatchesSmartSearch(front, query);
}

export function shouldShowSmartSearchResults(
  query: string,
  hasActiveFilters = false
) {
  return query.trim().length > 0 || hasActiveFilters;
}

export function shouldShowCardBrowserResults(query: string, hasActiveFilters: boolean) {
  return shouldShowSmartSearchResults(query, hasActiveFilters);
}
