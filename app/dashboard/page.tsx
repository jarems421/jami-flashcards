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
import { getCustomStudyHref } from "@/lib/app/routes";
import {
  countTodayReviews,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import { loadStudyActivity } from "@/services/study/activity";
import { mapCardData, type Card as StudyCard } from "@/lib/study/cards";
import { getWeakPoints, type WeakArea } from "@/lib/study/weak-points";
import { buildLearningInsights } from "@/lib/study/insights";
import { ensureDailyReviewState, ensureStudyStateSetup } from "@/services/study/daily-review";
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
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [remainingRequiredCards, setRemainingRequiredCards] = useState<StudyCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<DashboardFeedback | null>(null);
  const [weakAreas, setWeakAreas] = useState<WeakArea[]>([]);
  const lastForegroundRefreshAtRef = useRef(0);

  const loadAll = useCallback(async (uid: string) => {
    try {
      await ensureStudyStateSetup(uid);

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
      const allCards: StudyCard[] = [];
      for (const cardDoc of snapshot.docs) {
        const data = cardDoc.data();
        allCards.push(mapCardData(cardDoc.id, data as Record<string, unknown>));
      }

      const dailyReviewState = await ensureDailyReviewState(uid, allCards, now);
      const completedRequiredIds = new Set(dailyReviewState.completedRequiredCardIds);
      const parkedRequiredIds = new Set(dailyReviewState.parkedRequiredCardIds);
      const cardsById = new Map(allCards.map((card) => [card.id, card]));
      const requiredCards = dailyReviewState.requiredCardIds
        .map((cardId) => cardsById.get(cardId) ?? null)
        .filter((card): card is StudyCard => card !== null)
        .filter((card) => !completedRequiredIds.has(card.id) && !parkedRequiredIds.has(card.id));
      const nextDeckDueCounts: DeckDueCounts = {};
      for (const card of requiredCards) {
        nextDeckDueCounts[card.deckId] = (nextDeckDueCounts[card.deckId] ?? 0) + 1;
      }

      setDueCount(requiredCards.length);
      setDeckDueCounts(nextDeckDueCounts);
      setCards(allCards);
      setRemainingRequiredCards(requiredCards);

      const deckNamesById = Object.fromEntries(
        fetchedDecks.map((d) => [d.id, d.name]),
      );
      setWeakAreas(getWeakPoints(allCards, deckNamesById));

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
  const learningInsights = useMemo(
    () =>
      buildLearningInsights({
        cards,
        requiredCards: remainingRequiredCards,
        weakAreas,
      }),
    [cards, remainingRequiredCards, weakAreas]
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
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
                  Add a topic and write a few cards.
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
                  Ready to review
                </div>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  Start reviewing.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                  Daily first. Custom after.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href={getCustomStudyHref({ mode: "daily" })}
                    className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
                  >
                    Daily Review
                  </Link>
                  <Link
                    href={getCustomStudyHref({ mode: "custom" })}
                    className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
                  >
                    Custom Review
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
                  Custom Review is open.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href={getCustomStudyHref({ mode: "custom" })}
                    className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
                  >
                    Custom Review
                  </Link>
                  <Link
                    href="/dashboard/decks"
                    className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
                  >
                    Manage decks
                  </Link>
                </div>
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
                <div className="mt-1 text-3xl font-semibold">{isLoading ? "..." : todayReviews}</div>
              </div>
            </Card>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href={getCustomStudyHref({ mode: "daily" })}
            className="app-panel block p-6 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
          >
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Daily Review
            </div>
            <div className="mt-3 text-3xl font-semibold">{isLoading ? "..." : dueCount}</div>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Required cards left today.
            </p>
          </Link>

          <Link
            href="/dashboard/goals"
            className="app-panel-warm block p-6 transition duration-fast hover:-translate-y-0.5 hover:shadow-shell"
          >
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Active goals
            </div>
            <div className="mt-3 text-3xl font-semibold">{isLoading ? "..." : activeGoalCount}</div>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Active study targets.
            </p>
          </Link>
        </div>

        {!isLoading && learningInsights.length > 0 ? (
          <Card padding="lg">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Today&apos;s plan
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              What needs attention next.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              {learningInsights.map((insight) => (
                <div
                  key={insight.title}
                  className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4"
                >
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-muted">
                    {insight.eyebrow}
                  </div>
                  <div className="mt-2 text-base font-semibold text-white">
                    {insight.title}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">
                    {insight.description}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {!isLoading && weakAreas.length > 0 ? (
          <Card padding="lg">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Weak areas
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              Decks and tags causing the most friction.
            </p>
            <div className="mt-4 space-y-3">
              {weakAreas.map((area) => {
                const pct = Math.round((area.avgDifficulty / 10) * 100);
                const tierColor =
                  area.avgDifficulty >= 7
                    ? "bg-rose-500"
                    : area.avgDifficulty >= 4
                      ? "bg-amber-500"
                      : "bg-emerald-500";
                return (
                  <div key={`${area.kind}:${area.name}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-white">
                        {area.name}
                        <span className="ml-2 text-xs text-text-muted">
                          {area.cardCount} card{area.cardCount === 1 ? "" : "s"} - {area.totalLapses} lapse{area.totalLapses === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="text-xs text-text-muted">
                        {area.avgDifficulty.toFixed(1)}/10
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full rounded-full transition-all ${tierColor}`}
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}
      </AppPage>
    </Refreshable>
  );
}

