"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildCardBrowserSearch,
  getCardBrowserStateFromSearch,
  type CardBrowserStatus,
} from "@/lib/study/card-browser-navigation";
import {
  frontMatchesCardSearch,
  shouldShowCardBrowserResults,
} from "@/lib/study/card-search";
import { sortByCreatedAtNewest } from "@/lib/app/recent-items";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import { getTopicNameKey, type Topic } from "@/lib/material/topics";
import type { Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";

const CARD_RESULT_PAGE_SIZE = 50;
export const RECENT_CARD_COUNT = 4;

type UseCardBrowserOptions = {
  cards: Card[];
  decks: Deck[];
  topics: Topic[];
};

export type CardBrowserController = {
  search: {
    value: string;
    debouncedValue: string;
    setValue: (value: string) => void;
    clear: () => void;
  };
  filters: {
    deckId: string;
    folderId: string;
    topicId: string;
    status: CardBrowserStatus;
    activeCount: number;
    controlsVisible: boolean;
    setDeckId: (value: string) => void;
    setFolderId: (value: string) => void;
    setTopicId: (value: string) => void;
    setStatus: (value: CardBrowserStatus) => void;
    toggleControls: () => void;
    clear: () => void;
  };
  results: {
    showingFilteredResults: boolean;
    matchingCards: Card[];
    visibleCards: Card[];
    visibleCardIds: string[];
    remainingCount: number;
    hasMore: boolean;
    showingAllRecent: boolean;
    toggleAllRecent: () => void;
    showMore: () => void;
  };
};

/**
 * Owns the URL-backed search/filter state and the two pagination modes used by
 * the Cards browser. Mutations and row editing deliberately live elsewhere.
 */
export function useCardBrowser({
  cards,
  decks,
  topics,
}: UseCardBrowserOptions): CardBrowserController {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [deckFilter, setDeckFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [legacyTagFilter, setLegacyTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<CardBrowserStatus>("all");
  const [filterReferenceTime, setFilterReferenceTime] = useState(Date.now);
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [resultPage, setResultPage] = useState({ key: "", limit: CARD_RESULT_PAGE_SIZE });
  const [browsePage, setBrowsePage] = useState({ key: "", limit: CARD_RESULT_PAGE_SIZE });
  const [showAllCards, setShowAllCards] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const legacyTopicMatchId = useMemo(() => {
    if (!legacyTagFilter || topics.length === 0) return "";
    return (
      topics.find(
        (topic) =>
          getTopicNameKey(topic.name) === getTopicNameKey(legacyTagFilter)
      )?.id ?? ""
    );
  }, [legacyTagFilter, topics]);
  const resolvedTopicFilter = legacyTopicMatchId || topicFilter;
  const resolvedLegacyTag = topics.length > 0 ? "" : legacyTagFilter;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedTerm(searchTerm);
      setFilterReferenceTime(Date.now());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    const applyUrlState = () => {
      const state = getCardBrowserStateFromSearch(window.location.search);
      setSearchTerm(state.search);
      setDeckFilter(state.deckId);
      setFolderFilter(state.folderId);
      setTopicFilter(state.topicId);
      setLegacyTagFilter(state.legacyTag);
      setStatusFilter(state.status);
      setFilterReferenceTime(Date.now());
      setUrlStateReady(true);
    };

    applyUrlState();
    window.addEventListener("popstate", applyUrlState);
    return () => window.removeEventListener("popstate", applyUrlState);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;

    const nextSearch = buildCardBrowserSearch(window.location.search, {
      search: searchTerm,
      deckId: deckFilter,
      folderId: folderFilter,
      topicId: resolvedTopicFilter,
      legacyTag: resolvedLegacyTag,
      status: statusFilter,
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    deckFilter,
    folderFilter,
    resolvedLegacyTag,
    resolvedTopicFilter,
    searchTerm,
    statusFilter,
    urlStateReady,
  ]);

  const deckFolderIdsById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.folderIds])),
    [decks]
  );
  const activeFilterCount =
    Number(Boolean(deckFilter)) +
    Number(Boolean(folderFilter)) +
    Number(Boolean(resolvedTopicFilter)) +
    Number(statusFilter !== "all");
  const hasSearchQuery = debouncedTerm.trim().length > 0;
  const showingFilteredResults = shouldShowCardBrowserResults(
    debouncedTerm,
    activeFilterCount > 0
  );

  const recentCards = useMemo(
    () => sortByCreatedAtNewest(cards, (card) => card.createdAt),
    [cards]
  );
  const matchingCards = useMemo(() => {
    if (!showingFilteredResults) return [];

    return cards.filter((card) => {
      if (
        hasSearchQuery &&
        !frontMatchesCardSearch(card.front, debouncedTerm)
      ) {
        return false;
      }
      if (deckFilter && card.deckId !== deckFilter) return false;
      if (
        folderFilter &&
        !(deckFolderIdsById[card.deckId] ?? []).includes(folderFilter)
      ) {
        return false;
      }
      if (
        resolvedTopicFilter &&
        !card.topicIds?.includes(resolvedTopicFilter)
      ) {
        return false;
      }
      if (
        statusFilter === "due" &&
        !(
          typeof card.dueDate !== "number" ||
          card.dueDate <= filterReferenceTime
        )
      ) {
        return false;
      }
      if (
        statusFilter === "new" &&
        (card.reps ?? card.repetitions ?? 0) > 0
      ) {
        return false;
      }
      if (
        statusFilter === "weak" &&
        getMemoryRiskInfo(card, filterReferenceTime).tier !== "high"
      ) {
        return false;
      }
      return true;
    });
  }, [
    cards,
    debouncedTerm,
    deckFilter,
    deckFolderIdsById,
    folderFilter,
    filterReferenceTime,
    hasSearchQuery,
    showingFilteredResults,
    statusFilter,
    resolvedTopicFilter,
  ]);

  const displayedCardPool = showingFilteredResults
    ? matchingCards
    : recentCards;
  const resultPageKey = [
    cards.length,
    debouncedTerm,
    deckFilter,
    folderFilter,
    resolvedTopicFilter,
    statusFilter,
  ].join("\u0000");
  const browsePageKey = String(cards.length);
  const visibleResultLimit =
    resultPage.key === resultPageKey
      ? resultPage.limit
      : CARD_RESULT_PAGE_SIZE;
  const visibleBrowseLimit =
    browsePage.key === browsePageKey
      ? browsePage.limit
      : CARD_RESULT_PAGE_SIZE;
  const browseLimit = showAllCards ? visibleBrowseLimit : RECENT_CARD_COUNT;
  const visibleCards = useMemo(
    () =>
      displayedCardPool.slice(
        0,
        showingFilteredResults ? visibleResultLimit : browseLimit
      ),
    [
      browseLimit,
      displayedCardPool,
      showingFilteredResults,
      visibleResultLimit,
    ]
  );
  const visibleCardIds = useMemo(
    () => visibleCards.map((card) => card.id),
    [visibleCards]
  );
  const remainingCount = Math.max(
    displayedCardPool.length - visibleCards.length,
    0
  );
  const hasMore =
    remainingCount > 0 && (showingFilteredResults || showAllCards);

  const clearFilters = useCallback(() => {
    setSearchTerm("");
    setDebouncedTerm("");
    setDeckFilter("");
    setFolderFilter("");
    setTopicFilter("");
    setLegacyTagFilter("");
    setStatusFilter("all");
    setFilterReferenceTime(Date.now());
  }, []);
  const clearSearch = useCallback(() => setSearchTerm(""), []);
  const toggleControls = useCallback(
    () => setShowFilters((current) => !current),
    []
  );
  const toggleAllRecent = useCallback(
    () => setShowAllCards((current) => !current),
    []
  );
  const showMore = useCallback(() => {
    if (showingFilteredResults) {
      setResultPage((current) => ({
        key: resultPageKey,
        limit:
          (current.key === resultPageKey
            ? current.limit
            : CARD_RESULT_PAGE_SIZE) + CARD_RESULT_PAGE_SIZE,
      }));
    } else {
      setBrowsePage((current) => ({
        key: browsePageKey,
        limit:
          (current.key === browsePageKey
            ? current.limit
            : CARD_RESULT_PAGE_SIZE) + CARD_RESULT_PAGE_SIZE,
      }));
    }
  }, [browsePageKey, resultPageKey, showingFilteredResults]);
  const updateDeckFilter = useCallback((value: string) => {
    setDeckFilter(value);
    setFilterReferenceTime(Date.now());
  }, []);
  const updateFolderFilter = useCallback((value: string) => {
    setFolderFilter(value);
    setFilterReferenceTime(Date.now());
  }, []);
  const updateTopicFilter = useCallback((value: string) => {
    setTopicFilter(value);
    setLegacyTagFilter("");
    setFilterReferenceTime(Date.now());
  }, []);
  const updateStatusFilter = useCallback((value: CardBrowserStatus) => {
    setStatusFilter(value);
    setFilterReferenceTime(Date.now());
  }, []);

  return {
    search: {
      value: searchTerm,
      debouncedValue: debouncedTerm,
      setValue: setSearchTerm,
      clear: clearSearch,
    },
    filters: {
      deckId: deckFilter,
      folderId: folderFilter,
      topicId: resolvedTopicFilter,
      status: statusFilter,
      activeCount: activeFilterCount,
      controlsVisible: showFilters,
      setDeckId: updateDeckFilter,
      setFolderId: updateFolderFilter,
      setTopicId: updateTopicFilter,
      setStatus: updateStatusFilter,
      toggleControls,
      clear: clearFilters,
    },
    results: {
      showingFilteredResults,
      matchingCards,
      visibleCards,
      visibleCardIds,
      remainingCount,
      hasMore,
      showingAllRecent: showAllCards,
      toggleAllRecent,
      showMore,
    },
  };
}
