"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { deleteField, doc, increment, updateDoc } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import {
  buildDailyReviewQueues,
  DAILY_REVIEW_MAX_WEAK_ATTEMPTS,
  DAILY_REVIEW_STATE_DOC_ID,
  getRemainingCarryoverRequiredCards,
  getRemainingFreshRequiredCards,
  sortCardsByStudyPriority,
  type DailyReviewState,
} from "@/lib/study/daily-review";
import { getMsUntilNextStudyBoundary, getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import { isStruggleRating, isSuccessfulRating, updateCardSchedule, type CardRating } from "@/lib/study/scheduler";
import type { Card } from "@/lib/study/cards";
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
  type StudySessionStats,
} from "@/lib/study/session";
import { ensureDailyReviewState, ensureStudyStateSetup, loadUserCards, markDailyReviewCardComplete, recordDailyReviewWeakAttempt } from "@/services/study/daily-review";
import { syncOfflineStudyReviews } from "@/services/study/offline";
import { closeRemoteStudySession, loadRemoteActiveStudySession, saveRemoteActiveStudySession } from "@/services/study/session";
import { applyGoalProgressForAnswer } from "@/services/study/goals";
import { recordStudyReview } from "@/services/study/activity";
import { getDecks, type Deck } from "@/services/study/decks";
import { getActiveTopics } from "@/services/study/topics";
import { getTopicNameKey, type Topic } from "@/lib/practice/topics";
import { featureFlags } from "@/lib/app/feature-flags";
import { getDeckColorPreset } from "@/lib/study/deck-style";
import StudyAssistant from "@/components/study/StudyAssistant";
import AppPage from "@/components/layout/AppPage";
import { Button, Card as SurfaceCard, EmptyState, FeedbackBanner, IconBubble, Input, PageHero, ProgressBar, Skeleton, StudyText } from "@/components/ui";

type SessionKind = StudySessionKind;
type SessionStats = StudySessionStats;
type DailyRequiredSessionScope = "all" | "carryover" | "fresh";
const RATING_LABELS: Record<CardRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
type AnswerFeedback = { tone: "error" | "warm" | "good" | "calm"; message: string };
type FocusedReviewRecents = {
  deckIds: string[];
  topicIds: string[];
  legacyTags?: string[];
};

const FOCUSED_REVIEW_RECENTS_PREFIX = "jami:focused-review-recents:";
const EMPTY_FOCUSED_REVIEW_RECENTS: FocusedReviewRecents = {
  deckIds: [],
  topicIds: [],
};
const FOCUSED_REVIEW_RECENT_LIMIT = 3;
const STUDY_FOREGROUND_REFRESH_THROTTLE_MS = 15_000;

const RATING_STYLES: Record<CardRating, { hint: string; shortcut: string; classes: string }> = {
  again: {
    hint: "Missed it",
    shortcut: "1",
    classes: "app-danger hover:border-border-strong",
  },
  hard: {
    hint: "Barely recalled",
    shortcut: "2",
    classes: "app-warning hover:border-border-strong",
  },
  good: {
    hint: "Recalled",
    shortcut: "3",
    classes: "app-chip hover:border-border-strong hover:bg-[var(--color-glass-medium)]",
  },
  easy: {
    hint: "Instant",
    shortcut: "4",
    classes: "app-success hover:border-border-strong",
  },
};

function getSessionLabel(kind: SessionKind | null) {
  if (kind === "simple") return "Simple Study";
  if (kind === "custom") return "Focused Review";
  if (kind === "daily-optional") return "Easy Extras";
  return "Daily Review";
}

function getAnswerFeedback(rating: CardRating, sessionKind: SessionKind, parked: boolean) {
  if (rating === "again") {
    return {
      tone: "error" as const,
      message: parked
        ? "Moved to tomorrow so you do not get stuck."
        : sessionKind === "daily-required"
          ? "Back in the queue for another try."
          : "We will bring this back tomorrow.",
    };
  }

  if (rating === "hard") {
    return {
      tone: "warm" as const,
      message: parked
        ? "Parked for tomorrow after a rough stretch."
        : sessionKind === "daily-required"
          ? "Back in the queue for one steadier pass."
          : "Worth another look tomorrow.",
    };
  }

  if (rating === "good") {
    return { tone: "good" as const, message: "Nice recall." };
  }

  return { tone: "good" as const, message: "That one felt easy." };
}

function getSimpleStudyFeedback(result: SimpleStudyResult) {
  return result === "correct"
    ? { tone: "good" as const, message: "Cleared from Simple Study." }
    : { tone: "warm" as const, message: "Moved to the back for another pass." };
}

function InlineStudyFeedback({ feedback }: { feedback: AnswerFeedback | null }) {
  if (!feedback) return null;

  const toneClass =
    feedback.tone === "error"
      ? "app-danger"
      : feedback.tone === "warm"
        ? "app-warning"
        : feedback.tone === "good"
          ? "app-success"
          : "app-chip";

  return (
    <div
      className={`mx-auto w-fit rounded-full border px-3.5 py-2 text-sm font-semibold shadow-[0_12px_24px_rgba(8,2,26,0.18)] animate-fade-in ${toneClass}`}
      role="status"
      aria-live="polite"
    >
      {feedback.message}
    </div>
  );
}

function parseIdsParam(value: string | null) {
  if (!value) return [];
  return Array.from(new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean)));
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function StepLabel({ step, children }: { step: number; children: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-text-muted">
      <IconBubble size="xs" shape="circle" className="app-chip font-semibold">
        {step}
      </IconBubble>
      <span>{children}</span>
    </div>
  );
}

function CountPill({ value, label }: { value: number; label: string }) {
  return (
    <div className="app-chip flex min-w-[7rem] flex-1 items-center justify-between gap-3 rounded-[1.2rem] px-3 py-2 sm:flex-none">
      <span className="text-xs leading-5 text-text-muted">{label}</span>
      <IconBubble size="sm" shape="circle" className="app-chip font-semibold text-text-primary">
        {value}
      </IconBubble>
    </div>
  );
}

function getCardsByIds(cards: Card[], ids: string[]) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  return ids.map((id) => cardsById.get(id) ?? null).filter((card): card is Card => card !== null);
}

function buildCustomReviewCards(cards: Card[], selectedDeckIds: string[], selectedTopicIds: string[]) {
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
            (card.topicIds ?? []).some((topicId) => selectedTopicIdSet.has(topicId));
          return matchesDeck || matchesTopic;
        });

  return sortCardsByStudyPriority(filteredCards);
}

function getFocusedReviewRecentsKey(userId: string) {
  return `${FOCUSED_REVIEW_RECENTS_PREFIX}${userId}`;
}

function normalizeFocusedReviewRecents(value: unknown): FocusedReviewRecents {
  if (!value || typeof value !== "object") {
    return EMPTY_FOCUSED_REVIEW_RECENTS;
  }

  const data = value as { deckIds?: unknown; topicIds?: unknown; tags?: unknown };
  return {
    deckIds: Array.isArray(data.deckIds)
      ? data.deckIds.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).slice(0, FOCUSED_REVIEW_RECENT_LIMIT)
      : [],
    topicIds: Array.isArray(data.topicIds)
      ? data.topicIds.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).slice(0, FOCUSED_REVIEW_RECENT_LIMIT)
      : [],
    ...(Array.isArray(data.tags)
      ? {
          legacyTags: data.tags
            .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
            .slice(0, FOCUSED_REVIEW_RECENT_LIMIT),
        }
      : {}),
  };
}

function mergeRecentValues(current: string[], nextValues: string[], getKey = (value: string) => value) {
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
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [dailyReviewState, setDailyReviewState] = useState<DailyReviewState | null>(null);
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>(requestedDeckIds);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>(requestedTopicIds);
  const [deckSearch, setDeckSearch] = useState("");
  const [topicSearch, setTopicSearch] = useState("");
  const [focusedReviewRecents, setFocusedReviewRecents] = useState<FocusedReviewRecents>(EMPTY_FOCUSED_REVIEW_RECENTS);
  const [sessionKind, setSessionKind] = useState<SessionKind | null>(null);
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [savingRating, setSavingRating] = useState<CardRating | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats>(createEmptySessionStats());
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [answerFeedback, setAnswerFeedback] = useState<AnswerFeedback | null>(null);
  const [countdownMs, setCountdownMs] = useState(getMsUntilNextStudyBoundary());
  const [showExplanation, setShowExplanation] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineSnapshotAt, setOfflineSnapshotAt] = useState<number | null>(null);
  const [pendingOfflineReviews, setPendingOfflineReviews] = useState(0);
  const [sessionRestoreReady, setSessionRestoreReady] = useState(false);
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
  const flashcardAiEnabled = featureFlags.enableFlashcardAi;

  useEffect(() => {
    setSelectedDeckIds(requestedDeckIds);
    setSelectedTopicIds(requestedTopicIds);
    setSessionKind(null);
    setSessionCards([]);
    setIndex(0);
    setFlipped(false);
    setShowExplanation(false);
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
  }, [requestedDeckIds, requestedMode, requestedTopicIds]);

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
  }, [user.uid]);

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
    [user.uid]
  );

  useEffect(() => {
    const interval = setInterval(() => setCountdownMs(getMsUntilNextStudyBoundary()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!answerFeedback) return;
    const timeout = window.setTimeout(() => setAnswerFeedback(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [answerFeedback]);

  const loadAll = useCallback(async (options: { keepSessionMounted?: boolean } = {}) => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    if (!options.keepSessionMounted) {
      setLoaded(false);
    }
    setFeedback(null);
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
        loadUserCards(user.uid),
        getActiveTopics(user.uid).catch(() => [] as Topic[]),
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
        setFeedback({ type: "success", message: "Still using your current study session. New data will refresh when the connection settles." });
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
        setFeedback({ type: "success", message: "Using your offline study cache. Answers will sync when you are back online." });
      } else {
        setDecks([]);
        setCards([]);
        setTopics([]);
        setDailyReviewState(null);
        setFeedback({ type: "error", message: "Failed to load your study queue." });
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoaded(true);
      }
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, user.uid]);

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
  }, [requestedLegacyTags, requestedTopicIds, topics]);

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
  }, [focusedReviewRecents, topics, user.uid]);

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
  }, [loadAll, user.uid]);

  const refreshPendingOfflineReviews = useCallback(() => {
    setPendingOfflineReviews(getOfflineQueuedReviews(user.uid).length);
  }, [user.uid]);

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
      setFeedback({
        type: "success",
        message: `Synced ${result.synced} offline review${result.synced === 1 ? "" : "s"}.`,
      });
      if (latestPersistedSessionRef.current) {
        return;
      }
      await loadAll({ keepSessionMounted: true });
    }
  }, [loadAll, user.uid]);

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
  }, [refreshPendingOfflineReviews, syncPendingOfflineReviews]);

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
  const simpleStudyStatusText =
    simpleStudyQueue.cards.length > 0
      ? `${simpleStudyQueue.newCount} new · ${simpleStudyQueue.wrongCount} missed`
      : "All clear";
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
    setSelectedDeckIds((prev) =>
      prev.includes(deckId)
        ? prev.filter((currentId) => currentId !== deckId)
        : [...prev, deckId]
    );
    setFeedback(null);
  }, []);

  const toggleTopicFilter = useCallback((topicId: string) => {
    setSelectedTopicIds((prev) =>
      prev.includes(topicId)
        ? prev.filter((currentTopicId) => currentTopicId !== topicId)
        : [...prev, topicId]
    );
    setFeedback(null);
  }, []);

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
      setShowExplanation(false);
      setAnswerFeedback(null);
      setFeedback(null);
      savePersistedStudySession(nextSession);
      void saveRemoteActiveStudySession(nextSession).catch((error) => {
        console.warn("Failed to save active study session.", error);
      });

      if (kind === "custom") {
        pushFocusedReviewRecents(selectedDeckIds, selectedTopicIds);
      }
    },
    [customPreviewCards, pushFocusedReviewRecents, remainingCarryoverRequiredCards, remainingFreshRequiredCards, remainingOptionalCards, remainingRequiredCards, selectedDeckIds, selectedTopicIds, simpleStudyQueue.cards, user.uid]
  );

  const handleCustomReviewClick = useCallback(() => {
    if (!hasCards) {
      setFeedback({
        type: "error",
        message: "Create at least one card first, then Focused Review will be ready.",
      });
      return;
    }

    if (customPreviewCards.length === 0) {
      setFeedback({
        type: "error",
        message: hasCustomFilters
          ? "No cards match those filters. Clear them or choose a different deck or Topic."
          : "Add cards first, then Focused Review will be ready.",
      });
      return;
    }

    startSession("custom");
  }, [customPreviewCards.length, hasCards, hasCustomFilters, startSession]);

  const clearCustomFilters = useCallback(() => {
    setSelectedDeckIds([]);
    setSelectedTopicIds([]);
    setFeedback(null);
  }, []);

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
      setShowExplanation(false);
      setAnswerFeedback(null);
      setFeedback(null);

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
  }, [cards, dailyReviewState, loaded, requestedDeckIds, requestedMode, requestedTopicIds, topics, user.uid]);

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
    setShowExplanation(false);
  };

  const requeueCurrentCard = (nextCard: Card) => {
    setSessionCards((prev) => {
      const before = prev.slice(0, index);
      const after = prev.slice(index + 1);
      return [...before, ...after, nextCard];
    });
    setFlipped(false);
    setShowExplanation(false);
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
    setFeedback({ type: "success", message: "Saved offline. This answer will sync when you are back online." });

    if (sessionKind === "daily-required" && isStruggle && retryResult && !retryResult.parked) {
      requeueCurrentCard(nextCard);
    } else if (isStruggle && sessionKind !== "daily-required" && flashcardAiEnabled) {
      setShowExplanation(true);
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
    setFeedback(null);

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
    setShowExplanation(false);

    try {
      await updateDoc(doc(db, "cards", current.id), {
        simpleStudyLastResult: result,
        simpleStudyLastReviewedAt: now,
        ...(result === "correct"
          ? { simpleStudyCorrectCount: increment(1) }
          : { simpleStudyWrongCount: increment(1) }),
      });
    } catch (error) {
      console.warn("Failed to save Simple Study result.", error);
      setOfflineMode(true);
      setFeedback({
        type: "success",
        message: "Kept this Simple Study answer in your current session. It will refresh when your connection settles.",
      });
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
    setFeedback(null);
    try {
      if (offlineMode || (typeof navigator !== "undefined" && !navigator.onLine)) {
        await handleOfflineRating(rating);
        return;
      }

      const now = Date.now();
      const isCorrect = isSuccessfulRating(rating);
      const isStruggle = isStruggleRating(rating);
      const schedule = sessionKind === "custom" ? null : updateCardSchedule(current, rating);
      const cardUpdates: Record<string, unknown> = {};
      if (schedule) {
        Object.assign(cardUpdates, schedule);
        if (isCorrect) {
          cardUpdates.memoryRiskOverrideDayKey = deleteField();
        }
      } else if (isStruggle) {
        const studyDayKey = getStudyDayKey(now);
        cardUpdates.lastStruggleAt = now;
        cardUpdates.lastStruggleStudyDayKey = studyDayKey;
        cardUpdates.memoryRiskOverrideDayKey = shiftStudyDayKey(studyDayKey, 1);
        cardUpdates.customStruggleCount = increment(1);
      }
      if (isStruggle) {
        cardUpdates.simpleStudyLastResult = "wrong";
        cardUpdates.simpleStudyLastReviewedAt = now;
        cardUpdates.simpleStudyWrongCount = increment(1);
      }

      const reviewPromise = recordStudyReview(user.uid, now, {
        isCorrect,
        durationMs: flipTimestampRef.current > 0 ? now - flipTimestampRef.current : undefined,
        sessionKind: sessionKind === "custom" ? "custom" : "daily",
      });
      const goalProgressPromise = applyGoalProgressForAnswer(user.uid, isCorrect, now);
      const remainingPromises: Promise<unknown>[] = [];
      if (Object.keys(cardUpdates).length > 0) remainingPromises.push(updateDoc(doc(db, "cards", current.id), cardUpdates));
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
        await updateDoc(doc(db, "cards", current.id), parkedRiskUpdates);
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
      setAnswerFeedback(getAnswerFeedback(rating, sessionKind, Boolean(retryResult?.parked)));
      if (sessionKind === "daily-required" && isStruggle && retryResult && !retryResult.parked) {
        requeueCurrentCard(nextCard);
      } else if (isStruggle && sessionKind !== "daily-required" && flashcardAiEnabled) {
        setShowExplanation(true);
      } else {
        goNext();
      }
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to save that answer. Please try again." });
    } finally {
      setSavingRating(null);
    }
  };

  const handleFlip = useCallback(() => {
    if (!current || flipped) return;
    flipTimestampRef.current = Date.now();
    setFlipped(true);
  }, [current, flipped]);

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
    setShowExplanation(false);
    setAnswerFeedback(null);
  };

  return (
    <AppPage title="Study" backHref="/dashboard" backLabel="Today" width="study" contentClassName="space-y-4 sm:space-y-6">
      {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}
      {offlineMode || pendingOfflineReviews > 0 ? (
        <div className="rounded-[1.5rem] border border-warm-border bg-warm-glow p-4 text-sm text-text-secondary">
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
              <PageHero
                eyebrow="Study"
                title={
                  hasCarryoverRequiredCards
                    ? "Finish yesterday's review first."
                    : remainingRequiredCards.length > 0
                    ? "Your next review is ready."
                    : hasCards
                      ? "Choose how you want to study."
                      : "Start with your first cards."
                }
                description={
                  hasCarryoverRequiredCards
                    ? "Finish unfinished priority cards or start today's fresh set."
                    : remainingRequiredCards.length > 0
                    ? "Daily Review has priority cards ready."
                    : hasCards
                      ? "Daily Review is clear for now."
                      : "Add cards to start studying."
                }
                aside={
                  <div className="rounded-[1.5rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-center text-sm text-text-secondary">
                    <div className="text-xs text-text-muted">Next reset</div>
                    <div className="mt-1 flex min-h-6 items-center justify-center text-base font-medium leading-none tabular-nums text-text-primary">
                      {formatCountdown(countdownMs)}
                    </div>
                  </div>
                }
              />
              {!hasCards ? (
                <EmptyState
                  emoji="Cards"
                  eyebrow="Start here"
                  title="Create a few cards first"
                  description="Add cards to unlock review."
                  action={<Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover">Create cards</Link>}
                  secondaryAction={<Link href="/dashboard/decks" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition duration-fast hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)]">Open decks</Link>}
                />
              ) : null}
              {hasCards ? (
                <div className="grid gap-3">
                  <SurfaceCard padding="md" className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StepLabel step={1}>Daily Review</StepLabel>
                          {remainingRequiredCards.length + remainingOptionalCards.length === 0 ? (
                            <span className="app-success rounded-full px-2.5 py-1 text-xs font-medium">
                              All clear
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-3 text-sm leading-6 text-text-secondary">
                          Review priority cards first, then choose optional easy extras.
                        </p>
                        {hasCarryoverRequiredCards ? (
                          <div className="mt-2 text-sm font-medium text-warm-accent">
                            Unfinished from last Daily Review: {remainingCarryoverRequiredCards.length}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                        {hasCarryoverRequiredCards ? (
                          <CountPill value={remainingCarryoverRequiredCards.length} label="Unfinished" />
                        ) : null}
                        <CountPill value={remainingFreshRequiredCards.length} label={hasCarryoverRequiredCards ? "Today" : "Needs attention"} />
                        <CountPill value={remainingOptionalCards.length} label="Easy extras" />
                      </div>
                    </div>
                    <div className={`grid gap-3 ${hasCarryoverRequiredCards ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                      {hasCarryoverRequiredCards ? (
                        <div className="space-y-1.5">
                          <Button type="button" onClick={() => startSession("daily-required", "carryover")} variant="warm" size="md" className="w-full justify-center">
                            Finish unfinished cards
                          </Button>
                          <div className="text-center text-xs leading-5 text-text-muted">Carried over from last Daily Review</div>
                        </div>
                      ) : null}
                      <div className="space-y-1.5">
                        <Button type="button" onClick={() => startSession("daily-required", hasCarryoverRequiredCards ? "fresh" : "all")} disabled={(hasCarryoverRequiredCards ? remainingFreshRequiredCards.length : remainingRequiredCards.length) === 0} variant={hasCarryoverRequiredCards ? "secondary" : "warm"} size="md" className="w-full justify-center">
                          {hasCarryoverRequiredCards
                            ? remainingFreshRequiredCards.length > 0
                              ? "Start today's priority cards"
                              : "No fresh priority cards"
                            : remainingRequiredCards.length > 0
                              ? "Review priority cards"
                              : "No priority cards"}
                        </Button>
                        <div className="text-center text-xs leading-5 text-text-muted">Most likely to slip today</div>
                      </div>
                      <div className="space-y-1.5">
                        <Button type="button" onClick={() => startSession("daily-optional")} disabled={remainingOptionalCards.length === 0} variant="secondary" size="md" className="w-full justify-center">
                          {remainingOptionalCards.length > 0 ? "Review easy extras" : "No easy extras"}
                        </Button>
                        <div className="text-center text-xs leading-5 text-text-muted">Lighter reps if you want more today</div>
                      </div>
                    </div>
                  </SurfaceCard>
                </div>
              ) : null}
              {hasCards ? (
                <SurfaceCard padding="lg" className="relative space-y-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-2xl">
                      <StepLabel step={2}>Focused Review</StepLabel>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-text-primary sm:text-xl">
                        Build a focused session
                      </h3>
                      <p className="mt-2 text-sm leading-7 text-text-secondary sm:text-base">
                        Choose decks or Topics.
                      </p>
                    </div>
                    <Button type="button" onClick={handleCustomReviewClick} disabled={customPreviewCards.length === 0} size="lg" className="w-full sm:w-auto">
                      Start Focused Review
                    </Button>
                  </div>
                  {hasCustomFilters ? (
                    <div className="grid gap-3 rounded-[1.25rem] border border-accent/20 bg-accent/10 p-3 md:grid-cols-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                        Selected decks
                      </div>
                      <div className="flex flex-wrap gap-2 md:col-start-1">
                        {selectedDeckIds.length > 0 ? (
                          selectedDeckIds.map((deckId) => (
                            <button
                              key={deckId}
                              type="button"
                              onClick={() => toggleDeckFilter(deckId)}
                              className="app-selected rounded-full px-3 py-1.5 text-xs font-medium transition duration-fast hover:border-border-strong"
                            >
                              {deckNamesById[deckId] ?? "Deck"} · {deckCardCounts.get(deckId) ?? 0} cards x
                            </button>
                          ))
                        ) : (
                          <span className="text-xs leading-5 text-text-muted">No deck filter selected.</span>
                        )}
                      </div>
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted md:col-start-2 md:row-start-1">
                        Selected Topics
                      </div>
                      <div className="flex flex-wrap gap-2 md:col-start-2">
                        {selectedTopicIds.length > 0 ? (
                          selectedTopicIds.map((topicId) => (
                            <button
                              key={topicId}
                              type="button"
                              onClick={() => toggleTopicFilter(topicId)}
                              className="app-selected rounded-full px-3 py-1.5 text-xs font-medium transition duration-fast hover:border-border-strong"
                            >
                              {topicNamesById[topicId] ?? "Topic"} · {topicCardCounts.get(topicId) ?? 0} cards x
                            </button>
                          ))
                        ) : (
                          <span className="text-xs leading-5 text-text-muted">No Topic filter selected.</span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                      <Input
                        label="Search decks"
                        placeholder="Type a deck name"
                        value={deckSearch}
                        onChange={(event) => setDeckSearch(event.target.value)}
                      />
                      <div className="mt-3 min-h-12 space-y-2">
                        {deckSearch.trim() ? (
                          deckSearchResults.length > 0 ? (
                            deckSearchResults.map((deck) => {
                              const selected = selectedDeckIds.includes(deck.id);
                              return (
                                <button
                                  key={deck.id}
                                  type="button"
                                  onClick={() => toggleDeckFilter(deck.id)}
                                  className={`flex w-full items-center justify-between gap-3 rounded-[1rem] px-3 py-2 text-left text-sm transition duration-fast ${selected ? "app-selected" : "app-chip hover:border-border-strong"}`}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate">{deck.name}</span>
                                    <span className="mt-0.5 block text-xs text-text-muted">{deckCardCounts.get(deck.id) ?? 0} cards</span>
                                  </span>
                                  <span className="shrink-0 text-xs text-text-muted">{selected ? "Selected" : "Add"}</span>
                                </button>
                              );
                            })
                          ) : (
                            <p className="rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2 text-sm text-text-muted">
                              No decks match that search.
                            </p>
                          )
                        ) : (
                          <p className="rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2 text-sm text-text-muted">
                            Start typing to find a deck.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                      <Input
                        label="Search Topics"
                        placeholder="Type a Topic name"
                        value={topicSearch}
                        onChange={(event) => setTopicSearch(event.target.value)}
                      />
                      <div className="mt-3 min-h-12 space-y-2">
                        {topicSearch.trim() ? (
                          topicSearchResults.length > 0 ? (
                            topicSearchResults.map((topic) => {
                              const selected = selectedTopicIds.includes(topic.id);
                              return (
                                <button
                                  key={topic.id}
                                  type="button"
                                  onClick={() => toggleTopicFilter(topic.id)}
                                  className={`flex w-full items-center justify-between gap-3 rounded-[1rem] px-3 py-2 text-left text-sm transition duration-fast ${selected ? "app-selected" : "app-chip hover:border-border-strong"}`}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate">{topic.name}</span>
                                    <span className="mt-0.5 block text-xs text-text-muted">{topicCardCounts.get(topic.id) ?? 0} cards</span>
                                  </span>
                                  <span className="shrink-0 text-xs text-text-muted">{selected ? "Selected" : "Add"}</span>
                                </button>
                              );
                            })
                          ) : (
                            <p className="rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2 text-sm text-text-muted">
                              No Topics match that search.
                            </p>
                          )
                        ) : (
                          <p className="rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2 text-sm text-text-muted">
                            Start typing to find a Topic.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                      <div className="mb-3 text-sm font-medium text-text-primary">Recent decks</div>
                      {recentDecks.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {recentDecks.map((deck) => {
                            const selected = selectedDeckIds.includes(deck.id);
                            return (
                              <button
                                key={deck.id}
                                type="button"
                                onClick={() => toggleDeckFilter(deck.id)}
                                className={`min-h-11 rounded-full px-4 py-2 text-left text-sm font-medium shadow-[var(--shadow-shell)] transition duration-fast hover:-translate-y-[1px] hover:border-border-strong active:translate-y-0 active:scale-[0.98] ${selected ? "app-button-primary" : "app-selected"}`}
                                aria-pressed={selected}
                              >
                                {deck.name} · {deckCardCounts.get(deck.id) ?? 0} cards
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm leading-6 text-text-muted">
                          Start a focused session and your recent decks will appear here.
                        </p>
                      )}
                    </div>
                    <div className="rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                      <div className="mb-3 text-sm font-medium text-text-primary">Recent Topics</div>
                      {recentTopics.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {recentTopics.map((topic) => {
                            const selected = selectedTopicIds.includes(topic.id);
                            return (
                              <button
                                key={topic.id}
                                type="button"
                                onClick={() => toggleTopicFilter(topic.id)}
                                className={`min-h-11 rounded-full px-4 py-2 text-left text-sm font-medium shadow-[var(--shadow-shell)] transition duration-fast hover:-translate-y-[1px] hover:border-border-strong active:translate-y-0 active:scale-[0.98] ${selected ? "app-button-primary" : "app-selected"}`}
                                aria-pressed={selected}
                              >
                                {topic.name} · {topicCardCounts.get(topic.id) ?? 0} cards
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm leading-6 text-text-muted">
                          Topics from focused sessions will collect here.
                        </p>
                      )}
                    </div>
                  </div>
                  {customSelectionEmpty ? (
                    <EmptyState
                      variant="compact"
                      align="left"
                      emoji="Search"
                      title="No cards match these filters"
                      description={hasCustomFilters ? "Your selected decks and Topics do not currently match any cards. Clear them or try a different combination." : "There are no cards available for Focused Review yet."}
                      action={hasCustomFilters ? <Button type="button" variant="secondary" onClick={clearCustomFilters}>Clear filters</Button> : undefined}
                      secondaryAction={<Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition duration-fast hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)]">Edit cards</Link>}
                    />
                  ) : null}
                </SurfaceCard>
              ) : null}
              {hasCards ? (
                <SurfaceCard padding="md" className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StepLabel step={3}>Simple Study</StepLabel>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${simpleStudyQueue.cards.length > 0 ? "app-chip" : "app-success"}`}>
                          {simpleStudyStatusText}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-text-secondary">
                        Clear new and missed cards with a quick correct-or-wrong pass.
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => startSession("simple")}
                      disabled={simpleStudyQueue.cards.length === 0}
                      variant="secondary"
                      size="md"
                      className="w-full justify-center lg:w-auto"
                    >
                      {simpleStudyQueue.cards.length > 0 ? "Start Simple Study" : "No Simple Study cards"}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <CountPill value={simpleStudyQueue.newCount} label="New" />
                    <CountPill value={simpleStudyQueue.wrongCount} label="Missed" />
                  </div>
                </SurfaceCard>
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
                secondaryAction={sessionKind === "custom" ? <Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition duration-fast hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)]">Edit cards</Link> : undefined}
              />
            ) : (
              <SurfaceCard tone="warm" padding="lg" className="animate-warm-glow-pulse">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Session complete</div>
                    <h2 className="mt-3 text-xl font-medium leading-tight tracking-tight text-text-primary sm:text-2xl">Good work.</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                      {sessionKind === "simple"
                        ? `You cleared Simple Study after ${sessionStats.reviewedCards} answer${sessionStats.reviewedCards === 1 ? "" : "s"}. Your next best step is ready below.`
                        : `You reviewed ${sessionStats.reviewedCards} of ${totalCards} card${totalCards === 1 ? "" : "s"}. Your next best step is ready below.`}
                    </p>
                  </div>
                  <div className="rounded-[1.4rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm text-text-secondary">
                    <span className="text-sm font-semibold text-text-primary">{accuracyPercentage}%</span> accuracy
                  </div>
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Reviewed</div>
                    <div className="mt-2 flex min-h-7 items-center justify-center text-lg font-semibold leading-none tabular-nums text-text-primary">{sessionStats.reviewedCards}</div>
                  </div>
                  <div className="rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-sm">
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
                  <div className="rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Goals completed</div>
                    <div className="mt-2 flex min-h-7 items-center justify-center text-lg font-semibold leading-none tabular-nums text-text-primary">{sessionStats.completedGoals}</div>
                  </div>
                  <div className="rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Rewards</div>
                    <div className="mt-2 text-sm text-text-secondary"><span className="font-semibold tabular-nums text-text-primary">{sessionStats.starsEarned}</span> star{sessionStats.starsEarned === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="mt-6 rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
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
                    <Link href="/dashboard/constellation" className="inline-flex min-h-[3.25rem] items-center justify-center rounded-[2rem] border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-5 py-3 text-base font-medium text-[#10091d] shadow-[0_12px_24px_rgba(255,214,246,0.18)] transition duration-fast hover:-translate-y-[1px] hover:brightness-105">View constellation</Link>
                  ) : (
                    <Link href="/dashboard/cards" className="inline-flex min-h-[3.25rem] items-center justify-center rounded-[2rem] border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-5 py-3 text-base font-medium text-[#10091d] shadow-[0_12px_24px_rgba(255,214,246,0.18)] transition duration-fast hover:-translate-y-[1px] hover:brightness-105">Edit cards</Link>
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
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-muted">{getSessionLabel(sessionKind)}</div>
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1.5 text-sm leading-none text-text-secondary">
                        <span className="font-semibold tabular-nums text-text-primary">{remainingCards}</span>
                        <span className="text-text-muted">/</span>
                        <span className="tabular-nums">{totalCards}</span>
                        <span>cards remaining</span>
                      </div>
                    </div>
                    <div className="min-w-0 lg:min-w-[12rem]">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-text-muted">
                        <span>Progress</span>
                        <span className="tabular-nums">{progressPercent}%</span>
                      </div>
                      <ProgressBar progress={progressPercent} />
                    </div>
                  </div>
                  <div className="study-flashcard-shell mx-auto w-full max-w-[62rem] cursor-pointer rounded-[2rem] perspective-[1400px]" onClick={!flipped ? handleFlip : undefined} onKeyDown={(event) => { if (flipped) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleFlip(); } }} role="button" tabIndex={0} aria-label={flipped ? "Flashcard answer shown" : "Flip flashcard"}>
                    <div className={`relative aspect-[5/4] w-full transition-transform duration-slow ease-standard [transform-style:preserve-3d] sm:aspect-[16/10] xl:aspect-[16/9] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
                      <div
                        className="study-flashcard-face study-flashcard-face-front absolute inset-0 flex flex-col rounded-[2rem] p-5 [backface-visibility:hidden] sm:p-8 lg:p-10"
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
                                <span key={topicId} className="rounded-full border border-current/15 bg-current/[0.05] px-2.5 py-1 text-[0.68rem] font-medium opacity-75">
                                  {topicNamesById[topicId] ?? "Topic"}
                                </span>
                              ))}
                              {(current.topicIds?.length ?? 0) > 2 ? (
                                <span className="rounded-full border border-current/15 bg-current/[0.05] px-2.5 py-1 text-[0.68rem] font-medium opacity-65">+{(current.topicIds?.length ?? 0) - 2}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-1 items-center justify-center py-6">
                          <StudyText
                            as="p"
                            text={current.front}
                            className="max-w-4xl whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-[color:inherit] sm:text-2xl xl:text-[2.15rem]"
                          />
                        </div>
                        <div className="text-center text-xs font-medium opacity-60">Tap anywhere on the card or press Space to reveal</div>
                      </div>
                      <div
                        className="study-flashcard-face study-flashcard-face-back absolute inset-0 flex flex-col rounded-[2rem] p-5 [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8 lg:p-10"
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
                            className="max-w-4xl whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-[color:inherit] sm:text-2xl xl:text-[2.15rem]"
                          />
                        </div>
                        <div className="text-center text-xs font-medium opacity-60">How well did you recall this?</div>
                      </div>
                    </div>
                  </div>
              </section>
              {!flipped ? (
                <div className="animate-fade-in space-y-3">
                  {flashcardAiEnabled ? (
                    <StudyAssistant
                      card={current}
                      autoExplain={false}
                      mode="clue"
                      deckName={deckNamesById[current.deckId]}
                      topicNames={(current.topicIds ?? [])
                        .map((topicId) => topicNamesById[topicId])
                        .filter((name): name is string => Boolean(name))}
                      onContinue={goNext}
                    />
                  ) : null}
                </div>
              ) : null}
              {flipped ? (
                <div className="sticky bottom-3 z-30 animate-fade-in space-y-3 rounded-[1.5rem] border border-[var(--color-border)] bg-surface-panel/95 p-2 shadow-[0_18px_36px_rgba(8,2,26,0.28)] backdrop-blur-md sm:static sm:z-auto sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0">
                  {savingRating ? <div className="text-center text-sm text-text-muted">Saving...</div> : null}
                  {showExplanation && flashcardAiEnabled ? (
                    <StudyAssistant
                      card={current}
                      autoExplain
                      mode="review"
                      deckName={deckNamesById[current.deckId]}
                      topicNames={(current.topicIds ?? [])
                        .map((topicId) => topicNamesById[topicId])
                        .filter((name): name is string => Boolean(name))}
                      onContinue={goNext}
                    />
                  ) : (
                    <div className="space-y-3">
                      {sessionKind === "simple" ? (
                        <div className="grid grid-cols-2 gap-2 sm:gap-3" aria-label="Simple Study answer choices">
                          <button
                            type="button"
                            aria-label="Missed this card"
                            disabled={savingRating !== null}
                            className="flex min-h-[5.2rem] flex-col items-center justify-center gap-1.5 rounded-[1.35rem] border border-rose-300/25 bg-rose-400/[0.08] px-3 py-4 text-center text-base font-semibold text-rose-100 shadow-[0_10px_20px_rgba(8,2,26,0.12)] transition duration-fast ease-spring hover:-translate-y-[0.5px] hover:border-rose-200/45 hover:bg-rose-400/[0.12] active:scale-[0.985] disabled:saturate-[0.82] disabled:brightness-95 sm:min-h-[4.6rem] sm:px-4 sm:py-3.5 sm:text-sm"
                            onClick={() => void handleSimpleStudyResult("wrong")}
                          >
                            <span>Missed</span>
                            <span className="text-[0.7rem] font-normal opacity-75">Back of queue</span>
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 px-2 text-[0.68rem] leading-none tabular-nums opacity-75">1</span>
                          </button>
                          <button
                            type="button"
                            aria-label="Got this card right"
                            disabled={savingRating !== null}
                            className="flex min-h-[5.2rem] flex-col items-center justify-center gap-1.5 rounded-[1.35rem] border border-emerald-300/25 bg-emerald-400/[0.08] px-3 py-4 text-center text-base font-semibold text-emerald-100 shadow-[0_10px_20px_rgba(8,2,26,0.12)] transition duration-fast ease-spring hover:-translate-y-[0.5px] hover:border-emerald-200/45 hover:bg-emerald-400/[0.12] active:scale-[0.985] disabled:saturate-[0.82] disabled:brightness-95 sm:min-h-[4.6rem] sm:px-4 sm:py-3.5 sm:text-sm"
                            onClick={() => void handleSimpleStudyResult("correct")}
                          >
                            <span>Got it</span>
                            <span className="text-[0.7rem] font-normal opacity-75">Clear card</span>
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 px-2 text-[0.68rem] leading-none tabular-nums opacity-75">2</span>
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
                              className={`flex min-h-[5.2rem] flex-col items-center justify-center gap-1.5 rounded-[1.35rem] border px-3 py-4 text-center text-base font-semibold shadow-[0_10px_20px_rgba(8,2,26,0.12)] transition duration-fast ease-spring hover:-translate-y-[0.5px] active:scale-[0.985] disabled:saturate-[0.82] disabled:brightness-95 sm:min-h-[4.6rem] sm:px-4 sm:py-3.5 sm:text-sm ${meta.classes}`}
                              onClick={() => void handleRating(rating)}
                            >
                              <span>{RATING_LABELS[rating]}</span>
                              <span className="text-[0.7rem] font-normal opacity-75">{meta.hint}</span>
                              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/10 px-2 text-[0.68rem] leading-none tabular-nums opacity-75">{meta.shortcut}</span>
                            </button>
                            );
                          })}
                        </div>
                      )}
                      {flashcardAiEnabled ? (
                        <StudyAssistant
                          card={current}
                          autoExplain={false}
                          mode="review"
                          deckName={deckNamesById[current.deckId]}
                          topicNames={(current.topicIds ?? [])
                            .map((topicId) => topicNamesById[topicId])
                            .filter((name): name is string => Boolean(name))}
                          onContinue={goNext}
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={exitSession} variant="secondary">End session</Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </AppPage>
  );
}
