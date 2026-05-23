"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { normalizeGoal, type Goal } from "@/lib/study/goals";
import { getCustomStudyHref } from "@/lib/app/routes";
import {
  countTodayReviews,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import { predictStudyStreak } from "@/lib/study/streak-prediction";
import { loadStudyActivity } from "@/services/study/activity";
import { getAttempts, getActiveQuestions } from "@/services/study/practice";
import { getActiveTopics } from "@/services/study/topics";
import { getMasteryEvents } from "@/services/study/mastery";
import { getGeneratedContentDrafts } from "@/services/study/generated-content";
import type { GeneratedContentDraft } from "@/services/study/generated-content";
import { mapCardData, type Card as StudyCard } from "@/lib/study/cards";
import { ensureDailyReviewState, ensureStudyStateSetup } from "@/services/study/daily-review";
import { loadRemoteActiveStudySession } from "@/services/study/session";
import AppPage from "@/components/layout/AppPage";
import { Card, FeedbackBanner, MetricStrip, PageHero, ProgressBar, SectionHeader, StatTile } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { loadInAppUsername } from "@/services/profile";
import { getStudyDayKey } from "@/lib/study/day";
import { StreakPredictionPanel } from "@/components/stats/AnalyticsPanels";
import type { Topic } from "@/lib/practice/topics";
import type { Question, Attempt } from "@/lib/practice/questions";
import type { MasteryEvent } from "@/lib/practice/mastery";
import { buildTodayPlan, type TodayPlan } from "@/lib/dashboard/today-plan";

type DashboardFeedback = { type: "success" | "error"; message: string };
const GETTING_STARTED_DISMISSED_KEY = "jami:getting-started-complete-dismissed";
const PROGRESS_VISITED_KEY = "jami:progress-visited";

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

  if (allDone && dismissed) {
    return (
      <Card padding="md" className="border-warm-border/70 bg-warm-glow/60">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 shrink-0 rounded-full bg-warm-accent shadow-[0_0_18px_rgba(255,214,246,0.28)]" />
          <div>
            <div className="text-sm font-semibold text-white">
              Getting started complete - you&apos;re ready to use Jami.
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              The setup checklist is finished, so Today can focus on your next study action.
            </p>
          </div>
        </div>
      </Card>
    );
  }

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

function ActionPill({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const className =
    variant === "primary"
      ? "inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover"
      : "inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]";

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function RecommendedActionCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card tone="warm" padding="lg" className="animate-slide-up">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Recommended next action
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            {plan.nextAction.title}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
            {plan.nextAction.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ActionPill href={plan.nextAction.href}>{plan.nextAction.label}</ActionPill>
          {plan.nextAction.secondaryHref && plan.nextAction.secondaryLabel ? (
            <ActionPill href={plan.nextAction.secondaryHref} variant="secondary">
              {plan.nextAction.secondaryLabel}
            </ActionPill>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function TodayReviewCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Today's review"
        title={plan.dueCards.count > 0 ? `${plan.dueCards.count} cards due` : "Daily Review is clear"}
        description={
          plan.dueCards.primaryDeckName
            ? `Most due cards are from ${plan.dueCards.primaryDeckName}.`
            : "Start here when cards become due."
        }
      />
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <MiniMetric label="Due cards" value={plan.dueCards.count} />
        <MiniMetric label="Weak cards" value={plan.dueCards.weakCount} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionPill href={getCustomStudyHref({ mode: "daily" })}>Start Daily Review</ActionPill>
        <ActionPill href={getCustomStudyHref({ mode: "custom" })} variant="secondary">
          Focused Review
        </ActionPill>
      </div>
    </Card>
  );
}

function RepairQueueCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Repair queue"
        title="Recent mistakes"
        description="Mistakes are useful when they point to the next repair action."
      />
      <div className="mt-5 space-y-3">
        {plan.recentMistakes.length > 0 ? (
          plan.recentMistakes.slice(0, 3).map((mistake) => (
            <div key={mistake.attemptId} className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-4">
              <div className="line-clamp-2 text-sm font-semibold text-white">
                {mistake.questionText}
              </div>
              <div className="mt-2 text-xs text-text-muted">
                Confidence {mistake.confidence} - {mistake.tutorUsed ? "Tutor used" : "No tutor yet"}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionPill href={mistake.href} variant="secondary">Retry</ActionPill>
                <ActionPill href={mistake.href} variant="secondary">Ask Tutor</ActionPill>
                <ActionPill href={mistake.href} variant="secondary">Make card</ActionPill>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
            No recent mistakes to repair yet. Attempt a practice question and self-mark it to build
            this queue.
          </p>
        )}
      </div>
    </Card>
  );
}

function DraftQueueCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Flashcard drafts"
        title={plan.drafts.length > 0 ? `${plan.drafts.length} draft${plan.drafts.length === 1 ? "" : "s"} to review` : "No drafts waiting"}
        description="Tutor drafts stay separate until you approve or add them to a deck."
      />
      <div className="mt-5 space-y-3">
        {plan.drafts.length > 0 ? (
          plan.drafts.slice(0, 2).map((draft) => (
            <div key={draft.id} className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                Draft
              </div>
              <div className="mt-2 text-sm font-semibold text-white">{draft.front}</div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-secondary">{draft.back}</p>
              {draft.suggestedTopic ? (
                <div className="mt-3 rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                  Suggested topic: {draft.suggestedTopic}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
            Ask Tutor to make a flashcard from a useful mistake and it will appear here.
          </p>
        )}
      </div>
      <div className="mt-5">
        <ActionPill href="/dashboard/progress" variant="secondary">Review drafts</ActionPill>
      </div>
    </Card>
  );
}

function WeakTopicsCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Weak-topic practice"
        title="Topics to repair"
        description="Progress feeds Today with the weakest concepts."
      />
      <div className="mt-5 space-y-3">
        {plan.weakTopics.length > 0 ? (
          plan.weakTopics.map((topic) => (
            <Link
              key={topic.topicId}
              href={topic.href}
              className="block rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-4 transition duration-fast hover:border-warm-border hover:bg-white/[0.065]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{topic.name}</div>
                  <div className="mt-1 text-xs text-text-muted">{topic.subject}</div>
                </div>
                <div className="rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-xs font-semibold text-text-secondary">
                  {topic.accuracy}%
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-text-secondary">{topic.reason}</p>
            </Link>
          ))
        ) : (
          <p className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
            Weak topics appear after you link cards or questions to topics.
          </p>
        )}
      </div>
    </Card>
  );
}

function GoalSnapshotCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Goals"
        title={plan.goalSummary ? "Goal in motion" : "No urgent goal"}
        description="Goals stay light here so Today remains action-first."
      />
      {plan.goalSummary ? (
        <div className="mt-5">
          <div className="text-sm font-semibold text-white">{plan.goalSummary.title}</div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{plan.goalSummary.detail}</p>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
              <span>Progress</span>
              <span>{plan.goalSummary.progressPercent}%</span>
            </div>
            <ProgressBar progress={plan.goalSummary.progressPercent} />
          </div>
          <div className="mt-5">
            <ActionPill href={plan.goalSummary.href} variant="secondary">Open goals</ActionPill>
          </div>
        </div>
      ) : (
        <p className="mt-5 rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
          Add a goal when you want a target, but Today can still guide the next study step without one.
        </p>
      )}
    </Card>
  );
}

function HowJamiWorksCard({ compact }: { compact: boolean }) {
  const steps = [
    ["1", "Learn", "Review flashcards so facts and definitions stay available."],
    ["2", "Practise", "Try questions to test whether the idea transfers."],
    ["3", "Tutor", "Ask for hint-first help when you get stuck."],
    ["4", "Draft", "Save useful mistakes as flashcards before they fade."],
    ["5", "Progress", "Check weak topics and choose the next repair action."],
  ];

  return (
    <Card padding={compact ? "md" : "lg"}>
      <SectionHeader
        eyebrow="How Jami works"
        title="Learn, practise, repair, then track what is improving."
        description="Jami works best when each study action feeds the next one."
      />
      <div className="mt-5 space-y-3">
        {steps.map(([step, title, detail], index) => (
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
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-white/[0.04] px-3 py-3">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

export default function DashboardHome() {
  const { user } = useUser();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [dueCards, setDueCards] = useState<StudyCard[]>([]);
  const [remainingOptionalCount, setRemainingOptionalCount] = useState(0);
  const [activeGoals, setActiveGoals] = useState<Goal[]>([]);
  const [studyActivity, setStudyActivity] = useState<DailyStudyActivity[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [masteryEvents, setMasteryEvents] = useState<MasteryEvent[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
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

      setDueCards(requiredCards);
      setRemainingOptionalCount(optionalCards.length);
      setCards(allCards);

      const [
        goalsSnapshot,
        activity,
        nextTopics,
        nextQuestions,
        nextAttempts,
        nextMasteryEvents,
        nextDrafts,
      ] = await Promise.all([
        getDocs(collection(db, "users", uid, "goals")).catch(() => null),
        loadStudyActivity(uid).catch(() => [] as DailyStudyActivity[]),
        getActiveTopics(uid).catch(() => [] as Topic[]),
        getActiveQuestions(uid).catch(() => []),
        getAttempts(uid).catch(() => []),
        getMasteryEvents(uid).catch(() => [] as MasteryEvent[]),
        getGeneratedContentDrafts(uid).catch(() => [] as GeneratedContentDraft[]),
      ]);

      setStudyActivity(activity);
      setTopics(nextTopics);
      setQuestions(nextQuestions);
      setAttempts(nextAttempts);
      setMasteryEvents(nextMasteryEvents);
      setDrafts(nextDrafts);

      if (goalsSnapshot) {
        const now2 = Date.now();
        const activeGoals = goalsSnapshot.docs
          .map((d) => normalizeGoal(d.id, d.data() as Record<string, unknown>))
          .filter((goal) => goal.status === "active" && goal.deadline > now2);
        setActiveGoals(activeGoals);
      } else {
        setActiveGoals([]);
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
  const todayPlan = useMemo<TodayPlan>(
    () =>
      buildTodayPlan({
        decks,
        cards,
        dueCards,
        topics,
        questions,
        attempts,
        masteryEvents,
        drafts,
        activeGoals,
        reviewedToday: todayReviews,
        progressVisited,
      }),
    [
      activeGoals,
      attempts,
      cards,
      decks,
      drafts,
      dueCards,
      masteryEvents,
      progressVisited,
      questions,
      todayReviews,
      topics,
    ]
  );
  const gettingStartedItems = useMemo<ChecklistItem[]>(
    () => [
      {
        label: "Create your first deck",
        detail: "Decks are groups of flashcards.",
        href: "/dashboard/decks",
        done: todayPlan.checklist.createDeck,
      },
      {
        label: "Add 5 flashcards",
        detail: "Give Learn enough material to schedule reviews.",
        href: "/dashboard/cards",
        done: todayPlan.checklist.addCards,
      },
      {
        label: "Review your cards",
        detail: "Complete at least one study action in Learn.",
        href: "/dashboard/study",
        done: todayPlan.checklist.reviewCards,
      },
      {
        label: "Create a practice question",
        detail: "Practise turns memory into application.",
        href: "/dashboard/practise",
        done: todayPlan.checklist.createQuestion,
      },
      {
        label: "Ask Tutor for a hint or make a draft",
        detail: "Use Tutor when stuck, then save useful mistakes.",
        href: "/dashboard/practise",
        done: todayPlan.checklist.askTutor,
      },
      {
        label: "Check Progress",
        detail: "See weak topics and the next repair action.",
        href: "/dashboard/progress",
        done: todayPlan.checklist.checkProgress,
      },
    ],
    [todayPlan.checklist]
  );
  const dueCount = todayPlan.dueCards.count;
  const hasStartedLoop = decks.length > 0 || cards.length > 0 || questions.length > 0 || attempts.length > 0;

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
          eyebrow={isLoading ? "Getting ready" : "Daily command centre"}
          title={isLoading ? "Getting today ready." : "What should I do next today?"}
          description={
            <>
              <span className="mb-3 block text-sm text-text-secondary">
                {inAppUsername
                  ? `Welcome back, ${inAppUsername}.`
                  : "Welcome back. Here is today at a glance."}
              </span>
              {isLoading
                ? "Jami is loading reviews, practice, mistakes, drafts, and goals."
                : "Today pulls the learning loop into one action-first study plan."}
            </>
          }
          aside={
            <div className="grid min-w-[14rem] gap-3 rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
              <div>
                <div className="text-xs text-text-muted">Reviewed today</div>
                <div className="mt-1 text-xl font-medium text-white sm:text-2xl">{isLoading ? "..." : todayReviews}</div>
              </div>
              <div className="h-px bg-white/[0.08]" />
              <div>
                <div className="text-xs text-text-muted">Due now</div>
                <div className="mt-1 text-lg font-medium text-white sm:text-xl">{isLoading ? "..." : dueCount}</div>
              </div>
            </div>
          }
        />

        {isLoading ? (
          <Card tone="warm" padding="lg">
            <SectionHeader
              eyebrow="Recommended next action"
              title="Building your study plan."
              description="Today waits for real data before showing counts or priorities."
            />
          </Card>
        ) : (
          <>
            <RecommendedActionCard plan={todayPlan} />
            <MetricStrip
              variant="compact"
              items={[
                { label: "Due cards", value: todayPlan.dueCards.count },
                { label: "Recent mistakes", value: todayPlan.recentMistakes.length, tone: todayPlan.recentMistakes.length > 0 ? "danger" : "good" },
                { label: "Drafts", value: todayPlan.drafts.length, tone: todayPlan.drafts.length > 0 ? "warm" : "good" },
                { label: "Weak topics", value: todayPlan.weakTopics.length, tone: todayPlan.weakTopics.length > 0 ? "danger" : "good" },
              ]}
            />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
              <div className="space-y-4">
                <TodayReviewCard plan={todayPlan} />
                <RepairQueueCard plan={todayPlan} />
                <DraftQueueCard plan={todayPlan} />
              </div>
              <div className="space-y-4">
                <WeakTopicsCard plan={todayPlan} />
                <GoalSnapshotCard plan={todayPlan} />
              </div>
            </div>

            <GettingStartedChecklist items={gettingStartedItems} isLoading={isLoading} />

            {remainingOptionalCount > 0 ? (
              <StatTile
                label="Easy extras"
                value={remainingOptionalCount}
                detail="Daily Review is clear, but these lighter passes are still available."
                href={getCustomStudyHref({ mode: "daily" })}
              />
            ) : null}

            {cards.length > 0 ? (
              <StreakPredictionPanel prediction={streakPrediction} />
            ) : null}

            <HowJamiWorksCard compact={hasStartedLoop} />
          </>
        )}
      </AppPage>
    </Refreshable>
  );
}
