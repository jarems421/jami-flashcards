"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useUser } from "@/lib/user-context";
import { getDecks, type Deck } from "@/services/decks";
import { db } from "@/services/firebase";
import { FirebaseError } from "firebase/app";
import {
  getActiveConstellation,
  type Constellation,
} from "@/lib/constellations";
import { ensureConstellationSetup } from "@/services/constellations";
import { normalizeDust, type DustParticle } from "@/lib/dust";
import { normalizeGoal } from "@/lib/goals";
import Refreshable, { RefreshIconButton } from "@/components/Refreshable";

type DeckDueCounts = Record<string, number>;
type DashboardFeedback = { type: "success" | "error"; message: string };

function computeStreak(dustParticles: DustParticle[]): number {
  if (dustParticles.length === 0) return 0;

  const daySet = new Set<string>();
  for (const p of dustParticles) {
    const d = new Date(p.createdAt);
    daySet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }

  let streak = 0;
  const now = new Date();
  // Check today first, then go backwards
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (daySet.has(key)) {
      streak++;
    } else {
      // Allow skipping today if no reviews yet
      if (i === 0) continue;
      break;
    }
  }
  return streak;
}

function countTodayReviews(dustParticles: DustParticle[]): number {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return dustParticles.filter((p) => p.createdAt >= startOfDay).length;
}

export default function DashboardHome() {
  const { user, refreshKey } = useUser();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [deckDueCounts, setDeckDueCounts] = useState<DeckDueCounts>({});
  const [activeGoalCount, setActiveGoalCount] = useState(0);
  const [activeConstellation, setActiveConstellation] = useState<Constellation | null>(null);
  const [dustParticles, setDustParticles] = useState<DustParticle[]>([]);
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

      const [constellations, goalsSnapshot, dustSnap] = await Promise.all([
        ensureConstellationSetup(uid).catch(() => [] as Constellation[]),
        getDocs(collection(db, "users", uid, "goals")).catch(() => null),
        getDocs(collection(db, "users", uid, "dust")).catch(() => null),
      ]);

      const active = getActiveConstellation(constellations);
      setActiveConstellation(active);

      const allDust = dustSnap
        ? dustSnap.docs.map((d) =>
            normalizeDust(d.id, d.data() as Record<string, unknown>)
          )
        : [];
      setDustParticles(allDust);

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
  }, [user.uid, loadAll, refreshKey]);

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

  const streak = useMemo(() => computeStreak(dustParticles), [dustParticles]);
  const todayReviews = useMemo(() => countTodayReviews(dustParticles), [dustParticles]);

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

  // Progress for the "Cards due" summary: reviewed / (reviewed + due)
  const reviewProgress = todayReviews > 0 || dueCount > 0
    ? Math.round((todayReviews / (todayReviews + dueCount)) * 100)
    : 0;

  return (
    <Refreshable onRefresh={handleRefresh}>
      <main
        data-app-surface="true"
        className="min-h-screen px-3 py-2 text-white sm:px-4 sm:py-3 md:px-6 md:py-4"
      >
        <div className="mx-auto max-w-3xl">
          {/* ── Header ── */}
          <div className="mb-3 flex items-center justify-between sm:mb-4">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">Dashboard</h1>
              {!isLoading && todayReviews > 0 ? (
                <span className="rounded-full bg-warm-glow px-2.5 py-0.5 text-xs font-semibold text-warm-accent">
                  {todayReviews} card{todayReviews === 1 ? "" : "s"} today
                </span>
              ) : null}
            </div>
            <RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />
          </div>

          {/* ── Streak ── */}
          {!isLoading && streak > 0 ? (
            <div className="mb-3 text-sm font-semibold text-warm-accent sm:mb-4">
              🔥 {streak} day{streak === 1 ? "" : "s"} streak
            </div>
          ) : null}

          {/* ── Feedback ── */}
          {feedback ? (
            <div
              className={`mb-3 flex items-center justify-between gap-4 rounded-xl p-2.5 text-sm sm:mb-4 sm:p-3 ${
                feedback.type === "error"
                  ? "bg-error-muted text-red-200"
                  : "bg-success-muted text-emerald-200"
              }`}
            >
              <div>{feedback.message}</div>
              <button
                onClick={() => setFeedback(null)}
                className="rounded-md bg-glass-medium px-3 py-1 text-xs hover:bg-glass-strong active:scale-[0.97]"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {/* ── Quick-study hero ── */}
          {!isLoading ? (
            <div
              className="mb-4 animate-slide-up rounded-xl border border-white/[0.07] p-3 sm:mb-5 sm:p-4"
              style={{ backgroundImage: "var(--gradient-card)" }}
            >
              {decks.length === 0 ? (
                <>
                  <h2 className="mb-1 text-lg font-bold">Get started</h2>
                  <p className="mb-3 text-sm text-text-secondary">
                    Create your first deck to start studying.
                  </p>
                  <Link
                    href="/dashboard/decks"
                    className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold transition duration-fast hover:bg-accent-hover active:scale-[0.97]"
                  >
                    Go to Decks
                  </Link>
                </>
              ) : mostDueDeck ? (
                <>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Ready to study
                  </div>
                  <h2 className="mb-1 text-lg font-bold">{mostDueDeck.deck.name}</h2>
                  <p className="mb-3 text-sm text-text-secondary">
                    {mostDueDeck.count} card{mostDueDeck.count === 1 ? "" : "s"} due — keep your streak going.
                  </p>
                  <Link
                    href={`/deck/${mostDueDeck.deck.id}/study`}
                    className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold transition duration-fast hover:bg-accent-hover active:scale-[0.97]"
                  >
                    Study now
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="mb-1 text-lg font-bold">All caught up!</h2>
                  <p className="text-sm text-text-secondary">
                    No cards are due right now. Add new cards or set a goal to keep progressing.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {/* ── Summary rail ── */}
          <div className="mb-4 grid animate-fade-in gap-2.5 grid-cols-1 sm:mb-5 sm:grid-cols-3 sm:gap-3">
            <Link
              href="/dashboard/decks"
              className="rounded-xl border border-white/[0.07] p-3 transition duration-fast hover:shadow-card active:scale-[0.98] sm:p-4"
              style={{ backgroundImage: "var(--gradient-card)" }}
            >
              <div className="mb-1 text-xs font-semibold text-text-muted">Cards due</div>
              <div className="text-2xl font-bold">
                {isLoading ? "…" : dueCount}
              </div>
              {!isLoading && (todayReviews > 0 || dueCount > 0) ? (
                <div className="mt-2 h-1.5 rounded-full bg-glass-medium">
                  <div
                    className="h-1.5 rounded-full bg-gradient-to-r from-accent to-success transition-all duration-slow"
                    style={{ width: `${reviewProgress}%` }}
                  />
                </div>
              ) : null}
            </Link>

            <Link
              href="/dashboard/goals"
              className="rounded-xl border border-warm-border p-3 transition duration-fast hover:shadow-card active:scale-[0.98] sm:p-4"
              style={{ backgroundImage: "var(--gradient-card)" }}
            >
              <div className="mb-1 text-xs font-semibold text-text-muted">Active goals</div>
              <div className="text-2xl font-bold">
                {isLoading ? "…" : activeGoalCount}
              </div>
            </Link>

            <Link
              href="/dashboard/constellation"
              className="rounded-xl border border-warm-border p-3 transition duration-fast hover:shadow-card active:scale-[0.98] sm:p-4"
              style={{ backgroundImage: "var(--gradient-card)" }}
            >
              <div className="mb-1 text-xs font-semibold text-text-muted">Constellation</div>
              {activeConstellation ? (
                <div className="text-sm font-semibold">{activeConstellation.name}</div>
              ) : (
                <div className="text-sm text-text-muted">None active</div>
              )}
            </Link>
          </div>
        </div>
      </main>
    </Refreshable>
  );
}
