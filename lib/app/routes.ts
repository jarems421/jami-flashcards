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

export function getFolderHref(folderId: string, tab?: "practice" | "decks" | "sources") {
  const base = `/dashboard/folders/${encodeURIComponent(folderId)}`;
  return tab ? `${base}?tab=${tab}` : base;
}

export function getTopicHref(topicId: string) {
  return `/dashboard/topics/${encodeURIComponent(topicId)}`;
}

/** Past Paper Practice setup for a folder, optionally narrowed to specification topics. */
export function getQuestionPracticeSetupHref(input: {
  folderId: string;
  topicIds?: string[];
  /** Specification concepts, one grain finer than topics. */
  conceptIds?: string[];
}) {
  const searchParams = new URLSearchParams({ folderId: input.folderId });
  const topicIds = (input.topicIds ?? []).filter(Boolean);
  if (topicIds.length > 0) searchParams.set("topics", topicIds.join(","));
  const conceptIds = (input.conceptIds ?? []).filter(Boolean);
  if (conceptIds.length > 0) searchParams.set("concepts", conceptIds.join(","));
  return `/dashboard/practice/questions/new?${searchParams.toString()}`;
}

export function getDeckStudyHref(deckId: string, topicId?: string) {
  return getCustomStudyHref({
    mode: "custom",
    deckIds: [deckId],
    topicIds: topicId ? [topicId] : [],
  });
}

/** The student's revision plan: their own timetable, filled by the engine. */
export function getRevisionPlanHref() {
  return "/dashboard/tutor/plan";
}
