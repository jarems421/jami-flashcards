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
import { predictStudyStreak } from "@/lib/study/streak-prediction";
import { loadStudyActivity } from "@/services/study/activity";
import { getAttempts, getActiveQuestions } from "@/services/study/practice";
import { getGeneratedContentDrafts } from "@/services/study/generated-content";
import { mapCardData, type Card as StudyCard } from "@/lib/study/cards";
import { ensureDailyReviewState, ensureStudyStateSetup } from "@/services/study/daily-review";
import { loadRemoteActiveStudySession } from "@/services/study/session";
import AppPage from "@/components/layout/AppPage";
import { Card, FeedbackBanner, PageHero, SectionHeader, StatTile } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { loadInAppUsername } from "@/services/profile";
import { formatTimeRemaining } from "@/lib/study/time";
import { getStudyDayKey } from "@/lib/study/day";
import { StreakPredictionPanel } from "@/components/stats/AnalyticsPanels";

type DashboardFeedback = { type: "success" | "error"; message: string };
const URGENT_GOAL_WINDOW_MS = 48 * 60 * 60 * 1000;
const GETTING_STARTED_DISMISSED_KEY = "jami:getting-started-complete-dismissed";
const PROGRESS_VISITED_KEY = "jami:progress-visited";

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

type ChecklistItem = {
  label: string;
  detail: string;
  href: string;
  done: boolean;
};

function GettingStartedChecklist({
  items,
  isLoading,
}: {
  items: ChecklistItem[];
  isLoading: boolean;
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(GETTING_STARTED_DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const allDone = !isLoading && items.length > 0 && items.every((item) => item.done);
  const showComplete = allDone && !dismissed;

  useEffect(() => {
    if (!showComplete) return;

    const timeoutId = window.setTimeout(() => {
      setDismissed(true);
      try {
        sessionStorage.setItem(GETTING_STARTED_DISMISSED_KEY, "true");
      } catch {
        // Non-critical.
      }
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [showComplete]);

  if (allDone && dismissed) return null;

  if (showComplete) {
    return (
      <Card tone="warm" padding="lg" className="animate-reward-pulse">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Getting started complete
            </div>
            <div className="mt-2 text-xl font-semibold text-white">
              The starter loop is ready.
            </div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Jami will keep the core loop visible above, but this setup checklist can step out of
              the way now.
            </p>
          </div>
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-warm-border bg-warm-glow">
            <span className="h-8 w-8 rounded-full bg-warm-accent shadow-[0_0_28px_rgba(255,214,246,0.35)]" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Getting started"
        title="Set up the first learning loop."
        description="Finish these once, then this card disappears and the dashboard stays focused on what to do next."
      />
      <div className="mt-5 space-y-2">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-start gap-3 rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-3 transition duration-fast hover:border-white/[0.16] hover:bg-white/[0.06]"
          >
            <span
              aria-label={item.done ? "Complete" : "Incomplete"}
              className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border transition ${
                item.done
                  ? "border-warm-border bg-warm-accent shadow-[0_0_18px_rgba(255,214,246,0.28)]"
                  : "border-white/[0.16] bg-white/[0.035]"
              }`}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-text-muted">{item.detail}</span>
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function DashboardHome() {
  const { user } = useUser();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [remainingOptionalCount, setRemainingOptionalCount] = useState(0);
  const [urgentGoal, setUrgentGoal] = useState<Goal | null>(null);
  const [studyActivity, setStudyActivity] = useState<DailyStudyActivity[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [practiceQuestionCount, setPracticeQuestionCount] = useState(0);
  const [tutorHelpCount, setTutorHelpCount] = useState(0);
  const [progressVisited, setProgressVisited] = useState(false);
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

      const activeSessionResult = await loadRemoteActiveStudySession(
        uid,
        getStudyDayKey(now),
        now
      ).catch((error) => {
        console.warn("Failed to load active study session for dashboard counts.", error);
        return { session: null, foundRemoteSession: false };
      });
      const dailyReviewState = await ensureDailyReviewState(uid, allCards, now, {
        activeSession: activeSessionResult.session,
      });
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

      const [goalsSnapshot, activity, questions, attempts, drafts] = await Promise.all([
        getDocs(collection(db, "users", uid, "goals")).catch(() => null),
        loadStudyActivity(uid).catch(() => [] as DailyStudyActivity[]),
        getActiveQuestions(uid).catch(() => []),
        getAttempts(uid).catch(() => []),
        getGeneratedContentDrafts(uid).catch(() => []),
      ]);

      setStudyActivity(activity);
      setPracticeQuestionCount(questions.length);
      setTutorHelpCount(
        attempts.filter((attempt) => attempt.tutorUsed || (attempt.hintsUsed ?? 0) > 0).length +
          drafts.filter((draft) => draft.kind === "flashcard").length
      );

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
    try {
      setProgressVisited(localStorage.getItem(PROGRESS_VISITED_KEY) === "true");
    } catch {
      setProgressVisited(false);
    }
  }, []);

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
  const streakPrediction = useMemo(
    () => predictStudyStreak(cards, studyActivity),
    [cards, studyActivity]
  );
  const gettingStartedItems = useMemo<ChecklistItem[]>(
    () => [
      {
        label: "Create your first deck",
        detail: "Decks are groups of flashcards.",
        href: "/dashboard/decks",
        done: decks.length > 0,
      },
      {
        label: "Add 5 flashcards",
        detail: "Give Learn enough material to schedule reviews.",
        href: "/dashboard/cards",
        done: cards.length >= 5,
      },
      {
        label: "Review your cards",
        detail: "Complete at least one study action in Learn.",
        href: "/dashboard/study",
        done: todayReviews > 0,
      },
      {
        label: "Create a practice question",
        detail: "Practise turns memory into application.",
        href: "/dashboard/practise",
        done: practiceQuestionCount > 0,
      },
      {
        label: "Ask Tutor for a hint or make a draft",
        detail: "Use Tutor when stuck, then save useful mistakes.",
        href: "/dashboard/practise",
        done: tutorHelpCount > 0,
      },
      {
        label: "Check Progress",
        detail: "See weak topics and the next repair action.",
        href: "/dashboard/progress",
        done: progressVisited,
      },
    ],
    [cards.length, decks.length, practiceQuestionCount, progressVisited, todayReviews, tutorHelpCount]
  );
  const dashboardAction = useMemo<DashboardAction>(() => {
    if (decks.length === 0) {
      return {
        eyebrow: "Start here",
        title: "Create your first deck.",
        description: "Start with one subject, module, or exam. Once it exists, you can add cards and let Jami shape the review flow.",
        href: "/dashboard/decks",
        label: "Create a deck",
      };
    }

    if (cards.length === 0) {
      return {
        eyebrow: "Next step",
        title: "Add your first cards.",
        description: "Your deck is ready. Add a few prompts and answers so Daily Review has something real to work with.",
        href: "/dashboard/cards",
        label: "Create cards",
        secondaryHref: "/dashboard/decks",
        secondaryLabel: "Open decks",
      };
    }

    if (dueCount > 0) {
      return {
        eyebrow: "Recommended today",
        title: `${dueCount} card${dueCount === 1 ? "" : "s"} need attention today.`,
        description: "Start with Daily Review, then use Focused Review if you want a targeted session afterwards.",
        href: getCustomStudyHref({ mode: "daily" }),
        label: "Start Daily Review",
        secondaryHref: getCustomStudyHref({ mode: "custom" }),
        secondaryLabel: "Start Focused Review",
      };
    }

    if (remainingOptionalCount > 0) {
      return {
        eyebrow: "Daily is clear",
        title: `${remainingOptionalCount} easy card${remainingOptionalCount === 1 ? "" : "s"} left if you want extra reps.`,
        description: "Your main queue is clear. These are lighter passes if you want a little more practice today.",
        href: getCustomStudyHref({ mode: "daily" }),
        label: "Review easy extras",
        secondaryHref: getCustomStudyHref({ mode: "custom" }),
        secondaryLabel: "Start Focused Review",
      };
    }

    return {
      eyebrow: "Focused practice",
      title: "Focused Review is open.",
      description: "Daily Review is clear. Pick any deck or tag and practise the area you want to sharpen.",
      href: getCustomStudyHref({ mode: "custom" }),
      label: "Start Focused Review",
      secondaryHref: "/dashboard/cards",
      secondaryLabel: "Edit cards",
    };
  }, [cards.length, decks.length, dueCount, remainingOptionalCount]);

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Today"
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
          title={isLoading ? "Getting today ready." : dashboardAction.title}
          description={
            <>
              <span className="mb-3 block text-sm text-text-secondary">
                {inAppUsername
                  ? `Welcome back, ${inAppUsername}.`
                  : "Welcome back. Here is today at a glance."}
              </span>
              {isLoading
                ? "Jami is loading today's review queue, cards, and goals."
                : dashboardAction.description}
            </>
          }
          action={
            <Link
              href={isLoading ? "/dashboard/study" : dashboardAction.href}
              className="inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
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
                <div className="mt-1 text-xl font-medium text-white sm:text-2xl">{isLoading ? "..." : todayReviews}</div>
              </div>
              <div className="h-px bg-white/[0.08]" />
              <div>
                <div className="text-xs text-text-muted">Recommended left</div>
                <div className="mt-1 text-lg font-medium text-white sm:text-xl">{isLoading ? "..." : dueCount}</div>
              </div>
            </div>
          }
        />

        <Card padding="lg">
          <SectionHeader
            eyebrow="How Jami works"
            title="Learn, practise, repair, then track what is improving."
            description="Jami works best when each study action feeds the next one."
          />
          <div className="mt-5 space-y-3">
            {[
              ["1", "Learn", "Review flashcards so facts and definitions stay available."],
              ["2", "Practise", "Try questions to test whether the idea transfers."],
              ["3", "Tutor", "Ask for hint-first help when you get stuck."],
              ["4", "Draft", "Save useful mistakes as flashcards before they fade."],
              ["5", "Progress", "Check weak topics and choose the next repair action."],
            ].map(([step, title, detail], index, steps) => (
              <div
                key={step}
                className="relative rounded-[1.25rem] border border-white/[0.09] bg-white/[0.035] p-4 sm:flex sm:items-center sm:gap-4"
              >
                <div className="flex items-start gap-3 sm:items-center">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-warm-border bg-warm-glow text-sm font-semibold text-warm-accent">
                    {step}
                  </div>
                  <div>
                    <div className="text-base font-semibold text-white">{title}</div>
                    <p className="mt-1 text-sm leading-6 text-text-secondary">{detail}</p>
                  </div>
                </div>
                {index < steps.length - 1 ? (
                  <div className="ml-5 mt-3 h-6 w-px bg-white/[0.12] sm:ml-auto sm:mt-0 sm:h-px sm:w-14" />
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <GettingStartedChecklist items={gettingStartedItems} isLoading={isLoading} />

        <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
          <StatTile
            label="Daily Review"
            value={isLoading ? "..." : dueCount}
            detail={dueCount > 0 ? "The cards that need attention first." : "Your main queue is clear."}
            href="/dashboard/study"
          />
          <StatTile
            label="Card library"
            value={isLoading ? "..." : cards.length}
            detail={`${decks.length} deck${decks.length === 1 ? "" : "s"} ready for study.`}
            href="/dashboard/cards"
          />
          {urgentGoal ? (
            <Link
              href="/dashboard/goals"
              className="app-panel-warm block p-4 transition duration-fast hover:-translate-y-0.5 hover:shadow-shell sm:p-5"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Goal due soon</div>
              <div className="mt-3 text-xl font-medium tracking-tight text-white">
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
              label="Focused Review"
              value={isLoading ? "..." : cards.length > 0 ? "Open" : "Set up"}
              detail={cards.length === 0 ? "Add cards first." : dueCount > 0 ? "Still available after Daily Review." : "Targeted practice is ready."}
              href="/dashboard/study"
            />
          )}
        </div>

        {!isLoading && cards.length > 0 ? (
          <StreakPredictionPanel prediction={streakPrediction} />
        ) : null}
      </AppPage>
    </Refreshable>
  );
}
