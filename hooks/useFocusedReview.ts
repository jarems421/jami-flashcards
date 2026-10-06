"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { FocusedReviewColumn } from "@/components/study/FocusedReviewBuilder";
import type { StudyRequest } from "@/hooks/useStudyRequest";
import { useFocusedReviewState } from "@/hooks/useStudyWorkspaceState";
import { toggleIdSelection } from "@/lib/app/multi-select";
import { getTopicNameKey, type Topic } from "@/lib/material/topics";
import type { Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import {
  buildCustomReviewCards,
  countCardsByDeck,
  countCardsByTopic,
  EMPTY_FOCUSED_REVIEW_RECENTS,
  getFocusedReviewRecentsKey,
  mergeRecentValues,
  nameById,
  normalizeFocusedReviewRecents,
  resolveRecents,
  searchByName,
} from "@/lib/study/focused-review";
import { applyStudySessionShape } from "@/lib/study/session-spec-queue";

/** Topic ids for tag names, matched by name; tags with no Topic are dropped. */
function topicIdsForLegacyTags(legacyTags: string[], topics: Topic[]) {
  return legacyTags
    .map(
      (legacyTag) =>
        topics.find((topic) => getTopicNameKey(topic.name) === getTopicNameKey(legacyTag))?.id
    )
    .filter((topicId): topicId is string => Boolean(topicId));
}

function filterKindFor(request: Pick<StudyRequest, "deckIds" | "topicIds" | "legacyTags">) {
  return (request.topicIds.length > 0 || request.legacyTags.length > 0) && request.deckIds.length === 0
    ? "topics"
    : "decks";
}

/**
 * Focused Review: the decks and Topics a student picks for a targeted session.
 *
 * Opens on whatever the link asked for, remembers the last few picks on this
 * device, and turns the tag filters of links made before Topics existed into
 * Topics once the Topics have loaded.
 */
export function useFocusedReview({
  userId,
  request,
  cards,
  decks,
  topics,
  sessionActive,
  clearFeedback,
}: {
  userId: string;
  request: StudyRequest;
  cards: Card[];
  decks: Deck[];
  topics: Topic[];
  /** A session is on screen, so the picker is not. */
  sessionActive: boolean;
  clearFeedback: () => void;
}) {
  const {
    selectedDeckIds, setSelectedDeckIds, selectedTopicIds, setSelectedTopicIds,
    deckSearch, setDeckSearch, topicSearch, setTopicSearch,
    focusedReviewOpen, setFocusedReviewOpen,
    focusedFilterKind, setFocusedFilterKind,
    focusedReviewRecents, setFocusedReviewRecents,
  } = useFocusedReviewState({
    requestedDeckIds: request.deckIds,
    requestedTopicIds: request.topicIds,
    hasRequestedLegacyTags: request.legacyTags.length > 0,
    initiallyOpen: request.wantsFocusedReview,
  });
  const { deckIds: requestedDeckIds, topicIds: requestedTopicIds, legacyTags: requestedLegacyTags } = request;
  const wantsFocusedReview = request.wantsFocusedReview;

  /** Back to exactly what the link asked for. */
  const resetToRequest = useCallback(() => {
    setSelectedDeckIds(requestedDeckIds);
    setSelectedTopicIds(requestedTopicIds);
    setFocusedReviewOpen(wantsFocusedReview);
    setFocusedFilterKind(
      filterKindFor({ deckIds: requestedDeckIds, topicIds: requestedTopicIds, legacyTags: requestedLegacyTags })
    );
  }, [
    requestedDeckIds, requestedLegacyTags, requestedTopicIds, setFocusedFilterKind,
    setFocusedReviewOpen, setSelectedDeckIds, setSelectedTopicIds, wantsFocusedReview,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(getFocusedReviewRecentsKey(userId));
      setFocusedReviewRecents(stored ? normalizeFocusedReviewRecents(JSON.parse(stored)) : EMPTY_FOCUSED_REVIEW_RECENTS);
    } catch (error) {
      console.warn("Failed to load focused review recents.", error);
      setFocusedReviewRecents(EMPTY_FOCUSED_REVIEW_RECENTS);
    }
  }, [setFocusedReviewRecents, userId]);

  const pushRecents = useCallback(
    (deckIds: string[], topicIds: string[]) => {
      setFocusedReviewRecents((current) => {
        const next = {
          deckIds: mergeRecentValues(current.deckIds, deckIds),
          topicIds: mergeRecentValues(current.topicIds, topicIds),
        };

        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(getFocusedReviewRecentsKey(userId), JSON.stringify(next));
          } catch (error) {
            console.warn("Failed to save focused review recents.", error);
          }
        }

        return next;
      });
    },
    [setFocusedReviewRecents, userId]
  );

  // A link's tag filters become Topics, in the selection and in the address.
  useEffect(() => {
    if (topics.length === 0 || requestedLegacyTags.length === 0) return;
    const nextTopicIds = Array.from(
      new Set([...requestedTopicIds, ...topicIdsForLegacyTags(requestedLegacyTags, topics)])
    );
    setSelectedTopicIds(nextTopicIds);

    const params = new URLSearchParams(window.location.search);
    params.delete("tags");
    if (nextTopicIds.length > 0) params.set("topics", nextTopicIds.join(","));
    const nextSearch = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`
    );
  }, [requestedLegacyTags, requestedTopicIds, setSelectedTopicIds, topics]);

  // And so do the tags remembered as recent picks.
  useEffect(() => {
    if (!focusedReviewRecents.legacyTags?.length || topics.length === 0) return;
    const next = {
      deckIds: focusedReviewRecents.deckIds,
      topicIds: mergeRecentValues(
        focusedReviewRecents.topicIds,
        topicIdsForLegacyTags(focusedReviewRecents.legacyTags, topics)
      ),
    };
    setFocusedReviewRecents(next);
    try {
      window.localStorage.setItem(getFocusedReviewRecentsKey(userId), JSON.stringify(next));
    } catch (error) {
      console.warn("Failed to migrate focused review recents.", error);
    }
  }, [focusedReviewRecents, setFocusedReviewRecents, topics, userId]);

  const hasFilters = selectedDeckIds.length > 0 || selectedTopicIds.length > 0;

  useEffect(() => {
    if (!sessionActive && hasFilters) {
      setFocusedReviewOpen(true);
    }
  }, [hasFilters, sessionActive, setFocusedReviewOpen]);

  const previewCards = useMemo(
    () =>
      applyStudySessionShape(
        buildCustomReviewCards(cards, selectedDeckIds, selectedTopicIds),
        request.sessionShape
      ),
    [cards, request.sessionShape, selectedDeckIds, selectedTopicIds]
  );

  const deckNamesById = useMemo(() => nameById(decks), [decks]);
  const topicNamesById = useMemo(() => nameById(topics), [topics]);
  const deckCardCounts = useMemo(() => countCardsByDeck(cards), [cards]);
  const topicCardCounts = useMemo(() => countCardsByTopic(cards), [cards]);
  const deckSearchResults = useMemo(() => searchByName(decks, deckSearch), [deckSearch, decks]);
  const topicSearchResults = useMemo(
    () => searchByName(topics, topicSearch, getTopicNameKey),
    [topicSearch, topics]
  );
  const recentDecks = useMemo(
    () => resolveRecents(decks, focusedReviewRecents.deckIds),
    [decks, focusedReviewRecents.deckIds]
  );
  const recentTopics = useMemo(
    () => resolveRecents(topics, focusedReviewRecents.topicIds),
    [topics, focusedReviewRecents.topicIds]
  );

  const toggleDeck = useCallback((deckId: string) => {
    setSelectedDeckIds((prev) => toggleIdSelection(prev, deckId));
    clearFeedback();
  }, [clearFeedback, setSelectedDeckIds]);

  const toggleTopic = useCallback((topicId: string) => {
    setSelectedTopicIds((prev) => toggleIdSelection(prev, topicId));
    clearFeedback();
  }, [clearFeedback, setSelectedTopicIds]);

  const clearFilters = useCallback(() => {
    setSelectedDeckIds([]);
    setSelectedTopicIds([]);
    clearFeedback();
  }, [clearFeedback, setSelectedDeckIds, setSelectedTopicIds]);

  const deckColumn: FocusedReviewColumn = {
    search: deckSearch,
    onSearchChange: setDeckSearch,
    searchResults: deckSearchResults,
    recents: recentDecks,
    selectedIds: selectedDeckIds,
    namesById: deckNamesById,
    cardCounts: deckCardCounts,
    onToggle: toggleDeck,
  };
  const topicColumn: FocusedReviewColumn = {
    search: topicSearch,
    onSearchChange: setTopicSearch,
    searchResults: topicSearchResults,
    recents: recentTopics,
    selectedIds: selectedTopicIds,
    namesById: topicNamesById,
    cardCounts: topicCardCounts,
    onToggle: toggleTopic,
  };

  /** Picks the selection a resumed session was started with. */
  const selectFilters = useCallback(
    (deckIds: string[], topicIds: string[]) => {
      setSelectedDeckIds(deckIds);
      setSelectedTopicIds(topicIds);
    },
    [setSelectedDeckIds, setSelectedTopicIds]
  );

  const toggleOpen = useCallback(() => setFocusedReviewOpen((open) => !open), [setFocusedReviewOpen]);

  return {
    selectedDeckIds,
    selectedTopicIds,
    selectFilters,
    hasFilters,
    open: focusedReviewOpen,
    toggleOpen,
    filterKind: focusedFilterKind,
    setFilterKind: setFocusedFilterKind,
    deckColumn,
    topicColumn,
    deckNamesById,
    topicNamesById,
    previewCards,
    clearFilters,
    pushRecents,
    resetToRequest,
  };
}
