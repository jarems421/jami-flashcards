"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { StudyQueueLoadOptions } from "@/hooks/useStudyQueue";
import { getOfflineQueuedReviews, getStuckOfflineReviews } from "@/lib/study/offline-study";
import { loadClosedStudySessionTombstone, markClosedStudySessionTombstoneSynced } from "@/lib/study/session";
import { syncOfflineStudyReviews } from "@/services/study/offline";
import { closeRemoteStudySession } from "@/services/study/session";

/** How soon returning to the tab may refresh the queue again. */
const FOREGROUND_REFRESH_THROTTLE_MS = 15_000;
/** How often a session retries a send that did not land, on its own. */
const OFFLINE_SYNC_RETRY_MS = 15_000;

/**
 * Keeps Learn in step with the server while it stays open.
 *
 * Coming back to the tab refreshes the queue, unless a session is on screen.
 * A session closed while the server could not be reached is told to it again.
 * And answers saved on this device while offline are sent as soon as there is
 * a connection, then retried on a clock of their own.
 */
export function useStudyBackgroundSync({
  userId,
  loadAll,
  hasOpenSession,
  setOfflineMode,
  setPendingOfflineReviews,
}: {
  userId: string;
  loadAll: (options?: StudyQueueLoadOptions) => Promise<void>;
  hasOpenSession: () => boolean;
  setOfflineMode: Dispatch<SetStateAction<boolean>>;
  setPendingOfflineReviews: Dispatch<SetStateAction<number>>;
}) {
  const lastForegroundRefreshAtRef = useRef(0);

  useEffect(() => {
    const retryClosedSessionSync = () => {
      const tombstone = loadClosedStudySessionTombstone(userId);
      if (!tombstone?.retryRemoteClose) {
        return;
      }

      void closeRemoteStudySession(userId, tombstone.session, tombstone.status, tombstone.reason)
        .then((saved) => {
          if (saved) {
            markClosedStudySessionTombstoneSynced(userId);
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
      setPendingOfflineReviews(getStuckOfflineReviews(userId).length);
      retryClosedSessionSync();

      if (hasOpenSession()) {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundRefreshAtRef.current < FOREGROUND_REFRESH_THROTTLE_MS) {
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
  }, [hasOpenSession, loadAll, setOfflineMode, setPendingOfflineReviews, userId]);

  /**
   * Count only the answers that have stopped moving.
   *
   * Every answer passes through the device queue on its way up, so counting the
   * queue counted normal saving and put a sync notice on screen for a student
   * whose session was working perfectly. What is worth showing is an answer
   * that has been sitting there past the point where a send should have
   * finished.
   */
  const refreshPendingOfflineReviews = useCallback(() => {
    setPendingOfflineReviews(getStuckOfflineReviews(userId).length);
  }, [setPendingOfflineReviews, userId]);

  const syncPendingOfflineReviews = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setOfflineMode(true);
      return;
    }

    const pending = getOfflineQueuedReviews(userId).length;
    if (pending === 0) {
      setPendingOfflineReviews(0);
      return;
    }

    const result = await syncOfflineStudyReviews(userId);
    refreshPendingOfflineReviews();

    if (result.synced > 0) {
      if (hasOpenSession()) {
        return;
      }
      await loadAll({ keepSessionMounted: true });
    }
  }, [hasOpenSession, loadAll, refreshPendingOfflineReviews, setOfflineMode, setPendingOfflineReviews, userId]);

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

    /*
     * Keep trying, quietly.
     *
     * A send that failed mid-session used to wait for the next answer, the next
     * focus or a button. None of those happen for a student reading the card
     * they are stuck on, so the retry runs on its own clock -- and the same
     * tick moves an answer into the stuck count once it has sat long enough,
     * which is what puts the notice on screen at all.
     */
    const retry = window.setInterval(() => {
      refreshPendingOfflineReviews();
      if (typeof navigator === "undefined" || navigator.onLine) {
        void syncPendingOfflineReviews();
      }
    }, OFFLINE_SYNC_RETRY_MS);

    return () => {
      window.clearInterval(retry);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshPendingOfflineReviews, setOfflineMode, syncPendingOfflineReviews]);

  return { refreshPendingOfflineReviews, syncPendingOfflineReviews };
}
