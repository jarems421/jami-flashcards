import type { Card } from "@/lib/study/cards";
import { sortCardsByStudyPriority } from "@/lib/study/daily-review";

/** The deck and Topic filters a student reached for most recently. */
export type FocusedReviewRecents = {
  deckIds: string[];
  topicIds: string[];
  /** Written before Topics replaced tags; read once, then dropped. */
  legacyTags?: string[];
};

export const FOCUSED_REVIEW_RECENTS_PREFIX = "jami:focused-review-recents:";
export const FOCUSED_REVIEW_RECENT_LIMIT = 3;
export const EMPTY_FOCUSED_REVIEW_RECENTS: FocusedReviewRecents = {
  deckIds: [],
  topicIds: [],
};

export function getFocusedReviewRecentsKey(userId: string) {
  return `${FOCUSED_REVIEW_RECENTS_PREFIX}${userId}`;
}

function toIdList(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && Boolean(entry.trim())
        )
        .slice(0, FOCUSED_REVIEW_RECENT_LIMIT)
    : [];
}

/** Local storage is user-writable, so every field is checked before use. */
export function normalizeFocusedReviewRecents(
  value: unknown
): FocusedReviewRecents {
  if (!value || typeof value !== "object") {
    return EMPTY_FOCUSED_REVIEW_RECENTS;
  }

  const data = value as {
    deckIds?: unknown;
    topicIds?: unknown;
    tags?: unknown;
  };
  return {
    deckIds: toIdList(data.deckIds),
    topicIds: toIdList(data.topicIds),
    ...(Array.isArray(data.tags) ? { legacyTags: toIdList(data.tags) } : {}),
  };
}

/**
 * Puts the just-used filters at the front, keeping the list to its limit.
 *
 * `getKey` lets callers dedupe on something other than the value itself, which
 * is how tag names collapse case-insensitively.
 */
export function mergeRecentValues(
  current: string[],
  nextValues: string[],
  getKey = (value: string) => value
) {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...nextValues, ...current]) {
    const trimmed = value.trim();
    const key = getKey(trimmed);
    if (!trimmed || !key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(trimmed);
    if (merged.length >= FOCUSED_REVIEW_RECENT_LIMIT) {
      break;
    }
  }

  return merged;
}

/**
 * The cards a Focused Review session should run.
 *
 * Deck and Topic filters are a union, not an intersection: picking a deck and a
 * Topic asks for both sets, which is what "focus on these" means to a student.
 * With nothing selected, everything is in scope.
 */
export function buildCustomReviewCards(
  cards: Card[],
  selectedDeckIds: string[],
  selectedTopicIds: string[]
) {
  const selectedDeckIdSet = new Set(selectedDeckIds);
  const selectedTopicIdSet = new Set(selectedTopicIds);
  const filteredCards =
    selectedDeckIds.length === 0 && selectedTopicIds.length === 0
      ? cards
      : cards.filter((card) => {
          const matchesDeck =
            selectedDeckIdSet.size > 0 && selectedDeckIdSet.has(card.deckId);
          const matchesTopic =
            selectedTopicIdSet.size > 0 &&
            (card.topicIds ?? []).some((topicId) =>
              selectedTopicIdSet.has(topicId)
            );
          return matchesDeck || matchesTopic;
        });

  return sortCardsByStudyPriority(filteredCards);
}

/** Reads a comma-separated `?decks=` or `?topics=` parameter. */
export function parseIdsParam(value: string | null) {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}
