"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useStudyDataState } from "@/hooks/useStudyWorkspaceState";
import type { Topic } from "@/lib/material/topics";
import { buildDailyReviewQueues, DAILY_REVIEW_STATE_DOC_ID, sortCardsByStudyPriority } from "@/lib/study/daily-review";
import { getStudyDayKey } from "@/lib/study/day";
import { getStuckOfflineReviews, loadOfflineStudySnapshot, saveOfflineStudySnapshot } from "@/lib/study/offline-study";
import { keepCardPicturesForOffline } from "@/services/study/card-images";
import { loadUserCards } from "@/services/study/cards";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import { ensureDailyReviewState, ensureStudyStateSetup } from "@/services/study/daily-review";
import { getDecks } from "@/services/study/decks";
import { loadRemoteActiveStudySession } from "@/services/study/session";
import { getActiveTopics } from "@/services/study/topics";

export type StudyQueueLoadOptions = {
  /**
   * Refresh behind a session already on screen rather than replacing the page
   * with a loading state. A failed refresh then keeps the session going.
   */
  keepSessionMounted?: boolean;
};

/**
 * Everything Learn studies from: decks, cards, Topics and today's Daily Review.
 *
 * Loaded once on opening and again whenever the page asks. A failed load falls
 * back to the snapshot this device keeps of the last good one, so a student
 * who loses their connection can carry on studying what they had.
 */
export function useStudyQueue({
  userId,
  hasOpenSession,
  setOfflineMode,
  setOfflineSnapshotAt,
  setPendingOfflineReviews,
  clearFeedback,
  showError,
  success,
}: {
  userId: string;
  /** Whether a session is on screen and saving. */
  hasOpenSession: () => boolean;
  setOfflineMode: Dispatch<SetStateAction<boolean>>;
  setOfflineSnapshotAt: Dispatch<SetStateAction<number | null>>;
  setPendingOfflineReviews: Dispatch<SetStateAction<number>>;
  clearFeedback: () => void;
  showError: (message: string) => void;
  success: (message: string) => void;
}) {
  const data = useStudyDataState();
  const { setCards, setDailyReviewState, setDecks, setLoaded, setTopics } = data;
  const loadRequestIdRef = useRef(0);

  const loadAll = useCallback(async (options: StudyQueueLoadOptions = {}) => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    if (!options.keepSessionMounted) {
      setLoaded(false);
    }
    clearFeedback();
    try {
      const setupResults = await Promise.allSettled([
        ensureStudyStateSetup(userId),
        ensureConstellationSetup(userId),
      ]);

      setupResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const label = index === 0 ? "study state" : "constellation";
          console.warn(`Non-blocking ${label} setup failed.`, result.reason);
        }
      });

      const now = Date.now();
      const activeSessionPromise = loadRemoteActiveStudySession(userId, getStudyDayKey(now), now).catch((error) => {
        console.warn("Failed to load remote active study session before daily review refresh.", error);
        return { session: null, foundRemoteSession: false };
      });
      const [nextDecks, nextCards, nextTopics, activeSessionResult] = await Promise.all([
        getDecks(userId),
        loadUserCards(userId, { force: true }),
        getActiveTopics(userId).catch((error) => {
          console.error("Failed to load Topics for Learn filters.", error);
          showError("Topics are temporarily unavailable. Your card session is still usable.");
          return [] as Topic[];
        }),
        activeSessionPromise,
      ]);
      const sortedCards = sortCardsByStudyPriority(nextCards, now);
      const nextDailyReviewState = await ensureDailyReviewState(userId, sortedCards, now, {
        activeSession: activeSessionResult.session,
      });
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      setDecks(nextDecks);
      setCards(sortedCards);
      setTopics(nextTopics);
      setDailyReviewState(nextDailyReviewState);
      saveOfflineStudySnapshot(userId, { cards: sortedCards, decks: nextDecks });
      // Their pictures too, once the page has settled: diagram cards are no use offline without them.
      window.setTimeout(() => keepCardPicturesForOffline(sortedCards), 4_000);
      setOfflineMode(false);
      setOfflineSnapshotAt(Date.now());
    } catch (error) {
      console.error(error);
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      if (options.keepSessionMounted && hasOpenSession()) {
        setOfflineMode(true);
        setPendingOfflineReviews(getStuckOfflineReviews(userId).length);
        success("Still using your current study session. New data will refresh when the connection settles.");
        return;
      }

      const snapshot = loadOfflineStudySnapshot(userId);

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
    hasOpenSession,
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
    userId,
  ]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return { ...data, loadAll };
}
