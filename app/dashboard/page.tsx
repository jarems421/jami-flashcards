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
import { getGoalAccuracy, normalizeGoal, type Goal } from "@/lib/study/goals";
import { getCustomStudyHref } from "@/lib/app/routes";
import {
  countTodayReviews,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import { loadStudyActivity } from "@/services/study/activity";
import { mapCardData, type Card as StudyCard } from "@/lib/study/cards";
import { ensureDailyReviewState, ensureStudyStateSetup } from "@/services/study/daily-review";
import AppPage from "@/components/layout/AppPage";
import { FeedbackBanner, PageHero, StatTile } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { loadInAppUsername } from "@/services/profile";
import { formatTimeRemaining } from "@/lib/study/time";

type DashboardFeedback = { type: "success" | "error"; message: string };
const URGENT_GOAL_WINDOW_MS = 48 * 60 * 60 * 1000;

type DashboardAction = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  label: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

function getGoalProgressPercent(goal: Goal) {
  if (goal.targetCards <= 0) return 0;
  return Math.min(100, Math.round((goal.progress.cardsCompleted / goal.targetCards) * 100));
}

function getUrgentGoal(goals: Goal[], now: number) {
  return goals
    .filter((goal) => goal.deadline > now && goal.deadline - now <= URGENT_GOAL_WINDOW_MS)
    .sort((left, right) => left.deadline - right.deadline)[0] ?? null;
}

export default function DashboardHome() {
  const { user } = useUser();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [remainingOptionalCount, setRemainingOptionalCount] = useState(0);
  const [urgentGoal, setUrgentGoal] = useState<Goal | null>(null);
  const [studyActivity, setStudyActivity] = useState<DailyStudyActivity[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<DashboardFeedback | null>(null);
  const [inAppUsername, setInAppUsername] = useState<string | null>(null);
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
      const username = await loadInAppUsername(uid).catch(() => null);
      setInAppUsername(username);

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
      const completedOptionalIds = new Set(dailyReviewState.completedOptionalCardIds);
      const optionalCards = dailyReviewState.optionalCardIds
        .map((cardId) => cardsById.get(cardId) ?? null)
        .filter((card): card is StudyCard => card !== null)
        .filter((card) => !completedOptionalIds.has(card.id));

      setDueCount(requiredCards.length);
      setRemainingOptionalCount(optionalCards.length);
      setCards(allCards);

      const [goalsSnapshot, activity] = await Promise.all([
        getDocs(collection(db, "users", uid, "goals")).catch(() => null),
        loadStudyActivity(uid).catch(() => [] as DailyStudyActivity[]),
      ]);

      setStudyActivity(activity);

      if (goalsSnapshot) {
        const now2 = Date.now();
        const activeGoals = goalsSnapshot.docs
          .map((d) => normalizeGoal(d.id, d.data() as Record<string, unknown>))
          .filter((goal) => goal.status === "active" && goal.deadline > now2);
        setUrgentGoal(getUrgentGoal(activeGoals, now2));
      } else {
        setUrgentGoal(null);
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
  const dashboardAction = useMemo<DashboardAction>(() => {
    if (decks.length === 0) {
      return {
        eyebrow: "Start here",
        title: "Create your first deck.",
        description: "Add one subject area first. After that, you can write cards and Jami will build your study path.",
        href: "/dashboard/decks",
        label: "Create a deck",
      };
    }

    if (cards.length === 0) {
      return {
        eyebrow: "Next step",
        title: "Add your first cards.",
        description: "Your decks are ready. Add a few questions and answers so Daily Review has something to schedule.",
        href: "/dashboard/cards",
        label: "Create cards",
        secondaryHref: "/dashboard/decks",
        secondaryLabel: "Manage decks",
      };
    }

    if (dueCount > 0) {
      return {
        eyebrow: "Daily first",
        title: `Clear ${dueCount} required card${dueCount === 1 ? "" : "s"}.`,
        description: "These are the cards most worth protecting today. Finish them to unlock free Custom Review.",
        href: getCustomStudyHref({ mode: "daily" }),
        label: "Start Daily Review",
        secondaryHref: "/dashboard/study",
        secondaryLabel: "View study modes",
      };
    }

    if (remainingOptionalCount > 0) {
      return {
        eyebrow: "Daily is clear",
        title: `${remainingOptionalCount} optional easy card${remainingOptionalCount === 1 ? "" : "s"} waiting.`,
        description: "You have done the required work. These are light extras if you want a little more practice.",
        href: "/dashboard/study",
        label: "Do optional easy",
        secondaryHref: getCustomStudyHref({ mode: "custom" }),
        secondaryLabel: "Start Custom Review",
      };
    }

    return {
      eyebrow: "Open practice",
      title: "Custom Review is open.",
      description: "Daily Review is clear. Choose any decks or tags and practise on your own terms.",
      href: getCustomStudyHref({ mode: "custom" }),
      label: "Start Custom Review",
      secondaryHref: "/dashboard/cards",
      secondaryLabel: "Manage cards",
    };
  }, [cards.length, decks.length, dueCount, remainingOptionalCount]);

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Dashboard"
        width="2xl"
        action={<RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />}
        contentClassName="space-y-4 sm:space-y-6"
      >
        {feedback ? (
          <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
        ) : null}

        <PageHero
          className="animate-slide-up"
          eyebrow={isLoading ? "Getting ready" : dashboardAction.eyebrow}
          title={isLoading ? "Checking today." : dashboardAction.title}
          description={
            <>
              <span className="mb-3 block text-sm text-text-secondary">
                {inAppUsername
                  ? `Welcome back, ${inAppUsername}.`
                  : "Welcome back. Let's keep it simple."}
              </span>
              {isLoading
                ? "Jami is loading your decks, cards, review queue, and goals."
                : dashboardAction.description}
            </>
          }
          action={
            <Link
              href={isLoading ? "/dashboard/study" : dashboardAction.href}
              className="inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
            >
              {isLoading ? "Open Study" : dashboardAction.label}
            </Link>
          }
          secondaryAction={
            !isLoading && dashboardAction.secondaryHref ? (
                <Link
                  href={dashboardAction.secondaryHref}
                  className="inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
                >
                  {dashboardAction.secondaryLabel}
                </Link>
            ) : null
          }
          aside={
            <div className="grid min-w-[14rem] gap-3 rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
              <div>
                <div className="text-xs text-text-muted">Reviewed today</div>
                <div className="mt-1 text-3xl font-bold text-white">{isLoading ? "..." : todayReviews}</div>
              </div>
              <div className="h-px bg-white/[0.08]" />
              <div>
                <div className="text-xs text-text-muted">Required left</div>
                <div className="mt-1 text-2xl font-bold text-white">{isLoading ? "..." : dueCount}</div>
              </div>
            </div>
          }
        />

        <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
          <StatTile
            label="Daily Review"
            value={isLoading ? "..." : dueCount}
            detail={dueCount > 0 ? "Required cards before Custom Review." : "Required queue is clear."}
            href="/dashboard/study"
          />
          <StatTile
            label="Library"
            value={isLoading ? "..." : cards.length}
            detail={`${decks.length} deck${decks.length === 1 ? "" : "s"} organised for study.`}
            href="/dashboard/cards"
          />
          {urgentGoal ? (
            <Link
              href="/dashboard/goals"
              className="app-panel-warm block p-4 transition duration-fast hover:-translate-y-0.5 hover:shadow-shell sm:p-5"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Goal due soon</div>
              <div className="mt-3 text-xl font-semibold tracking-tight text-white">
                {urgentGoal.progress.cardsCompleted} / {urgentGoal.targetCards} cards
              </div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                {formatTimeRemaining(urgentGoal.deadline)} left at {Math.round(getGoalAccuracy(urgentGoal.progress) * 100)}% accuracy.
              </p>
              <div className="mt-4 h-2 rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-warm-accent transition-all"
                  style={{ width: `${Math.max(getGoalProgressPercent(urgentGoal), 4)}%` }}
                />
              </div>
            </Link>
          ) : (
            <StatTile
              label="Custom Review"
              value={isLoading ? "..." : cards.length > 0 && dueCount === 0 ? "Open" : "After daily"}
              detail={cards.length === 0 ? "Add cards first." : dueCount > 0 ? "Unlocks after required review." : "Free practice is available."}
              href="/dashboard/study"
            />
          )}
        </div>
      </AppPage>
    </Refreshable>
  );
}

