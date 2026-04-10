export function getDeckHref(deckId: string) {
  return `/dashboard/decks/${encodeURIComponent(deckId)}`;
}

export function getCustomStudyHref(options?: {
  mode?: "daily" | "custom";
  deckIds?: string[];
  tags?: string[];
}) {
  const searchParams = new URLSearchParams();
  const mode = options?.mode ?? "custom";
  searchParams.set("mode", mode);

  const deckIds = (options?.deckIds ?? []).filter(Boolean);
  if (deckIds.length > 0) {
    searchParams.set("decks", deckIds.join(","));
  }

  const tags = (options?.tags ?? []).filter(Boolean);
  if (tags.length > 0) {
    searchParams.set("tags", tags.join(","));
  }

  return `/dashboard/study?${searchParams.toString()}`;
}

export function getDeckStudyHref(deckId: string, tag?: string) {
  return getCustomStudyHref({
    mode: "custom",
    deckIds: [deckId],
    tags: tag ? [tag] : [],
  });
}
