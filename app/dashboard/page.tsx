"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { runDashboardDataRequest } from "@/lib/app/dashboard-data";
import type { Deck } from "@/lib/study/decks";
import type { Goal } from "@/lib/study/goals";
import { getCustomStudyHref } from "@/lib/app/routes";
import {
  countTodayReviews,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Card as StudyCard } from "@/lib/study/cards";
import AppPage from "@/components/layout/AppPage";
import { Button, ButtonLink, Card, FeedbackBanner, IconBubble, PageHero, ProgressBar, SectionHeader, StatTile } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import type { Topic } from "@/lib/material/topics";
import type { MasteryEvent } from "@/lib/material/mastery";
import type { Source } from "@/lib/material/sources";
import { buildTodayPlan, type TodayPlan } from "@/lib/dashboard/today-plan";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { Notebook } from "@/lib/workspace/notebooks";
import { usePersistentDisclosure } from "@/lib/app/disclosure-preference";
import {
  getCachedDashboardSnapshot,
  loadDashboardSnapshot,
  type DashboardSnapshot,
} from "@/services/dashboard/today";

const GETTING_STARTED_DISMISSED_KEY = "jami:getting-started-complete-dismissed";
const GETTING_STARTED_OPEN_STORAGE_KEY = "jami:getting-started-open";
const PROGRESS_VISITED_KEY = "jami:progress-visited";

type ChecklistItem = {
  label: string;
  detail: string;
  href: string;
  done: boolean;
};

/**
 * The road to the first review, for a student who has not walked it yet.
 *
 * It sits *below* the recommended action rather than above it. The whole point
 * of the recommendation is that Jami already knows what to do next -- for a
 * brand new student that is "create your first folder", and for everyone else
 * it is their actual review -- so putting setup scaffolding on top of it made
 * the page bury its own answer.
 *
 * It opens itself for a student with nothing to study, who needs the map, and
 * stays folded for one who is already going.
 */
function GettingStartedChecklist({
  items,
  isLoading,
  defaultOpen,
}: {
  items: ChecklistItem[];
  isLoading: boolean;
  defaultOpen: boolean;
}) {
  const [open, toggleOpen] = usePersistentDisclosure(
    GETTING_STARTED_OPEN_STORAGE_KEY,
    defaultOpen,
  );
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(GETTING_STARTED_DISMISSED_KEY) === "true";
    } catch {
      // Storage can be blocked by browser privacy settings; showing the
      // checklist again is the safe non-persistent fallback.
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
        // The dismissal still applies for this render when browser storage is
        // blocked; it simply cannot persist across navigation.
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
                  From source: {draft.sourceTitle}
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
      <div className="mt-5 grid gap-3">
        {plan.weakTopics.length > 0 ? (
          plan.weakTopics.map((topic) => (
            <Link
              key={topic.topicId}
              href={topic.href}
              className="app-subtle-panel grid gap-3 rounded-[1.15rem] p-4 transition duration-fast hover:-translate-y-[1px] sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] sm:items-center"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">{topic.name}</div>
                <div className="mt-1 text-xs text-text-muted">{topic.subject}</div>
              </div>
              <p className="text-sm leading-6 text-text-secondary sm:border-l sm:border-[var(--color-border)] sm:pl-4">
                {topic.reason}
              </p>
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
  const [sectionStates, setSectionStates] = useState<DashboardSnapshot["sections"]>({
    decks: "unavailable",
    profile: "unavailable",
    cards: "unavailable",
    session: "unavailable",
    goals: "unavailable",
    activity: "unavailable",
    topics: "unavailable",
    mastery: "unavailable",
    drafts: "unavailable",
    sources: "unavailable",
    folders: "unavailable",
    notebooks: "unavailable",
    dailyReview: "unavailable",
  });
  const [progressVisited, setProgressVisited] = useState(false);
  const [hasActiveStudySession, setHasActiveStudySession] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const {
    feedback,
    success,
    showError,
    clear: clearFeedback,
  } = useFeedback();
  const [inAppUsername, setInAppUsername] = useState<string | null>(null);
  const lastForegroundRefreshAtRef = useRef(0);
  const dashboardRequestIdRef = useRef(0);

  const applySnapshot = useCallback((snapshot: DashboardSnapshot) => {
    setDecks(snapshot.decks);
    setDueCards(snapshot.dueCards);
    setRemainingOptionalCount(snapshot.remainingOptionalCount);
    setActiveGoals(snapshot.activeGoals);
    setHasEarnedStars(snapshot.hasEarnedStars);
    setStudyActivity(snapshot.studyActivity);
    setCards(snapshot.cards);
    setTopics(snapshot.topics);
    setMasteryEvents(snapshot.masteryEvents);
    setDrafts(snapshot.drafts);
    setSources(snapshot.sources);
    setStudyFolders(snapshot.studyFolders);
    setNotebooks(snapshot.notebooks);
    setSectionStates(snapshot.sections);
    setInAppUsername(snapshot.username);
    setHasActiveStudySession(snapshot.hasActiveStudySession);
  }, []);

  const loadAll = useCallback(
    async (uid: string, options: { force?: boolean } = {}) => {
      const requestId = dashboardRequestIdRef.current + 1;
      dashboardRequestIdRef.current = requestId;

      return runDashboardDataRequest({
        load: () => loadDashboardSnapshot(uid, options),
        isCurrent: () => requestId === dashboardRequestIdRef.current,
        apply: ({ snapshot, feedback: loadFeedback }) => {
          applySnapshot(snapshot);
          lastForegroundRefreshAtRef.current = snapshot.fetchedAt;
          if (loadFeedback) {
            if (loadFeedback.type === "success") success(loadFeedback.message);
            else showError(loadFeedback.message);
          }
        },
        onError: (error) => {
          console.error("Failed to load Today.", error);
          showError("Failed to load Today. Try refreshing in a moment.");
        },
        onSettled: () => setIsLoading(false),
      });
    },
    [applySnapshot, showError, success]
  );

  useEffect(() => {
    const cached = getCachedDashboardSnapshot(user.uid);
    if (cached) {
      applySnapshot(cached.snapshot);
      setIsLoading(false);
      lastForegroundRefreshAtRef.current = cached.snapshot.fetchedAt;
    } else {
      setIsLoading(true);
    }
    if (cached?.freshness !== "fresh") {
      void loadAll(user.uid);
    }
    return () => {
      dashboardRequestIdRef.current += 1;
    };
  }, [applySnapshot, user.uid, loadAll]);

  useEffect(() => {
    try {
      setProgressVisited(localStorage.getItem(PROGRESS_VISITED_KEY) === "true");
    } catch {
      // Treat inaccessible browser storage as no recorded visit; this only
      // affects optional onboarding copy.
      setProgressVisited(false);
    }
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "hidden" &&
        now - lastForegroundRefreshAtRef.current > 60_000
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
    clearFeedback();
    try {
      await loadAll(user.uid, { force: true });
    } finally {
      setRefreshing(false);
    }
  }, [clearFeedback, loadAll, user.uid]);

  const todayReviews = useMemo(
    () => countTodayReviews(studyActivity),
    [studyActivity]
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
        hasActiveStudySession,
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
      hasActiveStudySession,
      sources,
      studyFolders,
      todayReviews,
      topics,
    ]
  );
  /*
   * Setup stops at the first review.
   *
   * It used to carry "set a goal" and "earn a star" too, which are good things
   * but are not what stands between a student and studying -- and because most
   * students never do them, the list never completed and the onboarding card
   * never went away. Somebody reviewing every day still had a getting-started
   * checklist on their home page. Goals and stars are surfaced below on their
   * own merits, once there is something to study.
   */
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
    ],
    [todayPlan.checklist]
  );
  const dueCount = todayPlan.dueCards.count;
  /**
   * Whether this student has anything of their own yet.
   *
   * It decides how loudly setup is offered, not whether the page leads with a
   * recommendation: `buildNextAction` has an answer either way, and "create
   * your first study folder" is as much a next step as a review is.
   */
  const hasStudyMaterial = cards.length > 0 || notebooks.length > 0;
  const hasSecondaryCards =
    todayPlan.drafts.length > 0 ||
    todayPlan.weakTopics.length > 0 ||
    Boolean(todayPlan.goalSummary);
  const secondaryCardCount =
    Number(sectionStates.drafts !== "unavailable" && todayPlan.drafts.length > 0) +
    Number(
      sectionStates.topics !== "unavailable" &&
        sectionStates.mastery !== "unavailable" &&
        todayPlan.weakTopics.length > 0
    ) +
    Number(sectionStates.goals !== "unavailable" && Boolean(todayPlan.goalSummary));
  const planSections = [
    "decks",
    "cards",
    "session",
    "goals",
    "activity",
    "topics",
    "mastery",
    "drafts",
    "sources",
    "folders",
    "notebooks",
    "dailyReview",
  ] as const;
  const planUnavailable = planSections.some(
    (section) => sectionStates[section] === "unavailable"
  );
  const hasSecondaryTier =
    hasSecondaryCards ||
    (sectionStates.dailyReview !== "unavailable" && remainingOptionalCount > 0);

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Today"
        width="2xl"
        action={<RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />}
        contentClassName="space-y-4 sm:space-y-6"
      >
        {feedback ? (
          <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => clearFeedback()} />
        ) : null}

        {/*
          * One block, not two.
          *
          * The hero used to promise "your next study step" and the card below
          * it announced "recommended next action" -- two eyebrows, two
          * headings and two panels before a single instruction. The
          * recommendation *is* the hero now: the action is the largest words
          * on the page and its button sits directly under them.
          *
          * The counters are the returning student's. On day one there is
          * nothing to count and a pair of noughts is a poor first thing to
          * see, so they wait until there is something to say.
          */}
        <PageHero
          className="animate-slide-up"
          eyebrow={
            isLoading
              ? "Loading"
              : !hasStudyMaterial
                ? inAppUsername
                  ? `Welcome, ${inAppUsername}`
                  : "Welcome"
                : inAppUsername
                  ? `Today, ${inAppUsername}`
                  : "Today"
          }
          title={
            isLoading
              ? "Getting today ready."
              : planUnavailable
                ? "Your study plan is temporarily unavailable."
                : todayPlan.nextAction.title
          }
          description={
            isLoading
              ? undefined
              : planUnavailable
                ? "Refresh in a moment. Jami will not treat missing data as an empty study list."
                : todayPlan.nextAction.description
          }
          action={
            isLoading || planUnavailable ? undefined : (
              <ActionPill href={todayPlan.nextAction.href}>
                {todayPlan.nextAction.label}
              </ActionPill>
            )
          }
          secondaryAction={
            !isLoading &&
            !planUnavailable &&
            todayPlan.nextAction.secondaryHref &&
            todayPlan.nextAction.secondaryLabel ? (
              <ActionPill
                href={todayPlan.nextAction.secondaryHref}
                variant="secondary"
              >
                {todayPlan.nextAction.secondaryLabel}
              </ActionPill>
            ) : null
          }
          aside={
            !hasStudyMaterial || isLoading ? undefined : (
              <div className="app-subtle-panel grid w-full min-w-0 grid-cols-2 gap-3 rounded-[1.4rem] p-4 sm:min-w-[14rem] sm:grid-cols-1">
                <div>
                  <div className="text-xs text-text-muted">Reviewed today</div>
                  <div className="mt-1 text-xl font-medium text-text-primary sm:text-2xl">
                    {sectionStates.activity === "unavailable" ? "—" : todayReviews}
                  </div>
                </div>
                <div className="h-px bg-[var(--color-border)]" />
                <div>
                  <div className="text-xs text-text-muted">Due now</div>
                  <div className="mt-1 text-lg font-medium text-text-primary sm:text-xl">
                    {sectionStates.dailyReview === "unavailable" ? "—" : dueCount}
                  </div>
                </div>
              </div>
            )
          }
        />

        {!isLoading ? (
          <>
            {!planUnavailable ? (
              <GettingStartedChecklist
                items={gettingStartedItems}
                isLoading={isLoading}
                defaultOpen={!hasStudyMaterial}
              />
            ) : null}

            {/*
              * Everything below is the second tier, and it is labelled as
              * such. Without a break the page was a flat stack of cards of
              * equal weight, so the one thing Jami actually recommends had to
              * compete with everything it merely noticed.
              */}
            {hasSecondaryTier ? (
              <section className="space-y-4 border-t border-[var(--color-border)] pt-6">
                <SectionHeader
                  title="Also today"
                  description="Worth a look once the step above is done."
                />

                {hasSecondaryCards ? (
                  <div
                    className={`grid items-start gap-4 ${
                      secondaryCardCount === 1
                        ? "grid-cols-1"
                        : "md:grid-cols-2 2xl:grid-cols-3"
                    }`}
                  >
                    {sectionStates.drafts !== "unavailable" && todayPlan.drafts.length > 0 ? (
                      <DraftQueueCard plan={todayPlan} />
                    ) : null}
                    {sectionStates.topics !== "unavailable" &&
                    sectionStates.mastery !== "unavailable" &&
                    todayPlan.weakTopics.length > 0 ? (
                      <WeakTopicsCard plan={todayPlan} />
                    ) : null}
                    {sectionStates.goals !== "unavailable" && todayPlan.goalSummary ? (
                      <GoalSnapshotCard plan={todayPlan} />
                    ) : null}
                  </div>
                ) : null}

                {sectionStates.dailyReview !== "unavailable" && remainingOptionalCount > 0 ? (
                  <StatTile
                    label="Easy extras"
                    value={remainingOptionalCount}
                    detail="Daily Review is clear, but these lighter passes are still available."
                    href={getCustomStudyHref({ mode: "daily" })}
                  />
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </AppPage>
    </Refreshable>
  );
}
