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
import { getActiveTopics } from "@/services/study/topics";
import { getMasteryEvents } from "@/services/study/mastery";
import { getGeneratedContentDrafts } from "@/services/study/generated-content";
import { getActiveSources } from "@/services/study/sources";
import type { GeneratedContentDraft } from "@/services/study/generated-content";
import { mapCardData, type Card as StudyCard } from "@/lib/study/cards";
import { ensureDailyReviewState, ensureStudyStateSetup } from "@/services/study/daily-review";
import { loadRemoteActiveStudySession } from "@/services/study/session";
import AppPage from "@/components/layout/AppPage";
import { Button, ButtonLink, Card, FeedbackBanner, IconBubble, PageHero, ProgressBar, SectionHeader, StatTile } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { loadInAppUsername } from "@/services/profile";
import { getStudyDayKey } from "@/lib/study/day";
import { StreakPredictionPanel } from "@/components/stats/AnalyticsPanels";
import type { Topic } from "@/lib/practice/topics";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Source } from "@/lib/practice/sources";
import { buildTodayPlan, type TodayPlan } from "@/lib/dashboard/today-plan";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { Notebook } from "@/lib/workspace/notebooks";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { usePersistentDisclosure } from "@/lib/app/disclosure-preference";

type DashboardFeedback = { type: "success" | "error"; message: string };
const GETTING_STARTED_DISMISSED_KEY = "jami:getting-started-complete-dismissed";
const GETTING_STARTED_OPEN_STORAGE_KEY = "jami:getting-started-open";
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
  const [open, toggleOpen] = usePersistentDisclosure(
    GETTING_STARTED_OPEN_STORAGE_KEY,
    true,
  );
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
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [showComplete]);

  if (allDone && dismissed) {
    return null;
  }

  if (showComplete) {
    return (
      <Card tone="warm" padding="lg" className="animate-reward-pulse">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
              Getting started complete
            </div>
            <div className="mt-2 text-xl font-semibold text-text-primary">
              You are ready.
            </div>
          </div>
          <IconBubble size="lg" shape="circle" className="h-16 w-16 border border-warm-border bg-warm-glow">
            <span className="h-8 w-8 rounded-full bg-warm-accent shadow-[0_0_28px_rgba(255,214,246,0.35)]" />
          </IconBubble>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          title="Getting started"
        />
        <Button
          type="button"
          onClick={toggleOpen}
          variant="secondary"
          size="sm"
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {items.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              className={`app-subtle-panel flex min-h-[5rem] items-center gap-3 rounded-[1.15rem] p-3 transition duration-fast hover:-translate-y-[1px] ${
                item.done ? "app-selected" : ""
              }`}
            >
              <IconBubble
                size="md"
                shape="circle"
                className={`shrink-0 font-semibold ${item.done ? "app-success" : "app-chip"}`}
                aria-label={item.done ? "Complete" : `Step ${index + 1}`}
              >
                {item.done ? "✓" : index + 1}
              </IconBubble>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-primary">{item.label}</span>
                <span className="mt-1 block text-xs leading-5 text-text-secondary">{item.detail}</span>
              </span>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${item.done ? "app-success" : "app-chip"}`}>
                {item.done ? "Done" : "Start"}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
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
  return (
    <ButtonLink
      href={href}
      variant={variant === "primary" ? "primary" : "secondary"}
    >
      {children}
    </ButtonLink>
  );
}

function RecommendedActionCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card
      padding="lg"
      className="h-full animate-slide-up !border-[color-mix(in_srgb,var(--color-text-primary)_14%,transparent)]"
    >
      <div className="flex h-full flex-col gap-5">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Recommended next action
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">
            {plan.nextAction.title}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
            {plan.nextAction.description}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
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
    <Card
      padding="lg"
      className="h-full !border-[color-mix(in_srgb,var(--color-text-primary)_14%,transparent)]"
    >
      <SectionHeader
        eyebrow="Today's review"
        title={plan.dueCards.count > 0 ? `${plan.dueCards.count} cards due` : "Daily Review is clear"}
      />
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <MiniMetric label="Due cards" value={plan.dueCards.count} />
        <MiniMetric label="Weak cards" value={plan.dueCards.weakCount} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionPill href={getCustomStudyHref({ mode: "daily" })}>Start review</ActionPill>
        <ActionPill href={getCustomStudyHref({ mode: "custom" })} variant="secondary">
          Focused review
        </ActionPill>
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
      />
      <div className="mt-5 space-y-3">
        {plan.drafts.length > 0 ? (
          plan.drafts.slice(0, 2).map((draft) => (
            <div key={draft.id} className="app-subtle-panel rounded-[1.15rem] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                {draft.sourceTitle ? "Source draft" : "Draft"}
              </div>
              <div className="mt-2 text-sm font-semibold text-text-primary">{draft.front}</div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-secondary">{draft.back}</p>
              {draft.sourceTitle ? (
                <p className="mt-2 text-xs text-text-muted">
                  From Library source: {draft.sourceTitle}
                </p>
              ) : null}
              {draft.suggestedTopic ? (
                <div className="app-warning mt-3 rounded-full px-3 py-1 text-xs font-semibold">
                  Suggested topic: {draft.suggestedTopic}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p className="app-subtle-panel rounded-[1.15rem] p-4 text-sm leading-6 text-text-secondary">
            No drafts waiting.
          </p>
        )}
      </div>
      <div className="mt-5">
        <ActionPill href={plan.drafts[0]?.href ?? "/dashboard/progress"} variant="secondary">Review drafts</ActionPill>
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
      />
      <div className="mt-5 space-y-3">
        {plan.weakTopics.length > 0 ? (
          plan.weakTopics.map((topic) => (
            <Link
              key={topic.topicId}
              href={topic.href}
            className="app-subtle-panel block rounded-[1.15rem] p-4 transition duration-fast hover:-translate-y-[1px]"
          >
              <div>
                <div className="text-sm font-semibold text-text-primary">{topic.name}</div>
                <div className="mt-1 text-xs text-text-muted">{topic.subject}</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-text-secondary">{topic.reason}</p>
            </Link>
          ))
        ) : (
          <p className="app-subtle-panel rounded-[1.15rem] p-4 text-sm leading-6 text-text-secondary">
            Weak topics appear after a little study history.
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
      />
      {plan.goalSummary ? (
        <div className="mt-5">
          <div className="text-sm font-semibold text-text-primary">{plan.goalSummary.title}</div>
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
        <p className="app-subtle-panel mt-5 rounded-[1.15rem] p-4 text-sm leading-6 text-text-secondary">
          Add a goal when you want a target.
        </p>
      )}
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="app-chip rounded-[1rem] px-3 py-3">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-text-primary">{value}</div>
    </div>
  );
}

export default function DashboardHome() {
  const { user } = useUser();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [dueCards, setDueCards] = useState<StudyCard[]>([]);
  const [remainingOptionalCount, setRemainingOptionalCount] = useState(0);
  const [activeGoals, setActiveGoals] = useState<Goal[]>([]);
  const [hasEarnedStars, setHasEarnedStars] = useState(false);
  const [studyActivity, setStudyActivity] = useState<DailyStudyActivity[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [masteryEvents, setMasteryEvents] = useState<MasteryEvent[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [studyFolders, setStudyFolders] = useState<StudyFolder[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
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
          if (code !== "permission-denied") {
            setFeedback({
              type: "error",
              message: code ? `Failed to load decks (${code}).` : "Failed to load decks.",
            });
          }
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
        nextMasteryEvents,
        nextDrafts,
        nextSources,
        nextStudyFolders,
        nextNotebooks,
      ] = await Promise.all([
        getDocs(collection(db, "users", uid, "goals")).catch(() => null),
        loadStudyActivity(uid).catch(() => [] as DailyStudyActivity[]),
        getActiveTopics(uid).catch(() => [] as Topic[]),
        getMasteryEvents(uid).catch(() => [] as MasteryEvent[]),
        getGeneratedContentDrafts(uid).catch(() => [] as GeneratedContentDraft[]),
        getActiveSources(uid).catch(() => [] as Source[]),
        getActiveStudyFolders(uid).catch(() => [] as StudyFolder[]),
        getActiveNotebooks(uid).catch(() => [] as Notebook[]),
      ]);

      setStudyActivity(activity);
      setTopics(nextTopics);
      setMasteryEvents(nextMasteryEvents);
      setDrafts(nextDrafts);
      setSources(nextSources);
      setStudyFolders(nextStudyFolders);
      setNotebooks(nextNotebooks);

      if (goalsSnapshot) {
        const now2 = Date.now();
        const goals = goalsSnapshot.docs.map((d) =>
          normalizeGoal(d.id, d.data() as Record<string, unknown>)
        );
        const activeGoals = goals
          .filter(
            (goal) =>
              goal.status === "active" &&
              (goal.deadline <= 0 || goal.deadline > now2)
          );
        setActiveGoals(activeGoals);
        setHasEarnedStars(goals.some((goal) => goal.status === "completed"));
      } else {
        setActiveGoals([]);
        setHasEarnedStars(false);
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
        masteryEvents,
        drafts,
        sources,
        studyFolders,
        notebooks,
        activeGoals,
        reviewedToday: todayReviews,
        progressVisited,
        hasEarnedStars,
      }),
    [
      activeGoals,
      cards,
      decks,
      drafts,
      notebooks,
      dueCards,
      masteryEvents,
      progressVisited,
      hasEarnedStars,
      sources,
      studyFolders,
      todayReviews,
      topics,
    ]
  );
  const gettingStartedItems = useMemo<ChecklistItem[]>(
    () => [
      {
        label: "Create a folder",
        detail: "Set up a study space.",
        href: "/dashboard/folders",
        done: todayPlan.checklist.createFolder,
      },
      {
        label: "Create a deck",
        detail: "Add a flashcard deck.",
        href: "/dashboard/decks",
        done: todayPlan.checklist.createDeck,
      },
      {
        label: "Add cards",
        detail: "Write front and back prompts.",
        href: "/dashboard/cards",
        done: todayPlan.checklist.addCards,
      },
      {
        label: "Study a deck",
        detail: "Complete one review.",
        href: "/dashboard/study",
        done: todayPlan.checklist.reviewCards,
      },
      {
        label: "Set a goal",
        detail: "Choose a clear study target.",
        href: "/dashboard/goals",
        done: todayPlan.checklist.setGoal,
      },
      {
        label: "Earn a star",
        detail: "Complete a goal and see its reward.",
        href: "/dashboard/constellation",
        done: todayPlan.checklist.earnStar,
      },
    ],
    [todayPlan.checklist]
  );
  const dueCount = todayPlan.dueCards.count;
  const hasSecondaryCards =
    todayPlan.drafts.length > 0 ||
    todayPlan.weakTopics.length > 0 ||
    Boolean(todayPlan.goalSummary);

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
          compact
          eyebrow={isLoading ? "Loading" : "Today"}
          title={isLoading ? "Getting today ready." : "Your next study step"}
          description={
            <>
              {inAppUsername ? `Welcome back, ${inAppUsername}.` : "Welcome back."}
            </>
          }
          aside={
            <div className="app-subtle-panel grid w-full min-w-0 grid-cols-2 gap-3 rounded-[1.4rem] p-4 sm:min-w-[14rem] sm:grid-cols-1">
              <div>
                <div className="text-xs text-text-muted">Reviewed today</div>
                <div className="mt-1 text-xl font-medium text-text-primary sm:text-2xl">{isLoading ? "..." : todayReviews}</div>
              </div>
              <div className="h-px bg-[var(--color-border)]" />
              <div>
                <div className="text-xs text-text-muted">Due now</div>
                <div className="mt-1 text-lg font-medium text-text-primary sm:text-xl">{isLoading ? "..." : dueCount}</div>
              </div>
            </div>
          }
        />

        <GettingStartedChecklist items={gettingStartedItems} isLoading={isLoading} />

        {isLoading ? (
          <Card tone="warm" padding="lg">
            <SectionHeader
              eyebrow="Recommended next action"
              title="Building your study plan."
            />
          </Card>
        ) : (
          <>
            <div className="grid items-stretch gap-4 md:grid-cols-2">
              <RecommendedActionCard plan={todayPlan} />
              <TodayReviewCard plan={todayPlan} />
            </div>

            {hasSecondaryCards ? (
              <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {todayPlan.drafts.length > 0 ? <DraftQueueCard plan={todayPlan} /> : null}
                {todayPlan.weakTopics.length > 0 ? <WeakTopicsCard plan={todayPlan} /> : null}
                {todayPlan.goalSummary ? <GoalSnapshotCard plan={todayPlan} /> : null}
              </div>
            ) : null}

            {remainingOptionalCount > 0 ? (
              <StatTile
                label="Easy extras"
                value={remainingOptionalCount}
                detail="Daily Review is clear, but these lighter passes are still available."
                href={getCustomStudyHref({ mode: "daily" })}
              />
            ) : null}

            {cards.length > 0 ? (
              <StreakPredictionPanel prediction={streakPrediction} compact />
            ) : null}
          </>
        )}
      </AppPage>
    </Refreshable>
  );
}
