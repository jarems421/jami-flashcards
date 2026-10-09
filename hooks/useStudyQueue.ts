"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useStudyDataState } from "@/hooks/useStudyWorkspaceState";
import type { Topic } from "@/lib/material/topics";
import {
  buildDailyReviewQueues,
  DAILY_REVIEW_STATE_DOC_ID,
  planDailyReviewState,
  sortCardsByStudyPriority,
} from "@/lib/study/daily-review";
import { getStudyDayKey } from "@/lib/study/day";
import { getStuckOfflineReviews } from "@/lib/study/offline-study";
import { keepOfflineStudySnapshot, readOfflineStudySnapshot } from "@/services/study/offline-study-snapshot";
import { keepCardPicturesForOffline } from "@/services/study/card-images";
import { loadUserCards, peekUserCards } from "@/services/study/cards";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import { ensureDailyReviewState, ensureStudyStateSetup, loadDailyReviewState } from "@/services/study/daily-review";
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
 * Loaded once on opening and again whenever the page asks. While the server's
 * cards are on their way, `previewing` says the page holds a first look drawn
 * from this device's own, to show but not to study from. A failed load falls
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
  const [previewing, setPreviewing] = useState(false);

  const loadAll = useCallback(async (options: StudyQueueLoadOptions = {}) => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    if (!options.keepSessionMounted) {
      setLoaded(false);
      setPreviewing(false);
    }
    clearFeedback();
    /** Once the load itself has an answer, good or bad, a first look landing late is not drawn. */
    let settled = false;
    try {
      /*
       * Everything Learn reads starts at once. Setup used to be awaited first,
       * and the constellation's -- every star the student has, read to backfill
       * old ones -- cost a slow connection over a second before a card was
       * asked for. It has nothing to do with what Learn shows: it runs beside
       * it, and the starry background asks for it on every page anyway.
       */
      void ensureConstellationSetup(userId).catch((error) => {
        console.warn("Non-blocking constellation setup failed.", error);
      });
      const studySetup = ensureStudyStateSetup(userId).catch((error) => {
        console.warn("Non-blocking study state setup failed.", error);
      });

      const now = Date.now();
      const activeSessionPromise = loadRemoteActiveStudySession(userId, getStudyDayKey(now), now).catch((error) => {
        console.warn("Failed to load remote active study session before daily review refresh.", error);
        return { session: null, foundRemoteSession: false };
      });
      // Today's stored Daily Review does not depend on the cards, so it is read beside them.
      const storedDailyReviewPromise = loadDailyReviewState(userId);
      const decksPromise = getDecks(userId);
      const topicsPromise = getActiveTopics(userId).catch((error) => {
        console.error("Failed to load Topics for Learn filters.", error);
        showError("Topics are temporarily unavailable. Your card session is still usable.");
        return [] as Topic[];
      });
      const freshCardsPromise = loadUserCards(userId, { force: true });

      /*
       * A first look, drawn from the cards this device already holds.
       *
       * The server's set is the slow read on a large account -- five thousand
       * cards are a few megabytes -- and every other read Learn makes is small.
       * So once those land, the page is drawn from the device's cards while the
       * server's are still on their way. It is a look only: `loaded` stays
       * false, so nothing is graded, saved or resumed from it, and a session
       * asked for in the meantime starts on the server's cards.
       */
      if (!options.keepSessionMounted) {
        void Promise.all([peekUserCards(userId), decksPromise, topicsPromise, activeSessionPromise, storedDailyReviewPromise])
          .then(([heldCards, previewDecks, previewTopics, activeSessionResult, storedDailyReview]) => {
            // No cards held is no first look: an empty Learn would only flash by.
            if (!heldCards?.length || settled || requestId !== loadRequestIdRef.current) return;
            const previewCards = sortCardsByStudyPriority(heldCards, now);
            setDecks(previewDecks);
            setCards(previewCards);
            setTopics(previewTopics);
            setDailyReviewState(
              planDailyReviewState(storedDailyReview, previewCards, now, activeSessionResult.session).state
            );
            setPreviewing(true);
          })
          // The first look is only ever extra: the load below reports its own failures.
          .catch(() => undefined);
      }

      const [nextDecks, nextCards, nextTopics, activeSessionResult, storedDailyReview] = await Promise.all([
        decksPromise,
        freshCardsPromise,
        topicsPromise,
        activeSessionPromise,
        storedDailyReviewPromise,
      ]);
      const sortedCards = sortCardsByStudyPriority(nextCards, now);
      // Whatever setup migrates is settled before Daily Review is written.
      await studySetup;
      const nextDailyReviewState = await ensureDailyReviewState(userId, sortedCards, now, {
        activeSession: activeSessionResult.session,
        existingState: storedDailyReview,
      });
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      settled = true;
      setDecks(nextDecks);
      setCards(sortedCards);
      setTopics(nextTopics);
      setDailyReviewState(nextDailyReviewState);
      keepOfflineStudySnapshot(userId, { cards: sortedCards, decks: nextDecks });
      // Their pictures too, once the page has settled: diagram cards are no use offline without them.
      window.setTimeout(() => keepCardPicturesForOffline(sortedCards), 4_000);
      setOfflineMode(false);
      setOfflineSnapshotAt(Date.now());
    } catch (error) {
      settled = true;
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

      const snapshot = await readOfflineStudySnapshot(userId);
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

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
        setPreviewing(false);
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

  return { ...data, previewing, loadAll };
}
