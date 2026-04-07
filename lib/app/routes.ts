export function getDeckHref(deckId: string) {
  return `/dashboard/decks/${encodeURIComponent(deckId)}`;
}

export function getDeckStudyHref(deckId: string, tag?: string) {
  const basePath = `${getDeckHref(deckId)}/study`;
  if (!tag) {
    return basePath;
  }

  const searchParams = new URLSearchParams();
  searchParams.set("tags", tag);
  return `${basePath}?${searchParams.toString()}`;
}
