"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { getDecks, type Deck } from "@/services/study/decks";
import { db } from "@/services/firebase/client";
import { FirebaseError } from "firebase/app";
import { normalizeGoal } from "@/lib/study/goals";
import { getDeckStudyHref } from "@/lib/app/routes";
import {
  countTodayReviews,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import { loadStudyActivity } from "@/services/study/activity";
import AppPage from "@/components/layout/AppPage";
import { Card, FeedbackBanner } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";

type DeckDueCounts = Record<string, number>;
type DashboardFeedback = { type: "success" | "error"; message: string };

export default function DashboardHome() {
  const { user } = useUser();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [deckDueCounts, setDeckDueCounts] = useState<DeckDueCounts>({});
  const [activeGoalCount, setActiveGoalCount] = useState(0);
  const [studyActivity, setStudyActivity] = useState<DailyStudyActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<DashboardFeedback | null>(null);
  const lastForegroundRefreshAtRef = useRef(0);

  const loadAll = useCallback(async (uid: string) => {
    try {
      const [fetchedDecks] = await Promise.all([
        getDecks(uid).catch((e) => {
          console.error(e);
          const code = e instanceof FirebaseError ? e.code : undefined;
          setFeedback({
            type: "error",
            message: code ? `Failed to load decks (${code}).` : "Failed to load decks.",
          });
          return [] as Deck[];
        }),
      ]);

      setDecks(fetchedDecks);

      const cardsQuery = query(
        collection(db, "cards"),
        where("userId", "==", uid)
      );
      const snapshot = await getDocs(cardsQuery);
      const now = Date.now();
      const nextDeckDueCounts: DeckDueCounts = {};
      let count = 0;
      for (const cardDoc of snapshot.docs) {
        const data = cardDoc.data();
        const dueDate = data.dueDate;
        const deckId =
          typeof data.deckId === "string" && data.deckId.trim() ? data.deckId : null;
        const isDue = typeof dueDate !== "number" || dueDate <= now;
        if (isDue) {
          count++;
          if (deckId) {
            nextDeckDueCounts[deckId] = (nextDeckDueCounts[deckId] ?? 0) + 1;
          }
        }
      }
      setDueCount(count);
      setDeckDueCounts(nextDeckDueCounts);

      const [goalsSnapshot, activity] = await Promise.all([
        getDocs(collection(db, "users", uid, "goals")).catch(() => null),
        loadStudyActivity(uid).catch(() => [] as DailyStudyActivity[]),
      ]);

      setStudyActivity(activity);

      if (goalsSnapshot) {
        const now2 = Date.now();
        const activeGoals = goalsSnapshot.docs.filter((d) => {
          const goal = normalizeGoal(d.id, d.data() as Record<string, unknown>);
          return goal.status === "active" && goal.deadline > now2;
        });
        setActiveGoalCount(activeGoals.length);
      } else {
        setActiveGoalCount(0);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void loadAll(user.uid);
  }, [user.uid, loadAll]);

  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "hidden" &&
        now - lastForegroundRefreshAtRef.current > 15_000
      ) {
        lastForegroundRefreshAtRef.current = now;
        void loadAll(user.uid);
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [user.uid, loadAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setFeedback(null);
    try {
      await loadAll(user.uid);
    } finally {
      setRefreshing(false);
    }
  }, [user.uid, loadAll]);

  const todayReviews = useMemo(
    () => countTodayReviews(studyActivity),
    [studyActivity]
  );

  // Find the deck with the most due cards for the quick-study hero
  const mostDueDeck = useMemo(() => {
    let best: Deck | null = null;
    let bestCount = 0;
    for (const deck of decks) {
      const c = deckDueCounts[deck.id] ?? 0;
      if (c > bestCount) {
        best = deck;
        bestCount = c;
      }
    }
    return best ? { deck: best, count: bestCount } : null;
  }, [decks, deckDueCounts]);

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Dashboard"
        width="2xl"
        action={<RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />}
        contentClassName="space-y-6"
      >
        {feedback ? (
          <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_320px]">
          <Card className="animate-slide-up overflow-hidden" padding="lg">
            {!isLoading && decks.length === 0 ? (
              <>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Start here
                </div>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  Build your first deck.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                  Add a topic, write a few cards, and let Jami turn repetition into a steady study rhythm.
                </p>
                <Link
                  href="/dashboard/decks"
                  className="mt-8 inline-flex min-h-[3rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
                >
                  Create a deck
                </Link>
              </>
            ) : !isLoading && mostDueDeck ? (
              <>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Ready to study
                </div>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  {mostDueDeck.deck.name}
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                  {mostDueDeck.count} card{mostDueDeck.count === 1 ? "" : "s"} are ready now. Keep the rhythm going while the session is fresh.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href={getDeckStudyHref(mostDueDeck.deck.id)}
                    className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
                  >
                    Study now
                  </Link>
                  <Link
                    href="/dashboard/decks"
                    className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
                  >
                    View decks
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Today looks clear
                </div>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  You are caught up.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                  Nothing is due right now. Add cards, set a goal, or revisit a deck on your own schedule.
                </p>
              </>
            )}
          </Card>

          <div className="grid gap-4">
            <Card tone="warm" padding="md">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                Today
              </div>
              <div className="mt-3">
                <div className="text-xs text-text-muted">Cards reviewed</div>
                <div className="mt-1 text-3xl font-semibold">{isLoading ? "…" : todayReviews}</div>
              </div>
            </Card>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/dashboard/decks"
            className="app-panel block p-6 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
          >
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Cards due
            </div>
            <div className="mt-3 text-3xl font-semibold">{isLoading ? "…" : dueCount}</div>
          </Link>

          <Link
            href="/dashboard/goals"
            className="app-panel-warm block p-6 transition duration-fast hover:-translate-y-0.5 hover:shadow-shell"
          >
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Active goals
            </div>
            <div className="mt-3 text-3xl font-semibold">{isLoading ? "…" : activeGoalCount}</div>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Keep your targets visible and let each finished session feed the reward loop.
            </p>
          </Link>
        </div>
      </AppPage>
    </Refreshable>
  );
}

