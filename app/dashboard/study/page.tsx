"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadPresentationHistory, recordPresentation } from "@/services/study/presentation-history";
import { readPresentationViewState } from "@/lib/study/presentation-state";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { toggleIdSelection } from "@/lib/app/multi-select";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import { buildDailyReviewQueues, DAILY_REVIEW_STATE_DOC_ID, getCardsByIds, getRemainingCarryoverRequiredCards, getRemainingFreshRequiredCards, sortCardsByStudyPriority } from "@/lib/study/daily-review";
import { getMsUntilNextStudyBoundary, getStudyDayKey } from "@/lib/study/day";
import { buildCustomReviewCards, countCardsByDeck, countCardsByTopic, EMPTY_FOCUSED_REVIEW_RECENTS, getFocusedReviewRecentsKey, mergeRecentValues, nameById, normalizeFocusedReviewRecents, parseIdsParam, resolveRecents, searchByName } from "@/lib/study/focused-review";
import { formatResetCountdown, getSessionLabel, RATING_LABELS } from "@/lib/study/study-feedback";
import InlineStudyFeedback from "@/components/study/InlineStudyFeedback";
import StudyFlashcard from "@/components/study/StudyFlashcard";
import StudyRatingControls from "@/components/study/StudyRatingControls";
import StudyExerciseStage from "@/components/study/StudyExerciseStage";
import StudyModePicker from "@/components/study/StudyModePicker";
import StudySessionPreparing from "@/components/study/StudySessionPreparing";
import FocusedReviewBuilder from "@/components/study/FocusedReviewBuilder";
import StudyHomeStat from "@/components/study/StudyHomeStat";
import { isSuccessfulRating, type CardRating } from "@/lib/study/scheduler";
import { getNextDueCard, type Card } from "@/lib/study/cards";
import { isFeatureEnabled } from "@/lib/app/feature-flags";
import { DEFAULT_STUDY_MODE_POLICY, readStudyModePolicy, saveStudyModePolicy } from "@/lib/study/study-mode-preference";
import { getCardContentHash, STUDY_MODE_LABELS, type StudyMode, type StudyModePolicy } from "@/lib/study/study-modes";
import { countedDraftKey, presentationDraftKey, resolvePresentationId } from "@/lib/study/presentation-identity";
import { resolveCurrentExercise, type ExercisePin } from "@/lib/study/exercise-resolution";
import { canCarryModeEventually, getModeEligibility } from "@/lib/study/mode-eligibility";
import { buildSessionExerciseSnapshots } from "@/lib/study/session-exercises";
import { buildSimpleStudyQueue } from "@/lib/study/simple-study";
import { getOfflineQueuedReviews, loadOfflineStudySnapshot, saveOfflineStudySnapshot } from "@/lib/study/offline-study";
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
  type PersistedStudyExercise,
  type StudyModeResults,
  type StudySessionKind,
} from "@/lib/study/session";
import { ensureDailyReviewState, ensureStudyStateSetup } from "@/services/study/daily-review";
import { loadUserCards } from "@/services/study/cards";
import { syncOfflineStudyReviews } from "@/services/study/offline";
import { closeRemoteStudySession, loadRemoteActiveStudySession, saveRemoteActiveStudySession } from "@/services/study/session";
import { loadStudyActivity } from "@/services/study/activity";
import { checkTypedAnswer, loadStudyAssets, reportStudyVariant, retireStudyAsset, cardWithStudyAsset as askedCard } from "@/services/study/study-assets";
import type { StudyAsset } from "@/lib/ai/study-assets";
import { computeStudyStreak } from "@/lib/study/activity";
import { getDecks } from "@/services/study/decks";
import { getActiveTopics } from "@/services/study/topics";
import { getTopicNameKey, type Topic } from "@/lib/material/topics";
import { getDeckColorPreset } from "@/lib/study/deck-style";
import AppPage from "@/components/layout/AppPage";
import StarRewardOverlay from "@/components/constellation/StarRewardOverlay";
import { useFocusedReviewState, useStudyDataState, useStudySessionState } from "@/hooks/useStudyWorkspaceState";
import { useStudyExerciseController } from "@/hooks/useStudyExerciseController";
import { useStudyPreparation } from "@/hooks/useStudyPreparation";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import {
  Button, Card as SurfaceCard, EmptyState, FeedbackBanner,
  JamiTutorIcon, ProgressBar, Skeleton,
} from "@/components/ui";

type SessionKind = StudySessionKind;

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
  const studyModesEnabled = isFeatureEnabled("enableStudyModes");
  const [modePolicy, setModePolicyState] = useState<StudyModePolicy>(
    DEFAULT_STUDY_MODE_POLICY
  );
  const setModePolicy = useCallback(
    (next: StudyModePolicy) => {
      setModePolicyState(next);
      saveStudyModePolicy(user.uid, next);
    },
    [user.uid]
  );

  useEffect(() => {
    setModePolicyState(readStudyModePolicy(user.uid));
  }, [user.uid]);
  const [modeResults, setModeResults] = useState<StudyModeResults>({});
  const [recentModes, setRecentModes] = useState<StudyMode[]>([]);
  const [restoredExercises, setRestoredExercises] = useState<PersistedStudyExercise[]>([]);
  const [reportedPresentations, setReportedPresentations] = useState<Set<string>>(() => new Set());
  const [draftResponses, setDraftResponses] = useState<Record<string, string | Record<string, string>>>({});
  const [variantHistory, setVariantHistory] = useState<Record<string, string[]>>({});
  const [outcomeHistory, setOutcomeHistory] = useState<Record<string, Array<"correct" | "partial" | "incorrect" | "uncertain">>>({});
  const [studyAssets, setStudyAssets] = useState<Record<string, StudyAsset>>({});
  const {
    progress: preparation,
    clearProgress: clearPreparation,
    cancel: cancelPreparation,
    skip: skipPreparation,
    prepareSessionAssets,
    prepareRemainingAssets,
  } = useStudyPreparation({
    enabled: studyModesEnabled,
    modePolicy,
    onAssetsReady: useCallback(
      (ready: Record<string, StudyAsset>) =>
        setStudyAssets((prev) => ({ ...prev, ...ready })),
      []
    ),
  });
  const sessionSeedRef = useRef(0);
  const handleStarRewardDone = useCallback(
    () => setStarReward(null),
    [setStarReward]
  );
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
  const pinnedExerciseRef = useRef<ExercisePin | null>(null);
  const countedPresentationsRef = useRef(new Set<string>());

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
    setRestoredExercises([]);
    setRecentModes([]);
    setReportedPresentations(new Set());
    setDraftResponses({});
    setVariantHistory({});
    setOutcomeHistory({});
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
      void (async () => {
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
        const seed = Math.floor(Math.random() * 0x7fffffff) || 1;
        sessionSeedRef.current = seed;
        const history = await loadPresentationHistory(user.uid, nextCards);
        setVariantHistory(history.variants);
        setOutcomeHistory(history.outcomes);
        setRecentModes([]);
        setDraftResponses({});
        setRestoredExercises([]);
        pinnedExerciseRef.current = null;

        const wantsPreparation = studyModesEnabled;

        let assets = studyAssets;
        let remainder: Card[] = [];
        if (wantsPreparation && nextCards.length > 0) {
          try {
            const ready = await prepareSessionAssets(nextCards);
            assets = { ...studyAssets, ...ready.assets };
            remainder = ready.remainder;
            setStudyAssets(assets);
          } catch (error) {
            console.warn("Study preparation failed; starting unprepared.", error);
          } finally {
            clearPreparation();
          }
        }

        const asAsked = (card: Card) => askedCard(card, assets);

        const now = Date.now();

        const eligibleCards =
          studyModesEnabled && modePolicy.kind === "fixed"
            ? nextCards.filter((card) =>
                canCarryModeEventually(asAsked(card), modePolicy.mode, { seed })
              )
            : nextCards;

        if (nextCards.length > 0 && eligibleCards.length === 0) {
          showError(
            "None of these cards can be studied that way yet. Try Smart Mix or another mode."
          );
          return;
        }
        const droppedCards = nextCards.length - eligibleCards.length;
        if (droppedCards > 0) {
          success(
            `${droppedCards} card${droppedCards === 1 ? "" : "s"} left out: they cannot be asked this way.`
          );
        }

        const nextStats = createEmptySessionStats();
        const sessionSelectedDeckIds = kind === "simple" ? [] : selectedDeckIds;
        const sessionSelectedTopicIds = kind === "simple" ? [] : selectedTopicIds;
        const nextSession = buildPersistedStudySession({
          userId: user.uid,
          kind,
          sessionCards: eligibleCards,
          index: 0,
          stats: nextStats,
          selectedDeckIds: sessionSelectedDeckIds,
          selectedTopicIds: sessionSelectedTopicIds,
          startedAt: now,
          now,
          modePolicy,
          seed,
        });

        clearClosedStudySessionTombstone(user.uid);
        sessionIdRef.current = nextSession.sessionId;
        sessionStartedAtRef.current = now;
        sessionStudyDayKeyRef.current = nextSession.studyDayKey;
        sessionRevisionRef.current = nextSession.revision;
        latestPersistedSessionRef.current = nextSession;
        remoteCloseKeyRef.current = null;
        setSessionKind(kind);
        setSessionCards(eligibleCards);
        setSessionStats(nextStats);
        setModeResults({});
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

        void prepareRemainingAssets(remainder);
      })();
    },
    [
      clearFeedback,
      clearPreparation,
      prepareRemainingAssets,
      prepareSessionAssets,
      studyAssets,
      customPreviewCards,
      modePolicy,
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
      showError,
      simpleStudyQueue.cards,
      studyModesEnabled,
      success,
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
      // Server snapshots deliberately omit local responses. Preserve them only
      // for the same session; presentation IDs keep them bound to their exercise.
      if (restoredSession && localSession?.sessionId === restoredSession.sessionId) {
        restoredSession = { ...restoredSession, draftResponses: localSession.draftResponses };
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
      setModePolicyState(restoredSession.modePolicy ?? DEFAULT_STUDY_MODE_POLICY);
      setModeResults(restoredSession.modeResults ?? {});
      setRecentModes(restoredSession.recentModes ?? []);
      setDraftResponses(restoredSession.draftResponses ?? {});
      setVariantHistory(restoredSession.variantHistory ?? {});
      setOutcomeHistory(restoredSession.outcomeHistory ?? {});
      setRestoredExercises(restoredSession.exercises ?? []);
      sessionSeedRef.current = restoredSession.seed ?? 0;
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
  useEffect(() => { if (done) cancelPreparation(); }, [done, cancelPreparation]);
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
  const nextDueCard = useMemo(() => getNextDueCard(cards), [cards]);
  const preparedCurrent = useMemo(
    () => (current ? askedCard(current, studyAssets) : null),
    [current, studyAssets]
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
        modePolicy,
        seed: sessionSeedRef.current,
        modeResults,
        recentModes,
        draftResponses,
        variantHistory,
        outcomeHistory,
        exercises: buildSessionExerciseSnapshots({
          cards: sessionCards.slice(index),
          asAsked: (card) => askedCard(card, studyAssets),
          modePolicy,
          index,
          seed: sessionSeedRef.current,
          modeCounts: Object.fromEntries(Object.entries(modeResults).map(([mode, result]) => [mode, result?.answered ?? 0])) as Partial<Record<StudyMode, number>>,
          recentModes,
          firstExercise: pinnedExerciseRef.current?.exercise ?? null,
          presentationId: pinnedExerciseRef.current?.presentationId,
          sessionId: sessionIdRef.current ?? undefined,
          variantHistory,
          outcomeHistory,
        }),
      });

      sessionIdRef.current = currentSession.sessionId;
      sessionStartedAtRef.current = currentSession.startedAt;
      sessionStudyDayKeyRef.current = currentSession.studyDayKey;
      sessionRevisionRef.current = currentSession.revision;
      latestPersistedSessionRef.current = currentSession;
      return currentSession;
    },
    [
      index,
      modePolicy,
      modeResults,
      recentModes,
      draftResponses,
      variantHistory,
      outcomeHistory,
      selectedDeckIds,
      selectedTopicIds,
      sessionCards,
      sessionKind,
      sessionStats,
      studyAssets,
      user.uid,
    ]
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

  const closeJamiAssistant = useCallback(
    () => setJamiAssistantOpen(false),
    [setJamiAssistantOpen]
  );

  const {
    reveal: handleFlip,
    commitReview,
    revisitAfterHint,
    presentation,
  } = useStudyExerciseController({
    userId: user.uid,
    current,
    sessionKind,
    flipped,
    setFlipped,
    onReveal: closeJamiAssistant,
    cards,
    setCards,
    decks,
    index,
    setIndex,
    sessionCards,
    setSessionCards,
    dailyReviewState,
    setDailyReviewState,
    setSessionStats,
    setAnswerFeedback,
    setStarReward,
    savingRating,
    setSavingRating,
    offlineMode,
    setOfflineMode,
    bumpSessionRevision,
    refreshPendingOfflineReviews,
    clearFeedback,
    notifySuccess: success,
    notifyError: showError,
  });

  const currentExercise = useMemo(() => {
    const asked = preparedCurrent;
    if (!current || !asked || !sessionKind || !studyModesEnabled) return null;
    const { exercise, pin } = resolveCurrentExercise({
      card: current,
      asked,
      index,
      presentation,
      policy: modePolicy,
      sessionId: sessionIdRef.current ?? "session",
      seed: sessionSeedRef.current,
      pinned: pinnedExerciseRef.current,
      restoredExercises,
      reportedPresentations,
      retiredVariantIds: preparedCurrent?.studySettings?.generatedStudy?.retiredVariantIds ?? [],
      isRetiredDraft: (variantId) => draftResponses[`retired:${variantId}`] === "1",
      modeCounts: Object.fromEntries(
        Object.entries(modeResults).map(([mode, result]) => [mode, result?.answered ?? 0])
      ) as Partial<Record<StudyMode, number>>,
      presentationIndex: Object.values(modeResults).reduce((sum, result) => sum + (result?.answered ?? 0), 0),
      recentModes,
      recentVariantIds: variantHistory[current.id] ?? [],
      recentOutcomes: outcomeHistory[current.id] ?? [],
      newId: () => crypto.randomUUID(),
    });
    if (pin) pinnedExerciseRef.current = pin;
    return exercise;
  }, [
    current,
    preparedCurrent,
    index,
    presentation,
    modePolicy,
    restoredExercises,
    modeResults,
    recentModes,
    variantHistory,
    outcomeHistory,
    reportedPresentations,
    draftResponses,
    sessionKind,
    studyModesEnabled,
  ]);

  useEffect(() => {
    if (!studyModesEnabled || sessionCards.length === 0) return;
    let cancelled = false;
    void loadStudyAssets(sessionCards).then((assets) => {
      if (!cancelled) setStudyAssets((prev) => ({ ...prev, ...assets }));
    });
    return () => {
      cancelled = true;
    };
  }, [sessionCards, studyModesEnabled]);

  const handleSemanticCheck = useCallback(
    async (response: string, gapResponses?: Record<string, string>) => {
      if (!current) return null;
      if (!currentExercise?.presentationId) return null;
      const checked = await checkTypedAnswer({ cardId: current.id, response, sourceHash: currentExercise.cardContentHash, presentationId: currentExercise.presentationId, assetKey: currentExercise.markingSettings?.generatedStudy?.sourceHash, bundleRevision: currentExercise.markingSettings?.generatedStudy?.bundleRevision, ...(gapResponses ? { gapResponses, variantId: currentExercise.variantId } : {}) });
      return checked && checked.verdict !== "needs-self-grade"
        ? { ...checked, verdict: checked.verdict }
        : null;
    },
    [current, currentExercise]
  );

  const recordModeAnswer = useCallback((mode: StudyMode, verdict: "correct" | "partial" | "incorrect" | "uncertain", assisted: boolean) => {
    const identity = pinnedExerciseRef.current?.presentationId ?? currentExercise?.presentationId;
    if (!identity) return;
    const countedKey = countedDraftKey(identity);
    if (draftResponses[countedKey] === "1" || countedPresentationsRef.current.has(identity)) return;
    countedPresentationsRef.current.add(identity);
    setDraftResponses((previous) => ({ ...previous, [countedKey]: "1" }));
    if (current) void recordPresentation(user.uid, current.id, { id: identity, sourceHash: getCardContentHash(current), mode, variantId: currentExercise?.variantId, outcome: verdict, assisted, at: Date.now() });
    setRecentModes((previous) => [...previous, mode].slice(-8));
    if (current?.id && currentExercise?.variantId) {
      setVariantHistory((previous) => ({ ...previous, [current.id]: [...(previous[current.id] ?? []), currentExercise.variantId!].slice(-8) }));
    }
    if (current?.id) setOutcomeHistory((previous) => ({ ...previous, [current.id]: [...(previous[current.id] ?? []), verdict].slice(-5) }));
    setModeResults((prev) => {
      const previous = prev[mode] ?? { answered: 0, correct: 0, partial: 0, uncertain: 0, assisted: 0 };
      return {
        ...prev,
        [mode]: {
          answered: previous.answered + 1,
          correct: previous.correct + (verdict === "correct" ? 1 : 0),
          partial: (previous.partial ?? 0) + (verdict === "partial" ? 1 : 0),
          uncertain: (previous.uncertain ?? 0) + (verdict === "uncertain" ? 1 : 0),
          assisted: (previous.assisted ?? 0) + (assisted ? 1 : 0),
        },
      };
    });
  }, [current, currentExercise, user.uid, draftResponses]);

  const handleReportExercise = useCallback((reason: "multiple-correct" | "wrong-grade" | "poor-gap" | "unrelated-options" | "other") => {
    if (!current || !currentExercise?.variantId) return;
    if (currentExercise.presentationId) {
      setDraftResponses((previous) => {
        const next = { ...previous };
        delete next[currentExercise.presentationId!];
        return next;
      });
    }
    setReportedPresentations((previous) => new Set(previous).add(`${current.id}:${presentation}`));
    const variantId = currentExercise.variantId;
    setDraftResponses((previous) => ({ ...previous, [`retired:${variantId}`]: "1" }));
    setRestoredExercises((previous) => previous.filter((item) => item.variantId !== variantId));
    setStudyAssets((previous) => retireStudyAsset(previous, current.id, variantId));
    pinnedExerciseRef.current = null;
    void reportStudyVariant({ cardId: current.id, variantId, bundleVersion: currentExercise.markingSettings?.generatedStudy?.bundleVersion ?? 3, reason }).then(() => prepareRemainingAssets([current])).catch(() => {
      showError("That question was hidden, but Jami could not save the report just now.");
    });
  }, [current, currentExercise, presentation, showError, prepareRemainingAssets]);

  const handleRating = useCallback(
    (rating: CardRating, options: { requeueOnMiss?: boolean } = {}) => {
      if (!current) return;
      const presentationKey = presentationDraftKey({
        sessionId: sessionIdRef.current ?? "session",
        index,
        cardId: current.id,
        presentation,
      });
      const { commitId, persist } = resolvePresentationId({
        pinnedId: pinnedExerciseRef.current?.presentationId,
        exerciseId: currentExercise?.presentationId,
        stored: draftResponses[presentationKey],
        sessionId: sessionIdRef.current ?? "session",
        index,
        cardId: current.id,
        newId: () => crypto.randomUUID(),
      });
      if (persist) setDraftResponses((previous) => ({ ...previous, [presentationKey]: commitId }));
      /*
       * Counted once per presentation, never once per attempt to save it. A
       * failed save leaves the student pressing a rating again, and Smart Mix
       * counted every press -- inflating the summary and, worse, the recent
       * outcomes it picks the next mode from.
       */
      const countedKey = countedDraftKey(commitId);
      if (!currentExercise && studyModesEnabled && draftResponses[countedKey] !== "1") {
        setDraftResponses((previous) => ({ ...previous, [countedKey]: "1" }));
        recordModeAnswer("classic", isSuccessfulRating(rating) ? "correct" : "incorrect", false);
      }
      return commitReview({
        commitId,
        cardId: current.id,
        rating,
        answeredAt: Date.now(),
        requeueOnMiss: options.requeueOnMiss,
      });
    },
    [commitReview, current, currentExercise, draftResponses, index, presentation, recordModeAnswer, setDraftResponses, studyModesEnabled]
  );

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
            {
              label: "Give me a hint",
              prompt:
                "Give me one hint towards this without telling me the answer.",
            },
            {
              label: "I don't know",
              prompt:
                "I'm stuck on this. Walk me through how to work it out, step by step.",
            },
            {
              label: "Break it down",
              prompt: "What is this question actually asking? Break it down for me.",
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
      if (currentExercise) return;
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
  }, [current, currentExercise, flipped, handleFlip, savingRating, sessionKind]);

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

    cancelPreparation();
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

                  {studyModesEnabled ? (
                    <div className="mt-6">
                      <StudyModePicker policy={modePolicy} onChange={setModePolicy} />
                    </div>
                  ) : null}

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
                      className={`flex h-full flex-col ${focusedReviewOpen ? "xl:col-span-2" : ""}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                            Focused Review
                          </div>
                          <h3 className="mt-2 text-lg font-semibold text-text-primary">
                            Choose exactly what to practice
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-text-secondary">
                            Pick decks or Topics for a targeted session.
                          </p>
                        </div>
                        <Button
                          ref={focusedReviewToggleRef}
                          type="button"
                          variant="secondary"
                          size="sm"
                          aria-expanded={focusedReviewOpen}
                          aria-controls="focused-review-builder"
                          onClick={() =>
                            setFocusedReviewOpen((currentOpen) => !currentOpen)
                          }
                          className="w-full shrink-0 sm:w-auto"
                        >
                          {focusedReviewOpen
                            ? "Hide choices"
                            : hasCustomFilters
                              ? "Edit selection"
                              : "Choose decks or Topics"}
                        </Button>
                      </div>

                      {focusedReviewOpen ? (
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
                          modePicker={
                            studyModesEnabled ? (
                              <StudyModePicker
                                policy={modePolicy}
                                surface="focused"
                                // The builder's own step heading asks it.
                                hideLabel
                                onChange={setModePolicy}
                              />
                            ) : undefined
                          }
                          onClearFilters={clearCustomFilters}
                          onStart={handleCustomReviewClick}
                        />
                      ) : (
                        <>
                          <div
                            className="mt-4 text-sm font-medium text-text-muted"
                            aria-live="polite"
                          >
                            {hasCustomFilters
                              ? `${selectedDeckIds.length + selectedTopicIds.length} selected · ${customPreviewCards.length} cards`
                              : `${customPreviewCards.length} cards available`}
                          </div>
                          <div className="mt-auto pt-5">
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
                        </>
                      )}
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
                      {studyModesEnabled ? (
                        <div className="mt-5">
                          <StudyModePicker
                            policy={modePolicy}
                            surface="simple"
                            onChange={setModePolicy}
                          />
                        </div>
                      ) : null}
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
                  {Object.keys(modeResults).length > 0 ? (
                    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-sm">
                      <div className="text-center text-xs text-text-muted">By mode</div>
                      <div className="mt-2 grid gap-1.5 text-xs text-text-secondary">
                        {(Object.entries(modeResults) as Array<
                          [StudyMode, { answered: number; correct: number }]
                        >).map(([mode, result]) => (
                          <span
                            key={mode}
                            className="inline-flex items-center justify-between gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2.5 py-1"
                          >
                            <span>{STUDY_MODE_LABELS[mode]}</span>
                            <span className="font-semibold tabular-nums text-text-primary">
                              {result.correct}/{result.answered}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
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
                    userId={user.uid}
                    open={jamiAssistantOpen}
                    onOpenChange={setJamiAssistantOpen}
                    resetKey={current.id}
                    contextKey={`learn:${current.id}`}
                    contextLabel="Current flashcard"
                    historyContextLabel={`Flashcard · ${current.front.slice(0, 72)}`}
                    getContext={getLearnAssistantContext}
                    quickActions={learnAssistantQuickActions}
                    settingsFolderIds={
                      decks.find((deck) => deck.id === current.deckId)?.folderIds ?? []
                    }
                    emptyStateNote={
                      flipped
                        ? undefined
                        : "Jami cannot see this card's answer until you flip it, so it can nudge you towards it but never hand it over."
                    }
                  />
                  {pinnedExerciseRef.current?.recoveryNotice ? <p role="status" className="mx-auto max-w-xl text-center text-sm text-text-secondary">{pinnedExerciseRef.current.recoveryNotice}</p> : null}
                  {currentExercise ? (
                    <StudyExerciseStage
                      key={`${current.id}:${currentExercise.mode}:${currentExercise.cardContentHash}:${presentation}`}
                      card={preparedCurrent ?? current}
                      exercise={currentExercise}
                      viewState={readPresentationViewState(draftResponses[`state:${currentExercise.presentationId}`])}
                      onViewStateChange={(state) => setDraftResponses((previous) => ({ ...previous, [`state:${currentExercise.presentationId}`]: JSON.stringify(state) }))}
                      ratingScale={
                        sessionKind === "simple" ? "two-point" : "four-point"
                      }
                      savingRating={savingRating}
                      onCommit={(rating, options) => {
                        setRestoredExercises((previous) => previous.filter((item) => item.presentationId !== currentExercise.presentationId));
                        return handleRating(rating, options);
                      }}
                      onModeAnswered={recordModeAnswer}
                      onRevisitAfterHint={() => {
                        if (currentExercise.presentationId) {
                          setDraftResponses((previous) => {
                            const next = { ...previous };
                            delete next[currentExercise.presentationId!];
                            return next;
                          });
                        }
                        const used = draftResponses[`hint-revisit:${current.id}`] === "1";
                        setDraftResponses((previous) => ({ ...previous, [`hint-revisit:${current.id}`]: "1" }));
                        setRestoredExercises((previous) => previous.filter((item) => item.presentationId !== currentExercise.presentationId));
                        revisitAfterHint(current.id, used);
                      }}
                      onSemanticCheck={handleSemanticCheck}
                      onReportExercise={currentExercise.source === "cached-ai" && currentExercise.variantId ? handleReportExercise : undefined}
                      draftResponse={currentExercise.presentationId ? draftResponses[currentExercise.presentationId] : undefined}
                      onDraftChange={currentExercise.presentationId ? (response) => setDraftResponses((previous) => ({ ...previous, [currentExercise.presentationId!]: response })) : undefined}
                    />
                  ) : studyModesEnabled && modePolicy.kind === "fixed" && !getModeEligibility(preparedCurrent ?? current, modePolicy.mode, { seed: sessionSeedRef.current }).eligible ? (
                    <div className="study-flashcard-face mx-auto flex min-h-[16rem] w-full max-w-[62rem] flex-col items-center justify-center gap-5 rounded-2xl p-6 text-center sm:p-10">
                      <div className="max-w-lg space-y-2">
                        <h2 className="text-xl font-semibold text-text-primary">This card isn&apos;t ready for that mode</h2>
                        <p className="text-sm leading-relaxed text-text-secondary">Use Smart Mix for this session, or continue with the cards that are ready. Jami won&apos;t quietly turn it into a different exercise.</p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button type="button" onClick={() => setModePolicy({ kind: "smart" })}>Switch to Smart Mix</Button>
                        <Button type="button" variant="secondary" onClick={() => {
                          setSessionCards((previous) => [...previous.slice(0, index), ...previous.slice(index + 1)]);
                          pinnedExerciseRef.current = null;
                        }}>Continue available cards</Button>
                      </div>
                    </div>
                  ) : (
                    <StudyFlashcard
                      card={current}
                      flipped={flipped}
                      onReveal={handleFlip}
                      deckName={deckNamesById[current.deckId] ?? "Flashcard"}
                      deckColor={currentDeckColor.base}
                      topicNames={(current.topicIds ?? []).map(
                        (topicId) => topicNamesById[topicId] ?? "Topic"
                      )}
                    />
                  )}
              </section>
              {flipped && !currentExercise ? (
                <StudyRatingControls
                  scale={sessionKind === "simple" ? "two-point" : "four-point"}
                  savingRating={savingRating}
                  onRate={handleRating}
                />
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={exitSession} variant="secondary">End session</Button>
              </div>
            </div>
          ) : null}
        </>
      )}
      <StarRewardOverlay reward={starReward} onDone={handleStarRewardDone} />
      {preparation ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-surface-base)]/85 px-4 backdrop-blur-sm">
          <StudySessionPreparing
            prepared={preparation.prepared}
            total={preparation.total}
            onSkip={skipPreparation}
          />
        </div>
      ) : null}
    </AppPage>
  );
}
