export function getDeckHref(deckId: string) {
  return `/dashboard/decks/${encodeURIComponent(deckId)}`;
}

export function getDeckStudyRouteHref(deckId: string) {
  return `${getDeckHref(deckId)}/study`;
}

export type RouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function buildDeckStudyRedirectHref(
  deckId: string,
  searchParams: RouteSearchParams = {},
) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => nextSearchParams.append(key, item));
    } else if (typeof value === "string") {
      nextSearchParams.set(key, value);
    }
  }

  nextSearchParams.set("mode", "custom");
  nextSearchParams.set("decks", deckId);
  return `/dashboard/study?${nextSearchParams.toString()}`;
}

export function getCustomStudyHref(options?: {
  mode?: "daily" | "custom";
  deckIds?: string[];
  topicIds?: string[];
}) {
  const searchParams = new URLSearchParams();
  const mode = options?.mode ?? "custom";
  searchParams.set("mode", mode);

  const deckIds = (options?.deckIds ?? []).filter(Boolean);
  if (deckIds.length > 0) {
    searchParams.set("decks", deckIds.join(","));
  }

  const topicIds = (options?.topicIds ?? []).filter(Boolean);
  if (topicIds.length > 0) {
    searchParams.set("topics", topicIds.join(","));
  }

  return `/dashboard/study?${searchParams.toString()}`;
}

export function getDeckStudyHref(deckId: string, topicId?: string) {
  return getCustomStudyHref({
    mode: "custom",
    deckIds: [deckId],
    topicIds: topicId ? [topicId] : [],
  });
}
