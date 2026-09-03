"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { toggleIdSelection } from "@/lib/app/multi-select";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import {
  buildDailyReviewQueues,
  DAILY_REVIEW_MAX_WEAK_ATTEMPTS,
  DAILY_REVIEW_STATE_DOC_ID,
  getCardsByIds,
  getRemainingCarryoverRequiredCards,
  getRemainingFreshRequiredCards,
  sortCardsByStudyPriority,
} from "@/lib/study/daily-review";
import { getMsUntilNextStudyBoundary, getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import {
  buildCustomReviewCards,
  EMPTY_FOCUSED_REVIEW_RECENTS,
  FOCUSED_REVIEW_RECENT_LIMIT,
  getFocusedReviewRecentsKey,
  mergeRecentValues,
  normalizeFocusedReviewRecents,
  parseIdsParam,
} from "@/lib/study/focused-review";
import {
  formatResetCountdown,
  getAnswerFeedback,
  getSessionLabel,
  getSimpleStudyFeedback,
  RATING_LABELS,
  RATING_STYLES,
  withGoalReward,
} from "@/lib/study/study-feedback";
import InlineStudyFeedback from "@/components/study/InlineStudyFeedback";
import FocusedReviewBuilder from "@/components/study/FocusedReviewBuilder";
import StudyHomeStat from "@/components/study/StudyHomeStat";
import { isStruggleRating, isSuccessfulRating, updateCardSchedule, type CardRating } from "@/lib/study/scheduler";
import type { Card } from "@/lib/study/cards";
import {
  buildCardReviewUpdateCommand,
  hasCardReviewUpdateCommand,
} from "@/lib/study/card-review";
import {
  applySimpleStudyResultToCard,
  applySimpleStudyResultToQueue,
  buildSimpleStudyQueue,
  type SimpleStudyResult,
} from "@/lib/study/simple-study";
import {
  getOfflineQueuedReviews,
  loadOfflineStudySnapshot,
  queueOfflineStudyReview,
  saveOfflineStudySnapshot,
} from "@/lib/study/offline-study";
import {
  buildPersistedStudySession,
  canRestorePersistedSession,
  clearClosedStudySessionTombstone,
  clearPersistedStudySession,
  closePersistedStudySession,
  createEmptySessionStats,
  hasClosedStudySessionTombstone,
  hydratePersistedSessionCards,
  isIncomingSessionNewer,
  loadClosedStudySessionTombstone,
  loadPersistedStudySession,
  markClosedStudySessionTombstoneSynced,
  saveClosedStudySessionTombstone,
  savePersistedStudySession,
  type PersistedStudySession,
  type StudySessionKind,
} from "@/lib/study/session";
import { ensureDailyReviewState, ensureStudyStateSetup, markDailyReviewCardComplete, recordDailyReviewWeakAttempt } from "@/services/study/daily-review";
import {
  loadUserCards,
  recordSimpleStudyResult,
  updateCardAfterReview,
} from "@/services/study/cards";
import { syncOfflineStudyReviews } from "@/services/study/offline";
import { closeRemoteStudySession, loadRemoteActiveStudySession, saveRemoteActiveStudySession } from "@/services/study/session";
import { applyGoalProgressForAnswer } from "@/services/study/goals";
import { loadStudyActivity, recordStudyReview } from "@/services/study/activity";
import { computeStudyStreak } from "@/lib/study/activity";
import { getDecks } from "@/services/study/decks";
import type { Deck } from "@/lib/study/decks";
import { getActiveTopics } from "@/services/study/topics";
import { getTopicNameKey, type Topic } from "@/lib/material/topics";
import { getDeckColorPreset } from "@/lib/study/deck-style";
import AppPage from "@/components/layout/AppPage";
import StarRewardOverlay from "@/components/constellation/StarRewardOverlay";
import { useFocusedReviewState, useStudyDataState, useStudySessionState } from "@/hooks/useStudyWorkspaceState";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import {
  Button, Card as SurfaceCard, EmptyState, FeedbackBanner,
  JamiTutorIcon, ProgressBar, Skeleton, StudyText,
} from "@/components/ui";

type SessionKind = StudySessionKind;

/** Refreshing on every tab focus hammered Firestore on a busy desk. */
const STUDY_FOREGROUND_REFRESH_THROTTLE_MS = 15_000;
type DailyRequiredSessionScope = "all" | "carryover" | "fresh";

export default function StudyPage() {
  const searchParams = useSearchParams();
  const { user } = useUser();
  const rawMode = searchParams.get("mode");
  const rawDecksParam = searchParams.get("decks");
  const rawTopicsParam = searchParams.get("topics");
  const rawTagsParam = searchParams.get("tags");
  const requestedMode =
    rawMode === "custom" || rawMode === "daily" ? rawMode : null;
  const requestedDeckIds = useMemo(() => parseIdsParam(rawDecksParam), [rawDecksParam]);
  const requestedTopicIds = useMemo(() => parseIdsParam(rawTopicsParam), [rawTopicsParam]);
  const requestedLegacyTags = useMemo(() => parseIdsParam(rawTagsParam), [rawTagsParam]);
  const hasIncomingFocusedIntent =
    requestedMode === "custom" ||
    requestedDeckIds.length > 0 ||
    requestedTopicIds.length > 0 ||
    requestedLegacyTags.length > 0;
  const {
    decks, setDecks, cards, setCards, topics, setTopics,
    dailyReviewState, setDailyReviewState, loaded, setLoaded,
  } = useStudyDataState();
  const {
    selectedDeckIds, setSelectedDeckIds, selectedTopicIds, setSelectedTopicIds,
    deckSearch, setDeckSearch, topicSearch, setTopicSearch,
    focusedReviewOpen, setFocusedReviewOpen,
    focusedFilterKind, setFocusedFilterKind,
    focusedReviewRecents, setFocusedReviewRecents,
  } = useFocusedReviewState({
    requestedDeckIds,
    requestedTopicIds,
    hasRequestedLegacyTags: requestedLegacyTags.length > 0,
    initiallyOpen: hasIncomingFocusedIntent,
  });
  const {
    sessionKind, setSessionKind, sessionCards, setSessionCards,
    index, setIndex, flipped, setFlipped,
    jamiAssistantOpen, setJamiAssistantOpen, savingRating, setSavingRating,
    sessionStats, setSessionStats, answerFeedback, setAnswerFeedback,
    starReward, setStarReward, countdownMs, setCountdownMs,
    offlineMode, setOfflineMode, offlineSnapshotAt, setOfflineSnapshotAt,
    pendingOfflineReviews, setPendingOfflineReviews,
    sessionRestoreReady, setSessionRestoreReady,
  } = useStudySessionState();
  const { feedback, success, showError, clear: clearFeedback } = useFeedback();
  const handleStarRewardDone = useCallback(
    () => setStarReward(null),
    [setStarReward]
  );
  const flipTimestampRef = useRef(0);
  const autoStartHandledRef = useRef(false);
  const sessionRestoreHandledRef = useRef(false);
  const sessionStartedAtRef = useRef<number | null>(null);
  const sessionStudyDayKeyRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionRevisionRef = useRef(0);
  const latestPersistedSessionRef = useRef<PersistedStudySession | null>(null);
  const loadRequestIdRef = useRef(0);
  const lastForegroundRefreshAtRef = useRef(0);
  const remoteCloseKeyRef = useRef<string | null>(null);
  const focusedReviewToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelectedDeckIds(requestedDeckIds);
    setSelectedTopicIds(requestedTopicIds);
    setFocusedReviewOpen(hasIncomingFocusedIntent);
    setFocusedFilterKind(
      (requestedTopicIds.length > 0 || requestedLegacyTags.length > 0) &&
        requestedDeckIds.length === 0
        ? "topics"
        : "decks"
    );
    setSessionKind(null);
    setSessionCards([]);
    setIndex(0);
    setFlipped(false);
    setAnswerFeedback(null);
    setSessionStats(createEmptySessionStats());
    autoStartHandledRef.current = false;
    sessionRestoreHandledRef.current = false;
    sessionStartedAtRef.current = null;
    sessionStudyDayKeyRef.current = null;
    sessionIdRef.current = null;
    sessionRevisionRef.current = 0;
    latestPersistedSessionRef.current = null;
    remoteCloseKeyRef.current = null;
    setSessionRestoreReady(false);
  }, [
    hasIncomingFocusedIntent, requestedDeckIds, requestedLegacyTags,
    requestedMode, requestedTopicIds, setAnswerFeedback, setFlipped,
    setFocusedFilterKind, setFocusedReviewOpen, setIndex, setSelectedDeckIds,
    setSelectedTopicIds, setSessionCards, setSessionKind,
    setSessionRestoreReady, setSessionStats,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(getFocusedReviewRecentsKey(user.uid));
      setFocusedReviewRecents(stored ? normalizeFocusedReviewRecents(JSON.parse(stored)) : EMPTY_FOCUSED_REVIEW_RECENTS);
    } catch (error) {
      console.warn("Failed to load focused review recents.", error);
      setFocusedReviewRecents(EMPTY_FOCUSED_REVIEW_RECENTS);
    }
  }, [setFocusedReviewRecents, user.uid]);

  const pushFocusedReviewRecents = useCallback(
    (deckIds: string[], topicIds: string[]) => {
      setFocusedReviewRecents((current) => {
        const next = {
          deckIds: mergeRecentValues(current.deckIds, deckIds),
          topicIds: mergeRecentValues(current.topicIds, topicIds),
        };

        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(getFocusedReviewRecentsKey(user.uid), JSON.stringify(next));
          } catch (error) {
            console.warn("Failed to save focused review recents.", error);
          }
        }

        return next;
      });
    },
    [setFocusedReviewRecents, user.uid]
  );

  useEffect(() => {
    const interval = setInterval(
      () => setCountdownMs(getMsUntilNextStudyBoundary()),
      30_000
    );
    return () => clearInterval(interval);
  }, [setCountdownMs]);

  useEffect(() => {
    if (!answerFeedback) return;
    const timeout = window.setTimeout(
      () => setAnswerFeedback(null),
      answerFeedback.holdMs ?? 2400
    );
    return () => window.clearTimeout(timeout);
  }, [answerFeedback, setAnswerFeedback]);

  const loadAll = useCallback(async (options: { keepSessionMounted?: boolean } = {}) => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    if (!options.keepSessionMounted) {
      setLoaded(false);
    }
    clearFeedback();
    try {
      const setupResults = await Promise.allSettled([
        ensureStudyStateSetup(user.uid),
        ensureConstellationSetup(user.uid),
      ]);

      setupResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const label = index === 0 ? "study state" : "constellation";
          console.warn(`Non-blocking ${label} setup failed.`, result.reason);
        }
      });

      const now = Date.now();
      const activeSessionPromise = loadRemoteActiveStudySession(user.uid, getStudyDayKey(now), now).catch((error) => {
        console.warn("Failed to load remote active study session before daily review refresh.", error);
        return { session: null, foundRemoteSession: false };
      });
      const [nextDecks, nextCards, nextTopics, activeSessionResult] = await Promise.all([
        getDecks(user.uid),
        // Every card loaded here is a card that may be graded, and grading
        // computes the next interval from the state it reads. This one read
        // must come from the server however recently another page asked.
        loadUserCards(user.uid, { force: true }),
        getActiveTopics(user.uid).catch((error) => {
          console.error("Failed to load Topics for Learn filters.", error);
          showError(
            "Topics are temporarily unavailable. Your card session is still usable."
          );
          return [] as Topic[];
        }),
        activeSessionPromise,
      ]);
      const sortedCards = sortCardsByStudyPriority(nextCards, now);
      const nextDailyReviewState = await ensureDailyReviewState(user.uid, sortedCards, now, {
        activeSession: activeSessionResult.session,
      });
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      setDecks(nextDecks);
      setCards(sortedCards);
      setTopics(nextTopics);
      setDailyReviewState(nextDailyReviewState);
      saveOfflineStudySnapshot(user.uid, { cards: sortedCards, decks: nextDecks });
      setOfflineMode(false);
      setOfflineSnapshotAt(Date.now());
    } catch (error) {
      console.error(error);
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      if (options.keepSessionMounted && latestPersistedSessionRef.current) {
        setOfflineMode(true);
        setPendingOfflineReviews(getOfflineQueuedReviews(user.uid).length);
        success("Still using your current study session. New data will refresh when the connection settles.");
        return;
      }

      const snapshot = loadOfflineStudySnapshot(user.uid);

      if (snapshot) {
        const now = Date.now();
        const sortedCards = sortCardsByStudyPriority(snapshot.cards, now);
        const queues = buildDailyReviewQueues(sortedCards, now);
        setDecks(snapshot.decks);
        setCards(sortedCards);
        setTopics([]);
        setDailyReviewState({
          id: DAILY_REVIEW_STATE_DOC_ID,
          studyDayKey: getStudyDayKey(now),
          generatedAt: snapshot.savedAt,
          requiredCardIds: queues.requiredCards.map((card) => card.id),
          optionalCardIds: queues.optionalCards.map((card) => card.id),
          carryoverRequiredCardIds: queues.carryoverRequiredCards.map((card) => card.id),
          completedRequiredCardIds: [],
          completedOptionalCardIds: [],
          parkedRequiredCardIds: [],
          requiredRetryCounts: {},
          updatedAt: snapshot.savedAt,
        });
        setOfflineMode(true);
        setOfflineSnapshotAt(snapshot.savedAt);
        success("Using your offline study cache. Answers will sync when you are back online.");
      } else {
        setDecks([]);
        setCards([]);
        setTopics([]);
        setDailyReviewState(null);
        showError("Failed to load your study queue.");
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoaded(true);
      }
    }
  }, [
    clearFeedback,
    setCards,
    setDailyReviewState,
    setDecks,
    setLoaded,
    setOfflineMode,
    setOfflineSnapshotAt,
    setPendingOfflineReviews,
    setTopics,
    showError,
    success,
    user.uid,
  ]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, setOfflineMode, setPendingOfflineReviews, user.uid]);

  useEffect(() => {
    if (topics.length === 0 || requestedLegacyTags.length === 0) return;
    const topicIds = requestedLegacyTags
      .map(
        (legacyTag) =>
          topics.find(
            (topic) => getTopicNameKey(topic.name) === getTopicNameKey(legacyTag)
          )?.id
      )
      .filter((topicId): topicId is string => Boolean(topicId));
    const nextTopicIds = Array.from(new Set([...requestedTopicIds, ...topicIds]));
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
  }, [
    requestedLegacyTags,
    requestedTopicIds,
    setSelectedTopicIds,
    topics,
  ]);

  useEffect(() => {
    if (!focusedReviewRecents.legacyTags?.length || topics.length === 0) return;
    const migratedTopicIds = focusedReviewRecents.legacyTags
      .map(
        (legacyTag) =>
          topics.find(
            (topic) => getTopicNameKey(topic.name) === getTopicNameKey(legacyTag)
          )?.id
      )
      .filter((topicId): topicId is string => Boolean(topicId));
    const next = {
      deckIds: focusedReviewRecents.deckIds,
      topicIds: mergeRecentValues(
        focusedReviewRecents.topicIds,
        migratedTopicIds
      ),
    };
    setFocusedReviewRecents(next);
    try {
      window.localStorage.setItem(
        getFocusedReviewRecentsKey(user.uid),
        JSON.stringify(next)
      );
    } catch (error) {
      console.warn("Failed to migrate focused review recents.", error);
    }
  }, [focusedReviewRecents, setFocusedReviewRecents, topics, user.uid]);

  useEffect(() => {
    const retryClosedSessionSync = () => {
      const tombstone = loadClosedStudySessionTombstone(user.uid);
      if (!tombstone?.retryRemoteClose) {
        return;
      }

      void closeRemoteStudySession(
        user.uid,
        tombstone.session,
        tombstone.status,
        tombstone.reason
      )
        .then((saved) => {
          if (saved) {
            markClosedStudySessionTombstoneSynced(user.uid);
          }
        })
        .catch((error) => {
          console.warn("Failed to retry closed study session sync.", error);
        });
    };

    const handleFocus = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      setOfflineMode(typeof navigator !== "undefined" ? !navigator.onLine : false);
      setPendingOfflineReviews(getOfflineQueuedReviews(user.uid).length);
      retryClosedSessionSync();

      if (latestPersistedSessionRef.current) {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundRefreshAtRef.current < STUDY_FOREGROUND_REFRESH_THROTTLE_MS) {
        return;
      }

      lastForegroundRefreshAtRef.current = now;
      void loadAll({ keepSessionMounted: true });
    };

    if (document.visibilityState !== "hidden") {
      retryClosedSessionSync();
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [loadAll, setOfflineMode, setPendingOfflineReviews, user.uid]);

  const refreshPendingOfflineReviews = useCallback(() => {
    setPendingOfflineReviews(getOfflineQueuedReviews(user.uid).length);
  }, [setPendingOfflineReviews, user.uid]);

  const syncPendingOfflineReviews = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setOfflineMode(true);
      return;
    }

    const pending = getOfflineQueuedReviews(user.uid).length;
    if (pending === 0) {
      setPendingOfflineReviews(0);
      return;
    }

    const result = await syncOfflineStudyReviews(user.uid);
    setPendingOfflineReviews(result.remaining);

    if (result.synced > 0) {
      success(`Synced ${result.synced} offline review${result.synced === 1 ? "" : "s"}.`);
      if (latestPersistedSessionRef.current) {
        return;
      }
      await loadAll({ keepSessionMounted: true });
    }
  }, [
    loadAll,
    setOfflineMode,
    setPendingOfflineReviews,
    success,
    user.uid,
  ]);

  useEffect(() => {
    refreshPendingOfflineReviews();

    const handleOnline = () => {
      setOfflineMode(false);
      void syncPendingOfflineReviews();
    };
    const handleOffline = () => setOfflineMode(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (typeof navigator !== "undefined") {
      setOfflineMode(!navigator.onLine);
      if (navigator.onLine) {
        void syncPendingOfflineReviews();
      }
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [
    refreshPendingOfflineReviews,
    setOfflineMode,
    syncPendingOfflineReviews,
  ]);

  const optionalDailyCards = useMemo(
    () => (dailyReviewState ? getCardsByIds(cards, dailyReviewState.optionalCardIds) : []),
    [cards, dailyReviewState]
  );
  const carryoverRequiredIdSet = useMemo(
    () => new Set(dailyReviewState?.carryoverRequiredCardIds ?? []),
    [dailyReviewState]
  );
  const remainingCarryoverRequiredCards = useMemo(
    () => getRemainingCarryoverRequiredCards(dailyReviewState, cards),
    [cards, dailyReviewState]
  );
  const remainingFreshRequiredCards = useMemo(
    () => getRemainingFreshRequiredCards(dailyReviewState, cards),
    [cards, dailyReviewState]
  );
  const remainingRequiredCards = useMemo(
    () => [...remainingCarryoverRequiredCards, ...remainingFreshRequiredCards],
    [remainingCarryoverRequiredCards, remainingFreshRequiredCards]
  );
  const remainingOptionalCards = useMemo(() => {
    if (!dailyReviewState) return [];
    const completed = new Set(dailyReviewState.completedOptionalCardIds);
    return optionalDailyCards.filter((card) => !completed.has(card.id));
  }, [dailyReviewState, optionalDailyCards]);
  const hasCarryoverRequiredCards = remainingCarryoverRequiredCards.length > 0;
  const hasCards = cards.length > 0;
  const customPreviewCards = useMemo(
    () => buildCustomReviewCards(cards, selectedDeckIds, selectedTopicIds),
    [cards, selectedDeckIds, selectedTopicIds]
  );
  const simpleStudyQueue = useMemo(() => buildSimpleStudyQueue(cards), [cards]);
  const hasCustomFilters = selectedDeckIds.length > 0 || selectedTopicIds.length > 0;
  const customSelectionEmpty = hasCards && customPreviewCards.length === 0;

  useEffect(() => {
    if (sessionKind === null && hasCustomFilters) {
      setFocusedReviewOpen(true);
    }
  }, [hasCustomFilters, sessionKind, setFocusedReviewOpen]);

  const deckNamesById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );
  const topicNamesById = useMemo(
    () => Object.fromEntries(topics.map((topic) => [topic.id, topic.name])),
    [topics]
  );
  const deckCardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      counts.set(card.deckId, (counts.get(card.deckId) ?? 0) + 1);
    }
    return counts;
  }, [cards]);
  const topicCardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      for (const topicId of new Set(card.topicIds ?? [])) {
        counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
      }
    }
    return counts;
  }, [cards]);
  const deckSearchResults = useMemo(() => {
    const query = deckSearch.trim().toLowerCase();
    if (!query) return [];
    return decks
      .filter((deck) => deck.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [deckSearch, decks]);
  const topicSearchResults = useMemo(() => {
    const query = getTopicNameKey(topicSearch);
    if (!query) return [];
    return topics
      .filter((topic) => getTopicNameKey(topic.name).includes(query))
      .slice(0, 8);
  }, [topicSearch, topics]);
  const recentDecks = useMemo(() => {
    const decksById = new Map(decks.map((deck) => [deck.id, deck]));
    return focusedReviewRecents.deckIds
      .map((deckId) => decksById.get(deckId) ?? null)
      .filter((deck): deck is Deck => deck !== null)
      .slice(0, FOCUSED_REVIEW_RECENT_LIMIT);
  }, [decks, focusedReviewRecents.deckIds]);
  const recentTopics = useMemo(() => {
    const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
    return focusedReviewRecents.topicIds
      .map((topicId) => topicsById.get(topicId) ?? null)
      .filter((topic): topic is Topic => topic !== null)
      .slice(0, FOCUSED_REVIEW_RECENT_LIMIT);
  }, [focusedReviewRecents.topicIds, topics]);

  const toggleDeckFilter = useCallback((deckId: string) => {
    setSelectedDeckIds((prev) => toggleIdSelection(prev, deckId));
    clearFeedback();
  }, [clearFeedback, setSelectedDeckIds]);

  const toggleTopicFilter = useCallback((topicId: string) => {
    setSelectedTopicIds((prev) => toggleIdSelection(prev, topicId));
    clearFeedback();
  }, [clearFeedback, setSelectedTopicIds]);

  const startSession = useCallback(
    (kind: SessionKind, requiredScope: DailyRequiredSessionScope = "all") => {
      const nextCards =
        kind === "daily-required"
          ? requiredScope === "carryover"
            ? remainingCarryoverRequiredCards
            : requiredScope === "fresh"
              ? remainingFreshRequiredCards
              : remainingRequiredCards
          : kind === "daily-optional"
            ? remainingOptionalCards
            : kind === "simple"
              ? simpleStudyQueue.cards
              : customPreviewCards;
      const now = Date.now();
      const nextStats = createEmptySessionStats();
      const sessionSelectedDeckIds = kind === "simple" ? [] : selectedDeckIds;
      const sessionSelectedTopicIds = kind === "simple" ? [] : selectedTopicIds;
      const nextSession = buildPersistedStudySession({
        userId: user.uid,
        kind,
        sessionCards: nextCards,
        index: 0,
        stats: nextStats,
        selectedDeckIds: sessionSelectedDeckIds,
        selectedTopicIds: sessionSelectedTopicIds,
        startedAt: now,
        now,
      });

      clearClosedStudySessionTombstone(user.uid);
      sessionIdRef.current = nextSession.sessionId;
      sessionStartedAtRef.current = now;
      sessionStudyDayKeyRef.current = nextSession.studyDayKey;
      sessionRevisionRef.current = nextSession.revision;
      latestPersistedSessionRef.current = nextSession;
      remoteCloseKeyRef.current = null;
      setSessionKind(kind);
      setSessionCards(nextCards);
      setSessionStats(nextStats);
      setIndex(0);
      setFlipped(false);
      setSavingRating(null);
      setAnswerFeedback(null);
      clearFeedback();
      savePersistedStudySession(nextSession);
      void saveRemoteActiveStudySession(nextSession).catch((error) => {
        console.warn("Failed to save active study session.", error);
      });

      if (kind === "custom") {
        pushFocusedReviewRecents(selectedDeckIds, selectedTopicIds);
      }
    },
    [
      clearFeedback,
      customPreviewCards,
      pushFocusedReviewRecents,
      remainingCarryoverRequiredCards,
      remainingFreshRequiredCards,
      remainingOptionalCards,
      remainingRequiredCards,
      selectedDeckIds,
      selectedTopicIds,
      setAnswerFeedback,
      setFlipped,
      setIndex,
      setSavingRating,
      setSessionCards,
      setSessionKind,
      setSessionStats,
      simpleStudyQueue.cards,
      user.uid,
    ]
  );

  const handleCustomReviewClick = useCallback(() => {
    if (!hasCards) {
      showError("Create at least one card first, then Focused Review will be ready.");
      return;
    }

    if (customPreviewCards.length === 0) {
      showError(hasCustomFilters
          ? "No cards match those filters. Clear them or choose a different deck or Topic."
          : "Add cards first, then Focused Review will be ready.");
      return;
    }

    startSession("custom");
  }, [
    customPreviewCards.length,
    hasCards,
    hasCustomFilters,
    showError,
    startSession,
  ]);

  const clearCustomFilters = useCallback(() => {
    setSelectedDeckIds([]);
    setSelectedTopicIds([]);
    clearFeedback();
  }, [clearFeedback, setSelectedDeckIds, setSelectedTopicIds]);

  const closeFocusedReviewBuilder = useCallback(() => {
    setFocusedReviewOpen(false);
    window.requestAnimationFrame(() => focusedReviewToggleRef.current?.focus());
  }, [setFocusedReviewOpen]);

  useEffect(() => {
    if (!loaded || sessionRestoreHandledRef.current) return;
    sessionRestoreHandledRef.current = true;
    let cancelled = false;

    const restoreSession = async () => {
      const currentStudyDayKey = getStudyDayKey(Date.now());
      const localSession = loadPersistedStudySession(user.uid, currentStudyDayKey);
      let remoteSession: PersistedStudySession | null = null;
      let remoteClosedSession: PersistedStudySession | null = null;
      let foundRemoteSession = false;

      try {
        const remoteResult = await loadRemoteActiveStudySession(user.uid, currentStudyDayKey);
        remoteSession = remoteResult.session;
        remoteClosedSession = remoteResult.closedSession ?? null;
        foundRemoteSession = remoteResult.foundRemoteSession;
      } catch (error) {
        console.warn("Failed to load remote active study session.", error);
      }

      let restoredSession = localSession;
      if (remoteSession && (!restoredSession || isIncomingSessionNewer(restoredSession, remoteSession))) {
        restoredSession = remoteSession;
      }
      if (
        restoredSession &&
        restoredSession.selectedTopicIds.length === 0 &&
        restoredSession.legacySelectedTags?.length
      ) {
        const migratedTopicIds = restoredSession.legacySelectedTags
          .map(
            (legacyTag) =>
              topics.find(
                (topic) =>
                  getTopicNameKey(topic.name) === getTopicNameKey(legacyTag)
              )?.id
          )
          .filter((topicId): topicId is string => Boolean(topicId));
        restoredSession = {
          ...restoredSession,
          selectedTopicIds: migratedTopicIds,
          legacySelectedTags: undefined,
        };
      }

      if (cancelled) {
        return;
      }

      if (foundRemoteSession && !remoteSession) {
        if (
          remoteClosedSession &&
          restoredSession &&
          remoteClosedSession.sessionId === restoredSession.sessionId &&
          isIncomingSessionNewer(restoredSession, remoteClosedSession)
        ) {
          saveClosedStudySessionTombstone(remoteClosedSession, false);
          clearPersistedStudySession(user.uid);
          latestPersistedSessionRef.current = null;
          setSessionRestoreReady(true);
          return;
        }

        if (!restoredSession) {
          clearPersistedStudySession(user.uid);
          latestPersistedSessionRef.current = null;
          setSessionRestoreReady(true);
          return;
        }

        if (remoteClosedSession && remoteClosedSession.sessionId !== restoredSession.sessionId) {
          saveClosedStudySessionTombstone(remoteClosedSession, false);
        }

        setSessionRestoreReady(true);
        return;
      }

      if (
        remoteClosedSession &&
        restoredSession &&
        remoteClosedSession.sessionId === restoredSession.sessionId &&
        isIncomingSessionNewer(restoredSession, remoteClosedSession)
      ) {
        saveClosedStudySessionTombstone(remoteClosedSession, false);
        clearPersistedStudySession(user.uid);
        latestPersistedSessionRef.current = null;
        setSessionRestoreReady(true);
        return;
      }

      if (
        restoredSession &&
        hasClosedStudySessionTombstone(
          user.uid,
          restoredSession.sessionId,
          restoredSession.revision
        )
      ) {
        clearPersistedStudySession(user.uid);
        latestPersistedSessionRef.current = null;
        setSessionRestoreReady(true);
        return;
      }

      if (
        !restoredSession ||
        !canRestorePersistedSession(
          restoredSession,
          requestedMode,
          requestedDeckIds,
          requestedTopicIds
        )
      ) {
        setSessionRestoreReady(true);
        return;
      }

      const restored = hydratePersistedSessionCards(restoredSession, cards, dailyReviewState);
      if (restored.cards.length === 0 || restored.index >= restored.cards.length) {
        clearPersistedStudySession(user.uid);
        saveClosedStudySessionTombstone(
          closePersistedStudySession(restoredSession, "completed", "completed")
        );
        void closeRemoteStudySession(user.uid, restoredSession, "completed", "completed").catch((error) => {
          console.warn("Failed to close empty active study session.", error);
        });
        setSessionRestoreReady(true);
        return;
      }

      sessionIdRef.current = restoredSession.sessionId;
      sessionStartedAtRef.current = restoredSession.startedAt;
      sessionStudyDayKeyRef.current = restoredSession.studyDayKey;
      sessionRevisionRef.current = restoredSession.revision;
      latestPersistedSessionRef.current = restoredSession;
      remoteCloseKeyRef.current = null;
      savePersistedStudySession(restoredSession);
      setSessionKind(restoredSession.kind);
      setSessionCards(restored.cards);
      setSessionStats(restoredSession.stats);
      setIndex(restored.index);
      setFlipped(false);
      setSavingRating(null);
      setAnswerFeedback(null);
      clearFeedback();

      if (restoredSession.kind === "custom") {
        setSelectedDeckIds(restoredSession.selectedDeckIds);
        setSelectedTopicIds(restoredSession.selectedTopicIds);
      }

      autoStartHandledRef.current = true;
      setSessionRestoreReady(true);
    };

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [
    cards,
    clearFeedback,
    dailyReviewState,
    loaded,
    requestedDeckIds,
    requestedMode,
    requestedTopicIds,
    setAnswerFeedback,
    setFlipped,
    setIndex,
    setSavingRating,
    setSelectedDeckIds,
    setSelectedTopicIds,
    setSessionCards,
    setSessionKind,
    setSessionRestoreReady,
    setSessionStats,
    topics,
    user.uid,
  ]);

  useEffect(() => {
    if (!loaded || !sessionRestoreReady || autoStartHandledRef.current) return;
    if (requestedMode === "daily") {
      autoStartHandledRef.current = true;
      if (remainingCarryoverRequiredCards.length > 0) {
        return;
      }
      if (remainingRequiredCards.length > 0) {
        startSession("daily-required");
        return;
      }
      if (remainingOptionalCards.length > 0) {
        startSession("daily-optional");
      }
      return;
    }
    if (requestedMode === "custom" && customPreviewCards.length > 0) {
      autoStartHandledRef.current = true;
      startSession("custom");
      return;
    }
    autoStartHandledRef.current = true;
  }, [customPreviewCards.length, loaded, remainingCarryoverRequiredCards.length, remainingOptionalCards.length, remainingRequiredCards.length, requestedMode, selectedDeckIds.length, selectedTopicIds.length, sessionRestoreReady, startSession]);

  const done = loaded && sessionKind !== null && (sessionCards.length === 0 || index >= sessionCards.length);
  /**
   * Days running, read once the session is over.
   *
   * A streak belongs where it has just been earned. On the home page it could
   * only ever be a warning -- you arrive there before studying, so there is
   * nothing to congratulate and the panel could only say what was at risk.
   * Here it is the reward for the work that has this moment been done.
   */
  const [daysRunning, setDaysRunning] = useState<number | null>(null);
  const reviewedThisSession = sessionStats.reviewedCards;

  useEffect(() => {
    if (!done || reviewedThisSession === 0) {
      setDaysRunning(null);
      return;
    }

    let cancelled = false;
    void loadStudyActivity(user.uid)
      .then((activity) => {
        if (!cancelled) setDaysRunning(computeStudyStreak(activity));
      })
      .catch(() => {
        // A flourish on a finished session. If it cannot be read the summary
        // stands without it rather than failing over a decoration.
      });

    return () => {
      cancelled = true;
    };
  }, [done, reviewedThisSession, user.uid]);
  const current = loaded && sessionKind !== null && !done ? sessionCards[index] : null;
  const currentDeck = current
    ? decks.find((deck) => deck.id === current.deckId)
    : undefined;
  const currentDeckColor = getDeckColorPreset(currentDeck?.colorPreset);
  const nextDueCard = useMemo(
    () =>
      cards
        .filter((card) => typeof card.dueDate === "number" && card.dueDate > Date.now())
        .sort((left, right) => (left.dueDate ?? 0) - (right.dueDate ?? 0))[0] ?? null,
    [cards]
  );
  const totalCards = sessionCards.length;
  const remainingCards = current ? totalCards - index : 0;
  const accuracyPercentage = sessionStats.reviewedCards > 0 ? Math.round((sessionStats.correctAnswers / sessionStats.reviewedCards) * 100) : 0;
  const progressPercent = totalCards > 0 ? Math.round((index / totalCards) * 100) : 0;
  const sessionWasCarryoverOnly =
    sessionKind === "daily-required" &&
    sessionCards.length > 0 &&
    sessionCards.every((card) => carryoverRequiredIdSet.has(card.id));

  const bumpSessionRevision = useCallback(() => {
    sessionRevisionRef.current = Math.max(1, sessionRevisionRef.current + 1);
    return sessionRevisionRef.current;
  }, []);

  const getCurrentPersistedSession = useCallback(
    (now = Date.now()) => {
      if (!sessionKind) {
        return null;
      }

      const currentSession = buildPersistedStudySession({
        userId: user.uid,
        sessionId: sessionIdRef.current,
        revision: sessionRevisionRef.current,
        studyDayKey: sessionStudyDayKeyRef.current,
        kind: sessionKind,
        sessionCards,
        index,
        stats: sessionStats,
        selectedDeckIds,
        selectedTopicIds,
        startedAt: sessionStartedAtRef.current,
        now,
      });

      sessionIdRef.current = currentSession.sessionId;
      sessionStartedAtRef.current = currentSession.startedAt;
      sessionStudyDayKeyRef.current = currentSession.studyDayKey;
      sessionRevisionRef.current = currentSession.revision;
      latestPersistedSessionRef.current = currentSession;
      return currentSession;
    },
    [index, selectedDeckIds, selectedTopicIds, sessionCards, sessionKind, sessionStats, user.uid]
  );

  useEffect(() => {
    if (!loaded || !sessionKind) return;

    const now = Date.now();
    const currentSession = getCurrentPersistedSession(now);
    if (!currentSession) return;

    if (done) {
      const closeKey = `${currentSession.sessionId}:${currentSession.revision}:completed`;
      clearPersistedStudySession(user.uid);
      const closedSession = closePersistedStudySession(currentSession, "completed", "completed", now);
      saveClosedStudySessionTombstone(closedSession);
      latestPersistedSessionRef.current = null;
      if (remoteCloseKeyRef.current !== closeKey) {
        remoteCloseKeyRef.current = closeKey;
        void closeRemoteStudySession(
          user.uid,
          currentSession,
          "completed",
          "completed",
          now
        )
          .then((saved) => {
            if (saved) {
              markClosedStudySessionTombstoneSynced(user.uid);
            }
          })
          .catch((error) => {
            console.warn("Failed to close completed study session.", error);
          });
      }
      return;
    }

    savePersistedStudySession(currentSession);
    void saveRemoteActiveStudySession(currentSession).catch((error) => {
      console.warn("Failed to save active study session.", error);
    });
  }, [done, getCurrentPersistedSession, loaded, sessionKind, user.uid]);

  useEffect(() => {
    const persistBeforeSuspend = () => {
      const currentSession = getCurrentPersistedSession();
      if (currentSession && currentSession.status === "active") {
        savePersistedStudySession(currentSession);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistBeforeSuspend();
      }
    };

    window.addEventListener("pagehide", persistBeforeSuspend);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("freeze", persistBeforeSuspend);

    return () => {
      window.removeEventListener("pagehide", persistBeforeSuspend);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("freeze", persistBeforeSuspend);
    };
  }, [getCurrentPersistedSession]);

  const goNext = () => {
    setIndex((value) => value + 1);
    setFlipped(false);
  };

  const requeueCurrentCard = (nextCard: Card) => {
    setSessionCards((prev) => {
      const before = prev.slice(0, index);
      const after = prev.slice(index + 1);
      return [...before, ...after, nextCard];
    });
    setFlipped(false);
  };

  const handleOfflineRating = async (rating: CardRating) => {
    if (!current || !sessionKind) return;
    if (sessionKind === "simple") return;

    const now = Date.now();
    const durationMs = flipTimestampRef.current > 0 ? now - flipTimestampRef.current : undefined;
    const isCorrect = isSuccessfulRating(rating);
    const isStruggle = isStruggleRating(rating);
    const schedule = sessionKind === "custom" ? null : updateCardSchedule(current, rating);
    const cardUpdates: Record<string, number | string> = {};
    let retryResult: { attemptCount: number; parked: boolean } | null = null;

    if (schedule) {
      Object.assign(cardUpdates, schedule);
    } else if (isStruggle) {
      const studyDayKey = getStudyDayKey(now);
      cardUpdates.lastStruggleAt = now;
      cardUpdates.lastStruggleStudyDayKey = studyDayKey;
      cardUpdates.memoryRiskOverrideDayKey = shiftStudyDayKey(studyDayKey, 1);
      cardUpdates.customStruggleCount = (current.customStruggleCount ?? 0) + 1;
    }
    if (isStruggle) {
      cardUpdates.simpleStudyLastResult = "wrong";
      cardUpdates.simpleStudyLastReviewedAt = now;
      cardUpdates.simpleStudyWrongCount = (current.simpleStudyWrongCount ?? 0) + 1;
    }

    if (sessionKind === "daily-required" && isStruggle) {
      const currentAttempts = dailyReviewState?.requiredRetryCounts[current.id] ?? 0;
      const attemptCount = currentAttempts + 1;
      retryResult = {
        attemptCount,
        parked: attemptCount >= DAILY_REVIEW_MAX_WEAK_ATTEMPTS,
      };
    }

    const parkedRiskUpdates =
      sessionKind === "daily-required" && isStruggle && retryResult?.parked
        ? {
            lastStruggleAt: now,
            lastStruggleStudyDayKey: getStudyDayKey(now),
            memoryRiskOverrideDayKey: shiftStudyDayKey(getStudyDayKey(now), 1),
          }
        : null;

    if (parkedRiskUpdates) {
      Object.assign(cardUpdates, parkedRiskUpdates);
    }

    queueOfflineStudyReview({
      userId: user.uid,
      cardId: current.id,
      deckId: current.deckId,
      topicIds: current.topicIds ?? [],
      folderIds: decks.find((deck) => deck.id === current.deckId)?.folderIds ?? [],
      rating,
      reviewedAt: now,
      studyDayKey: getStudyDayKey(now),
      isCorrect,
      durationMs,
      sessionKind,
      cardUpdates,
      clearMemoryRiskOverrideDayKey: Boolean(schedule && isCorrect),
    });
    refreshPendingOfflineReviews();
    const nextCard: Card = {
      ...current,
      ...(schedule ?? {}),
      ...(parkedRiskUpdates ?? {}),
      ...(sessionKind === "custom" && isStruggle
        ? {
            lastStruggleAt: now,
            lastStruggleStudyDayKey: getStudyDayKey(now),
            memoryRiskOverrideDayKey: shiftStudyDayKey(getStudyDayKey(now), 1),
            customStruggleCount: (current.customStruggleCount ?? 0) + 1,
          }
        : {}),
      ...(isStruggle
        ? {
            simpleStudyLastResult: "wrong" as const,
            simpleStudyLastReviewedAt: now,
            simpleStudyWrongCount: (current.simpleStudyWrongCount ?? 0) + 1,
          }
        : {}),
      ...(schedule && isCorrect ? { memoryRiskOverrideDayKey: undefined } : {}),
    };
    const nextCardsSnapshot = cards.map((card) => (card.id === current.id ? nextCard : card));

    if (schedule || (sessionKind === "custom" && isStruggle)) {
      setCards(nextCardsSnapshot);
      saveOfflineStudySnapshot(user.uid, { cards: nextCardsSnapshot, decks });
    }

    if (sessionKind === "daily-required") {
      if (isStruggle && retryResult) {
        setDailyReviewState((prev) => prev ? {
          ...prev,
          requiredRetryCounts: { ...prev.requiredRetryCounts, [current.id]: retryResult.attemptCount },
          parkedRequiredCardIds: retryResult.parked && !prev.parkedRequiredCardIds.includes(current.id) ? [...prev.parkedRequiredCardIds, current.id] : prev.parkedRequiredCardIds,
          updatedAt: now,
        } : prev);
      } else {
        setDailyReviewState((prev) => prev ? { ...prev, completedRequiredCardIds: prev.completedRequiredCardIds.includes(current.id) ? prev.completedRequiredCardIds : [...prev.completedRequiredCardIds, current.id], updatedAt: now } : prev);
      }
    } else if (sessionKind === "daily-optional") {
      setDailyReviewState((prev) => prev ? { ...prev, completedOptionalCardIds: prev.completedOptionalCardIds.includes(current.id) ? prev.completedOptionalCardIds : [...prev.completedOptionalCardIds, current.id], updatedAt: now } : prev);
    }

    bumpSessionRevision();
    setOfflineMode(true);
    setSessionStats((prev) => ({ reviewedCards: prev.reviewedCards + 1, correctAnswers: prev.correctAnswers + (isCorrect ? 1 : 0), completedGoals: prev.completedGoals, starsEarned: prev.starsEarned, ratings: { ...prev.ratings, [rating]: prev.ratings[rating] + 1 } }));
    setAnswerFeedback(getAnswerFeedback(rating, sessionKind, Boolean(retryResult?.parked)));
    success("Saved offline. This answer will sync when you are back online.");

    if (sessionKind === "daily-required" && isStruggle && retryResult && !retryResult.parked) {
      requeueCurrentCard(nextCard);
    } else {
      goNext();
    }
  };

  const handleSimpleStudyResult = async (result: SimpleStudyResult) => {
    if (!current || sessionKind !== "simple" || savingRating) return;

    const now = Date.now();
    const nextCard = applySimpleStudyResultToCard(current, result, now);
    const nextCardsSnapshot = cards.map((card) => (card.id === current.id ? nextCard : card));
    const ratingForStats: CardRating = result === "correct" ? "good" : "again";
    setSavingRating(ratingForStats);
    clearFeedback();

    setCards(nextCardsSnapshot);
    saveOfflineStudySnapshot(user.uid, { cards: nextCardsSnapshot, decks });
    if (result === "correct") {
      setSessionCards((prev) => prev.map((card) => (card.id === current.id ? nextCard : card)));
      setIndex((value) => Math.min(value + 1, sessionCards.length));
    } else {
      setSessionCards((prev) => applySimpleStudyResultToQueue(prev, current.id, result, now));
    }
    bumpSessionRevision();
    setSessionStats((prev) => ({
      reviewedCards: prev.reviewedCards + 1,
      correctAnswers: prev.correctAnswers + (result === "correct" ? 1 : 0),
      completedGoals: prev.completedGoals,
      starsEarned: prev.starsEarned,
      ratings: { ...prev.ratings, [ratingForStats]: prev.ratings[ratingForStats] + 1 },
    }));
    setAnswerFeedback(getSimpleStudyFeedback(result));
    setFlipped(false);

    try {
      await recordSimpleStudyResult(current.id, result, now);
    } catch (error) {
      console.warn("Failed to save Simple Study result.", error);
      setOfflineMode(true);
      success("Kept this Simple Study answer in your current session. It will refresh when your connection settles.");
    } finally {
      setSavingRating(null);
    }
  };

  const handleRating = async (rating: CardRating) => {
    if (!current || !sessionKind) return;
    if (sessionKind === "simple") {
      await handleSimpleStudyResult(rating === "again" || rating === "hard" ? "wrong" : "correct");
      return;
    }
    setSavingRating(rating);
    clearFeedback();
    try {
      if (offlineMode || (typeof navigator !== "undefined" && !navigator.onLine)) {
        await handleOfflineRating(rating);
        return;
      }

      const now = Date.now();
      const isCorrect = isSuccessfulRating(rating);
      const isStruggle = isStruggleRating(rating);
      const schedule = sessionKind === "custom" ? null : updateCardSchedule(current, rating);
      const cardReviewUpdate = buildCardReviewUpdateCommand({
        schedule,
        isCorrect,
        isStruggle,
        reviewedAt: now,
      });

      const reviewPromise = recordStudyReview(user.uid, now, {
        isCorrect,
        durationMs: flipTimestampRef.current > 0 ? now - flipTimestampRef.current : undefined,
        sessionKind: sessionKind === "custom" ? "custom" : "daily",
      });
      const goalProgressPromise = applyGoalProgressForAnswer(user.uid, isCorrect, now, {
        deckId: current.deckId,
        topicIds: current.topicIds ?? [],
        folderIds: decks.find((deck) => deck.id === current.deckId)?.folderIds ?? [],
      });
      const remainingPromises: Promise<unknown>[] = [];
      if (hasCardReviewUpdateCommand(cardReviewUpdate)) {
        remainingPromises.push(
          updateCardAfterReview(current.id, cardReviewUpdate)
        );
      }
      let retryResultPromise: Promise<{ attemptCount: number; parked: boolean }> | null = null;
      if (sessionKind === "daily-required" && isStruggle) {
        retryResultPromise = recordDailyReviewWeakAttempt(user.uid, current.id, now);
        remainingPromises.push(retryResultPromise);
      } else if (sessionKind === "daily-required") {
        remainingPromises.push(markDailyReviewCardComplete(user.uid, current.id, "required"));
      }
      if (sessionKind === "daily-optional") remainingPromises.push(markDailyReviewCardComplete(user.uid, current.id, "optional"));
      const [, goalProgress] = await Promise.all([reviewPromise, goalProgressPromise, ...remainingPromises]);
      const retryResult = retryResultPromise ? await retryResultPromise : null;
      const parkedRiskUpdates =
        sessionKind === "daily-required" && isStruggle && retryResult?.parked
          ? {
              lastStruggleAt: now,
              lastStruggleStudyDayKey: getStudyDayKey(now),
              memoryRiskOverrideDayKey: shiftStudyDayKey(getStudyDayKey(now), 1),
            }
          : null;
      if (parkedRiskUpdates) {
        await updateCardAfterReview(current.id, {
          values: parkedRiskUpdates,
        });
      }
      const nextCard: Card = {
        ...current,
        ...(schedule ?? {}),
        ...(parkedRiskUpdates ?? {}),
        ...(sessionKind === "custom" && isStruggle
          ? {
              lastStruggleAt: now,
              lastStruggleStudyDayKey: getStudyDayKey(now),
              memoryRiskOverrideDayKey: shiftStudyDayKey(getStudyDayKey(now), 1),
              customStruggleCount: (current.customStruggleCount ?? 0) + 1,
            }
          : {}),
        ...(isStruggle
          ? {
              simpleStudyLastResult: "wrong" as const,
              simpleStudyLastReviewedAt: now,
              simpleStudyWrongCount: (current.simpleStudyWrongCount ?? 0) + 1,
            }
          : {}),
        ...(schedule && isCorrect ? { memoryRiskOverrideDayKey: undefined } : {}),
      };
      if (schedule || (sessionKind === "custom" && isStruggle)) {
        setCards((prev) => prev.map((card) => (card.id === current.id ? nextCard : card)));
      }
      if (sessionKind === "daily-required") {
        if (isStruggle && retryResult) {
          setDailyReviewState((prev) => prev ? {
            ...prev,
            requiredRetryCounts: { ...prev.requiredRetryCounts, [current.id]: retryResult.attemptCount },
            parkedRequiredCardIds: retryResult.parked && !prev.parkedRequiredCardIds.includes(current.id) ? [...prev.parkedRequiredCardIds, current.id] : prev.parkedRequiredCardIds,
            updatedAt: now,
          } : prev);
        } else {
          setDailyReviewState((prev) => prev ? { ...prev, completedRequiredCardIds: prev.completedRequiredCardIds.includes(current.id) ? prev.completedRequiredCardIds : [...prev.completedRequiredCardIds, current.id], updatedAt: now } : prev);
        }
      } else if (sessionKind === "daily-optional") {
        setDailyReviewState((prev) => prev ? { ...prev, completedOptionalCardIds: prev.completedOptionalCardIds.includes(current.id) ? prev.completedOptionalCardIds : [...prev.completedOptionalCardIds, current.id], updatedAt: now } : prev);
      }
      bumpSessionRevision();
      setSessionStats((prev) => ({ reviewedCards: prev.reviewedCards + 1, correctAnswers: prev.correctAnswers + (isCorrect ? 1 : 0), completedGoals: prev.completedGoals + goalProgress.completedGoals, starsEarned: prev.starsEarned + goalProgress.starsEarned, ratings: { ...prev.ratings, [rating]: prev.ratings[rating] + 1 } }));
      setAnswerFeedback(
        withGoalReward(
          getAnswerFeedback(rating, sessionKind, Boolean(retryResult?.parked)),
          goalProgress
        )
      );
      // Only the first is shown: finishing two goals on one card is rare, and
      // stacking overlays would bury the card behind the celebration.
      if (goalProgress.rewards.length > 0) setStarReward(goalProgress.rewards[0]);
      if (sessionKind === "daily-required" && isStruggle && retryResult && !retryResult.parked) {
        requeueCurrentCard(nextCard);
      } else {
        goNext();
      }
    } catch (error) {
      console.error(error);
      showError("Failed to save that answer. Please try again.");
    } finally {
      setSavingRating(null);
    }
  };

  const handleFlip = useCallback(() => {
    if (!current || flipped) return;
    flipTimestampRef.current = Date.now();
    setFlipped(true);
    // The tutor is told whether the card is flipped, so a drawer left open
    // across the flip would be answering about the wrong phase.
    setJamiAssistantOpen(false);
  }, [current, flipped, setFlipped, setJamiAssistantOpen]);

  const getLearnAssistantContext = useCallback(async (): Promise<JamiAssistantContext> => {
    if (!current) {
      throw new Error("This flashcard is no longer available.");
    }

    return {
      surface: "learn",
      cardId: current.id,
      phase: flipped ? "answer" : "question",
    };
  }, [current, flipped]);

  // Openers so the input is not blank, not a hint ladder. Keeping the answer
  // back before the flip is handled server-side, where it is actually
  // enforceable, rather than by asking politely through a chip.
  const learnAssistantQuickActions = useMemo(
    () =>
      flipped
        ? [
            { label: "Explain simply", prompt: "Explain this card simply." },
            { label: "Give an example", prompt: "Give me a clear example of this idea." },
            {
              label: "What might I mix up?",
              prompt: "What is this commonly confused with, and how can I tell the difference?",
            },
          ]
        : [
            { label: "Nudge me", prompt: "Nudge me towards this without giving it away." },
            {
              label: "Break it down",
              prompt: "What is this question actually asking? Break it down for me.",
            },
            {
              label: "Quiz my thinking",
              prompt: "Ask me one short question that helps me work this out myself.",
            },
          ],
    [flipped]
  );

  const handleRatingRef = useRef(handleRating);
  useEffect(() => {
    handleRatingRef.current = handleRating;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!flipped && current) handleFlip();
        return;
      }
      if (!flipped || savingRating !== null || !current) return;
      const ratingMap: Record<string, CardRating> =
        sessionKind === "simple"
          ? { "1": "again", "2": "good" }
          : { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      const mappedRating = ratingMap[event.key];
      if (mappedRating) {
        event.preventDefault();
        void handleRatingRef.current(mappedRating);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, flipped, handleFlip, savingRating, sessionKind]);

  const exitSession = () => {
    if (sessionKind) {
      const now = Date.now();
      const status = done ? "completed" : "ended";
      const reason = done ? "completed" : "user-ended";
      const currentSession =
        getCurrentPersistedSession(now) ??
        buildPersistedStudySession({
          userId: user.uid,
          sessionId: sessionIdRef.current,
          revision: sessionRevisionRef.current,
          studyDayKey: sessionStudyDayKeyRef.current,
          kind: sessionKind,
          sessionCards,
          index: done ? sessionCards.length : index,
          stats: sessionStats,
          selectedDeckIds,
          selectedTopicIds,
          startedAt: sessionStartedAtRef.current,
          now,
        });
      const closedSession = closePersistedStudySession(currentSession, status, reason, now);

      saveClosedStudySessionTombstone(closedSession);
      remoteCloseKeyRef.current = `${closedSession.sessionId}:${closedSession.closedRevision ?? closedSession.revision}:${closedSession.status}`;
      void closeRemoteStudySession(user.uid, currentSession, status, reason, now)
        .then((saved) => {
          if (saved) {
            markClosedStudySessionTombstoneSynced(user.uid);
          }
        })
        .catch((error) => {
          console.warn("Failed to close active study session.", error);
        });
    }

    clearPersistedStudySession(user.uid);
    sessionStartedAtRef.current = null;
    sessionStudyDayKeyRef.current = null;
    sessionIdRef.current = null;
    sessionRevisionRef.current = 0;
    latestPersistedSessionRef.current = null;
    setSessionKind(null);
    setSessionCards([]);
    setSessionStats(createEmptySessionStats());
    setIndex(0);
    setFlipped(false);
    setSavingRating(null);
    setAnswerFeedback(null);
  };

  return (
    <AppPage
      title="Learn"
      backHref="/dashboard"
      backLabel="Today"
      width={sessionKind === null ? "2xl" : "study"}
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => clearFeedback()} /> : null}
      {offlineMode || pendingOfflineReviews > 0 ? (
        <div className="rounded-xl border border-warm-border bg-warm-glow p-4 text-sm text-text-secondary">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold text-text-primary">
                {offlineMode ? "Offline study is active" : "Offline answers are waiting to sync"}
              </div>
              <p className="mt-1 leading-6">
                {pendingOfflineReviews > 0
                  ? `${pendingOfflineReviews} review${pendingOfflineReviews === 1 ? "" : "s"} will sync when the browser is online.`
                  : offlineSnapshotAt
                    ? `Using a study snapshot saved ${new Date(offlineSnapshotAt).toLocaleString()}.`
                    : "Cards are cached locally when a study queue loads."}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={pendingOfflineReviews === 0 || offlineMode}
              onClick={() => void syncPendingOfflineReviews()}
            >
              Sync now
            </Button>
          </div>
        </div>
      ) : null}
      {!loaded ? (
        <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-72" /></div>
      ) : (
        <>
          {sessionKind === null ? (
            <>
              {!hasCards ? (
                <EmptyState
                  title="Nothing to review yet"
                  description="Create one card and it will appear here ready to learn."
                  action={<Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] shadow-accent transition duration-fast hover:bg-accent-hover">Create cards</Link>}
                  secondaryAction={<Link href="/dashboard/decks" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] shadow-button-secondary transition duration-fast hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)]">Open decks</Link>}
                />
              ) : null}
              {hasCards ? (
                <SurfaceCard tone="warm" padding="lg">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 max-w-2xl">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                        Daily Review
                      </div>
                      <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-text-primary sm:text-3xl">
                        {hasCarryoverRequiredCards
                          ? "Finish yesterday's review first."
                          : remainingRequiredCards.length > 0
                            ? "Your next review is ready."
                            : "You're clear for today."}
                      </h2>
                      <p className="mt-3 max-w-xl text-sm leading-6 text-text-secondary sm:text-base">
                        {hasCarryoverRequiredCards
                          ? "Continue the unfinished cards, then move into today's set when you're ready."
                          : remainingRequiredCards.length > 0
                            ? "Start with the cards most likely to slip from memory."
                            : remainingOptionalCards.length > 0
                              ? "Your priority cards are done. Easy extras are available if you want another pass."
                              : "There is nothing you need to review right now."}
                      </p>
                    </div>
                    <div className="shrink-0 text-sm text-text-muted sm:text-right">
                      <span>Next reset in </span>
                      <span className="font-semibold tabular-nums text-text-secondary">
                        {formatResetCountdown(countdownMs)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-x-8 gap-y-5 border-y border-[var(--color-border)] py-5">
                    {hasCarryoverRequiredCards ? (
                      <StudyHomeStat
                        value={remainingCarryoverRequiredCards.length}
                        label="Unfinished"
                      />
                    ) : null}
                    <StudyHomeStat
                      value={remainingFreshRequiredCards.length}
                      label={hasCarryoverRequiredCards ? "Today" : "Needs attention"}
                    />
                    <StudyHomeStat
                      value={remainingOptionalCards.length}
                      label="Easy extras"
                    />
                  </div>

                  <div data-tutorial-target="complete-review" className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
                    {hasCarryoverRequiredCards ? (
                      <Button
                        type="button"
                        onClick={() =>
                          startSession("daily-required", "carryover")
                        }
                        variant="warm"
                        size="lg"
                        className="w-full sm:w-auto"
                      >
                        Continue unfinished review
                      </Button>
                    ) : remainingRequiredCards.length > 0 ? (
                      <Button
                        type="button"
                        onClick={() => startSession("daily-required", "all")}
                        variant="warm"
                        size="lg"
                        className="w-full sm:w-auto"
                      >
                        Start Daily Review
                      </Button>
                    ) : remainingOptionalCards.length === 0 ? (
                      <span className="app-success inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold">
                        All clear
                      </span>
                    ) : null}

                    {hasCarryoverRequiredCards &&
                    remainingFreshRequiredCards.length > 0 ? (
                      <Button
                        type="button"
                        onClick={() => startSession("daily-required", "fresh")}
                        variant="secondary"
                        size="md"
                        className="w-full sm:w-auto"
                      >
                        Start today&apos;s cards
                      </Button>
                    ) : null}

                    {remainingOptionalCards.length > 0 ? (
                      <Button
                        type="button"
                        onClick={() => startSession("daily-optional")}
                        variant={
                          remainingRequiredCards.length === 0
                            ? "secondary"
                            : "ghost"
                        }
                        size="md"
                        className="w-full sm:w-auto"
                      >
                        Review easy extras
                      </Button>
                    ) : null}
                  </div>
                </SurfaceCard>
              ) : null}
              {hasCards ? (
                <section
                  aria-labelledby="other-study-heading"
                  className="space-y-3"
                >
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                      Your choice
                    </div>
                    <h2
                      id="other-study-heading"
                      className="mt-1 text-xl font-semibold tracking-tight text-text-primary"
                    >
                      Other ways to study
                    </h2>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <SurfaceCard
                      padding="md"
                      className="flex h-full flex-col"
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                        Focused Review
                      </div>
                      <h3 className="mt-2 text-lg font-semibold text-text-primary">
                        Choose exactly what to practice
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-text-secondary">
                        Pick decks or Topics for a targeted session.
                      </p>
                      <div
                        className="mt-4 text-sm font-medium text-text-muted"
                        aria-live="polite"
                      >
                        {hasCustomFilters
                          ? `${selectedDeckIds.length + selectedTopicIds.length} selected · ${customPreviewCards.length} cards`
                          : `${customPreviewCards.length} cards available`}
                      </div>
                      <div className="mt-auto flex flex-col gap-2 pt-5 sm:flex-row sm:flex-wrap">
                        <Button
                          ref={focusedReviewToggleRef}
                          type="button"
                          variant="secondary"
                          aria-expanded={focusedReviewOpen}
                          aria-controls="focused-review-builder"
                          onClick={() =>
                            setFocusedReviewOpen((currentOpen) => !currentOpen)
                          }
                          className="w-full sm:w-auto"
                        >
                          {focusedReviewOpen
                            ? "Hide choices"
                            : hasCustomFilters
                              ? "Edit selection"
                              : "Choose decks or Topics"}
                        </Button>
                        {customPreviewCards.length > 0 ? (
                          <Button
                            type="button"
                            onClick={handleCustomReviewClick}
                            className="w-full sm:w-auto"
                          >
                            Start Focused Review
                          </Button>
                        ) : null}
                      </div>
                    </SurfaceCard>

                    <SurfaceCard
                      padding="md"
                      className="flex h-full flex-col"
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                        Simple Study
                      </div>
                      <h3 className="mt-2 text-lg font-semibold text-text-primary">
                        Make one quick pass
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-text-secondary">
                        Clear new and missed cards with a simple correct-or-wrong choice.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-muted">
                        <span>
                          <strong className="font-semibold tabular-nums text-text-primary">
                            {simpleStudyQueue.newCount}
                          </strong>{" "}
                          new
                        </span>
                        <span>
                          <strong className="font-semibold tabular-nums text-text-primary">
                            {simpleStudyQueue.wrongCount}
                          </strong>{" "}
                          missed
                        </span>
                      </div>
                      <div className="mt-auto pt-5">
                        {simpleStudyQueue.cards.length > 0 ? (
                          <Button
                            type="button"
                            onClick={() => startSession("simple")}
                            variant="secondary"
                            className="w-full sm:w-auto"
                          >
                            Start Simple Study
                          </Button>
                        ) : (
                          <span className="app-success inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold">
                            All clear
                          </span>
                        )}
                      </div>
                    </SurfaceCard>
                  </div>
                </section>
              ) : null}
              {hasCards && focusedReviewOpen ? (
                <FocusedReviewBuilder
                  filterKind={focusedFilterKind}
                  onFilterKindChange={setFocusedFilterKind}
                  decks={{
                    search: deckSearch,
                    onSearchChange: setDeckSearch,
                    searchResults: deckSearchResults,
                    recents: recentDecks,
                    selectedIds: selectedDeckIds,
                    namesById: deckNamesById,
                    cardCounts: deckCardCounts,
                    onToggle: toggleDeckFilter,
                  }}
                  topics={{
                    search: topicSearch,
                    onSearchChange: setTopicSearch,
                    searchResults: topicSearchResults,
                    recents: recentTopics,
                    selectedIds: selectedTopicIds,
                    namesById: topicNamesById,
                    cardCounts: topicCardCounts,
                    onToggle: toggleTopicFilter,
                  }}
                  previewCount={customPreviewCards.length}
                  selectionEmpty={customSelectionEmpty}
                  onClearFilters={clearCustomFilters}
                  onClose={closeFocusedReviewBuilder}
                  onStart={handleCustomReviewClick}
                />
              ) : null}
            </>
          ) : null}
          {sessionKind === null ? null : done ? (
            totalCards === 0 && sessionStats.reviewedCards === 0 ? (
              <EmptyState
                emoji="Review"
                eyebrow="Nothing to study"
                title="No cards in this session"
                description={sessionKind === "daily-required" ? "Your Daily Review is clear right now." : sessionKind === "daily-optional" ? "There are no easy extras left right now." : sessionKind === "simple" ? "Simple Study is clear right now." : "This Focused Review does not match any cards yet."}
                helperText="That is not a bug, it just means this queue is empty for the current selection."
                action={<Button type="button" onClick={exitSession}>Back to study home</Button>}
                secondaryAction={sessionKind === "custom" ? <Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] shadow-button-secondary transition duration-fast hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)]">Edit cards</Link> : undefined}
              />
            ) : (
              <SurfaceCard tone="warm" padding="lg" className="animate-warm-glow-pulse">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-text-muted">Session complete</div>
                    <h2 className="mt-3 text-xl font-medium leading-tight tracking-tight text-text-primary sm:text-2xl">Good work.</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                      {sessionKind === "simple"
                        ? `You cleared Simple Study after ${sessionStats.reviewedCards} answer${sessionStats.reviewedCards === 1 ? "" : "s"}. Your next best step is ready below.`
                        : `You reviewed ${sessionStats.reviewedCards} of ${totalCards} card${totalCards === 1 ? "" : "s"}. Your next best step is ready below.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm text-text-secondary">
                      <span className="text-sm font-semibold text-text-primary">{accuracyPercentage}%</span> accuracy
                    </div>
                    {daysRunning !== null && daysRunning > 0 ? (
                      <div className="rounded-xl border border-warm-border bg-warm-glow px-4 py-3 text-sm text-text-secondary">
                        <span className="text-sm font-semibold text-text-primary">
                          {daysRunning}
                        </span>{" "}
                        day{daysRunning === 1 ? "" : "s"} running
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Reviewed</div>
                    <div className="mt-2 flex min-h-7 items-center justify-center text-lg font-semibold leading-none tabular-nums text-text-primary">{sessionStats.reviewedCards}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-sm">
                    <div className="text-center text-xs text-text-muted">Ratings</div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-text-secondary">
                      {(["again", "hard", "good", "easy"] as CardRating[]).map((rating) => (
                        <span key={rating} className="inline-flex items-center justify-between gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2.5 py-1">
                          <span>{RATING_LABELS[rating]}</span>
                          <span className="font-semibold tabular-nums text-text-primary">{sessionStats.ratings[rating]}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Goals completed</div>
                    <div className="mt-2 flex min-h-7 items-center justify-center text-lg font-semibold leading-none tabular-nums text-text-primary">{sessionStats.completedGoals}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Rewards</div>
                    <div className="mt-2 text-sm text-text-secondary"><span className="font-semibold tabular-nums text-text-primary">{sessionStats.starsEarned}</span> star{sessionStats.starsEarned === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Next best step</div>
                  <div className="mt-2 text-base font-semibold text-text-primary sm:text-lg">
                    {sessionWasCarryoverOnly && remainingFreshRequiredCards.length > 0
                      ? "Today's priority cards are ready"
                      : sessionKind === "simple"
                        ? "Simple Study is clear"
                      : sessionKind === "daily-required" && remainingOptionalCards.length > 0
                      ? "Easy extras are ready"
                      : hasCards && customPreviewCards.length > 0
                        ? "Focused Review is ready"
                        : sessionStats.completedGoals > 0
                          ? "Check your new star"
                          : "Tidy your cards"}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-text-secondary">
                    {sessionWasCarryoverOnly && remainingFreshRequiredCards.length > 0
                      ? "The unfinished carryover is clear. Move into the fresh cards selected for this Daily Review when you are ready."
                      : sessionKind === "simple"
                        ? "You can switch to Daily Review, build a focused session, or come back when more cards need a simple pass."
                      : sessionKind === "daily-required" && remainingOptionalCards.length > 0
                      ? "These are lighter extra reps. Do them only if you want a little more practice today."
                      : hasCards && customPreviewCards.length > 0
                        ? "Build a session from any deck or Topic whenever you want targeted practice."
                        : sessionStats.completedGoals > 0
                          ? "Goal rewards become stars in your constellation."
                          : "Review is done for now. Add, fix, or tidy cards whenever something feels off."}
                  </p>
                  {nextDueCard?.dueDate ? (
                    <p className="mt-3 text-xs font-medium text-text-muted">
                      Next due card: {new Intl.DateTimeFormat("en", {
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        month: "short",
                      }).format(nextDueCard.dueDate)}
                    </p>
                  ) : null}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  {sessionWasCarryoverOnly && remainingFreshRequiredCards.length > 0 ? (
                    <Button type="button" onClick={() => startSession("daily-required", "fresh")} size="lg" variant="warm">Start today&apos;s priority cards</Button>
                  ) : sessionKind === "daily-required" && remainingOptionalCards.length > 0 ? (
                    <Button type="button" onClick={() => startSession("daily-optional")} size="lg" variant="warm">Review easy extras</Button>
                  ) : hasCards && customPreviewCards.length > 0 ? (
                    <Button type="button" onClick={() => startSession("custom")} size="lg" variant="warm">Start Focused Review</Button>
                  ) : sessionStats.completedGoals > 0 ? (
                    <Link href="/dashboard/constellation" className="inline-flex min-h-[3.25rem] items-center justify-center rounded-2xl border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-5 py-3 text-base font-medium text-[#10091d] shadow-warm transition duration-fast hover:-translate-y-[1px] hover:brightness-105">View constellation</Link>
                  ) : (
                    <Link href="/dashboard/cards" className="inline-flex min-h-[3.25rem] items-center justify-center rounded-2xl border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-5 py-3 text-base font-medium text-[#10091d] shadow-warm transition duration-fast hover:-translate-y-[1px] hover:brightness-105">Edit cards</Link>
                  )}
                  {sessionKind === "simple" && simpleStudyQueue.cards.length === 0 ? null : (
                    <Button type="button" onClick={() => startSession(sessionKind)} size="lg" variant="secondary">Run this session again</Button>
                  )}
                  <Button type="button" onClick={exitSession} variant="secondary" size="lg">Back to study home</Button>
                </div>
              </SurfaceCard>
            )
          ) : current ? (
            <div key={current.id} className="animate-slide-up space-y-4 sm:space-y-5">
              <InlineStudyFeedback feedback={answerFeedback} />
              <section className="study-session-stage space-y-5 px-1 py-2 sm:px-2 sm:py-3">
                  <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div className="min-w-0">
                      <div className="text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted">{getSessionLabel(sessionKind)}</div>
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1.5 text-sm leading-none text-text-secondary">
                        <span className="font-semibold tabular-nums text-text-primary">{remainingCards}</span>
                        <span className="text-text-muted">/</span>
                        <span className="tabular-nums">{totalCards}</span>
                        <span>cards remaining</span>
                      </div>
                    </div>
                    {/*
                      The grid has two columns, so progress and the Jami button
                      share the second one. As separate children the button
                      became a third grid item, wrapped to its own row and
                      stretched to a full-width bar.
                    */}
                    <div className="flex items-end gap-2.5">
                      <div className="min-w-[10rem] flex-1 lg:min-w-[12rem] lg:flex-none">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-text-muted">
                          <span>Progress</span>
                          <span className="tabular-nums">{progressPercent}%</span>
                        </div>
                        <ProgressBar progress={progressPercent} />
                      </div>
                      <button
                        type="button"
                        title="Ask Jami about this card"
                        aria-label="Ask Jami about this card"
                        aria-haspopup="dialog"
                        aria-expanded={jamiAssistantOpen}
                        onClick={() => setJamiAssistantOpen(true)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1.5 text-xs font-semibold text-text-secondary transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                      >
                        <JamiTutorIcon className="h-4 w-4" />
                        Jami
                      </button>
                    </div>
                  </div>

                  <JamiAssistantDrawer
                    open={jamiAssistantOpen}
                    onOpenChange={setJamiAssistantOpen}
                    resetKey={current.id}
                    contextKey={`learn:${current.id}`}
                    contextLabel="Current flashcard"
                    historyContextLabel={`Flashcard · ${current.front.slice(0, 72)}`}
                    getContext={getLearnAssistantContext}
                    quickActions={learnAssistantQuickActions}
                    emptyStateNote={
                      flipped
                        ? undefined
                        : "Jami cannot see this card's answer until you flip it, so it can nudge you towards it but never hand it over."
                    }
                  />
                  <div data-study-current-card-id={current.id} className="study-flashcard-shell mx-auto w-full max-w-[62rem] cursor-pointer rounded-2xl" onClick={!flipped ? handleFlip : undefined} onKeyDown={(event) => { if (flipped) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleFlip(); } }} role="button" tabIndex={0} aria-label={flipped ? "Flashcard answer shown" : "Flip flashcard"}>
                    <div className={`study-flashcard-turn relative aspect-[5/4] w-full [transform-style:preserve-3d] sm:aspect-[16/10] xl:aspect-[16/9] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
                      <div
                        className="study-flashcard-face study-flashcard-face-front absolute inset-0 flex flex-col rounded-2xl p-5 [backface-visibility:hidden] sm:p-8 lg:p-10"
                        aria-hidden={flipped}
                        inert={flipped}
                        style={{
                          "--study-card-border": currentDeckColor.base,
                        } as React.CSSProperties}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2 text-xs font-medium opacity-65">
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: currentDeckColor.base }}
                            />
                            <span className="truncate">
                              {deckNamesById[current.deckId] ?? "Flashcard"}
                            </span>
                          </div>
                          {(current.topicIds?.length ?? 0) > 0 ? (
                            <div className="flex max-w-[60%] flex-wrap justify-end gap-1.5">
                              {(current.topicIds ?? []).slice(0, 2).map((topicId) => (
                                <span key={topicId} className="rounded-full border border-current/15 bg-current/[0.05] px-2.5 py-1 text-2xs font-medium opacity-75">
                                  {topicNamesById[topicId] ?? "Topic"}
                                </span>
                              ))}
                              {(current.topicIds?.length ?? 0) > 2 ? (
                                <span className="rounded-full border border-current/15 bg-current/[0.05] px-2.5 py-1 text-2xs font-medium opacity-65">+{(current.topicIds?.length ?? 0) - 2}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-1 items-center justify-center py-6">
                          <StudyText
                            as="p"
                            text={current.front}
                            className="max-w-4xl whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-[color:inherit] sm:text-2xl xl:text-4xl"
                          />
                        </div>
                        <div className="text-center text-xs font-medium opacity-60">Tap anywhere on the card or press Space to reveal</div>
                      </div>
                      {/*
                        backface-visibility hides the answer visually but leaves
                        it in the accessibility tree and in find-in-page, so an
                        unflipped card would read out its own answer. inert and
                        aria-hidden take it out of both until the flip.
                      */}
                      <div
                        className="study-flashcard-face study-flashcard-face-back absolute inset-0 flex flex-col rounded-2xl p-5 [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8 lg:p-10"
                        aria-hidden={!flipped}
                        inert={!flipped}
                        style={{
                          "--study-card-border": currentDeckColor.base,
                        } as React.CSSProperties}
                      >
                        <div className="flex items-center gap-2 text-xs font-normal tracking-[0.06em] opacity-65">
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: currentDeckColor.base }}
                          />
                          <span>Answer</span>
                        </div>
                        <div className="flex flex-1 items-center justify-center py-6">
                          <StudyText
                            as="p"
                            text={current.back}
                            className="max-w-4xl whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-[color:inherit] sm:text-2xl xl:text-4xl"
                          />
                        </div>
                        <div className="text-center text-xs font-medium opacity-60">How well did you recall this?</div>
                      </div>
                    </div>
                  </div>
              </section>
              {flipped ? (
                <div className="sticky bottom-3 z-30 animate-fade-in space-y-3 rounded-xl border border-[var(--color-border)] bg-surface-panel/95 p-2 shadow-e2 backdrop-blur-md sm:static sm:z-auto sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0">
                  {savingRating ? <div className="text-center text-sm text-text-muted">Saving...</div> : null}
                  <div className="space-y-3">
                      {sessionKind === "simple" ? (
                        <div className="grid grid-cols-2 gap-2 sm:gap-3" aria-label="Simple Study answer choices">
                          <button
                            type="button"
                            aria-label="Missed this card"
                            disabled={savingRating !== null}
                            className="flex min-h-[5.2rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-rose-300/25 bg-rose-400/[0.08] px-3 py-4 text-center text-base font-semibold text-rose-100 shadow-e1 transition duration-fast ease-spring hover:-translate-y-[0.5px] hover:border-rose-200/45 hover:bg-rose-400/[0.12] active:scale-[0.985] disabled:saturate-[0.82] disabled:brightness-95 sm:min-h-[4.6rem] sm:px-4 sm:py-3.5 sm:text-sm"
                            onClick={() => void handleSimpleStudyResult("wrong")}
                          >
                            <span>Missed</span>
                            <span className="text-2xs font-normal opacity-75">Back of queue</span>
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 px-2 text-2xs leading-none tabular-nums opacity-75">1</span>
                          </button>
                          <button
                            type="button"
                            aria-label="Got this card right"
                            disabled={savingRating !== null}
                            className="flex min-h-[5.2rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-emerald-300/25 bg-emerald-400/[0.08] px-3 py-4 text-center text-base font-semibold text-emerald-100 shadow-e1 transition duration-fast ease-spring hover:-translate-y-[0.5px] hover:border-emerald-200/45 hover:bg-emerald-400/[0.12] active:scale-[0.985] disabled:saturate-[0.82] disabled:brightness-95 sm:min-h-[4.6rem] sm:px-4 sm:py-3.5 sm:text-sm"
                            onClick={() => void handleSimpleStudyResult("correct")}
                          >
                            <span>Got it</span>
                            <span className="text-2xs font-normal opacity-75">Clear card</span>
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 px-2 text-2xs leading-none tabular-nums opacity-75">2</span>
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                          {(["again", "hard", "good", "easy"] as CardRating[]).map((rating) => {
                            const meta = RATING_STYLES[rating];
                            return (
                            <button
                              key={rating}
                              type="button"
                              disabled={savingRating !== null}
                              className={`flex min-h-[5.2rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-4 text-center text-base font-semibold shadow-e1 transition duration-fast ease-spring hover:-translate-y-[0.5px] active:scale-[0.985] disabled:saturate-[0.82] disabled:brightness-95 sm:min-h-[4.6rem] sm:px-4 sm:py-3.5 sm:text-sm ${meta.classes}`}
                              onClick={() => void handleRating(rating)}
                            >
                              <span>{RATING_LABELS[rating]}</span>
                              <span className="text-2xs font-normal opacity-75">{meta.hint}</span>
                              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 px-2 text-2xs leading-none tabular-nums opacity-75">{meta.shortcut}</span>
                            </button>
                            );
                          })}
                        </div>
                      )}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={exitSession} variant="secondary">End session</Button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {/*
        Mounted at the top of the page rather than beside the card: rating a
        card swaps the card subtree, which was taking the celebration down with
        it after a few hundred milliseconds.
      */}
      <StarRewardOverlay reward={starReward} onDone={handleStarRewardDone} />
    </AppPage>
  );
}
