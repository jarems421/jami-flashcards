"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { runDashboardDataRequest } from "@/lib/app/dashboard-data";
import type { Deck } from "@/lib/study/decks";
import type { Goal } from "@/lib/study/goals";
import {
  getCustomStudyHref,
  getQuestionPracticeSetupHref,
  getRevisionPlanHref,
} from "@/lib/app/routes";
import { countTodayReviews, type DailyStudyActivity } from "@/lib/study/activity";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Card as StudyCard } from "@/lib/study/cards";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  ButtonLink,
  Card,
  FeedbackBanner,
  ProgressBar,
  SectionHeader,
  Skeleton,
  StatTile,
} from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import type { Topic } from "@/lib/material/topics";
import type { MasteryEvent } from "@/lib/material/mastery";
import type { Source } from "@/lib/material/sources";
import { buildTodayPlan, type TodayPlan, type TodayStudyAction } from "@/lib/dashboard/today-plan";
import {
  buildTodayMission,
  greeting,
  hubSubline,
  missionCompletionCopy,
} from "@/lib/dashboard/today-mission";
import StudyActionsCard from "@/components/learning/StudyActionsCard";
import InterventionDraftReview from "@/components/learning/InterventionDraftReview";
import MissionCard from "@/components/today/MissionCard";
import MaterialReady from "@/components/today/MaterialReady";
import MomentumStrip, { buildMomentumWeek } from "@/components/today/MomentumStrip";
import MoreForToday from "@/components/today/MoreForToday";
import PlanSummary from "@/components/today/PlanSummary";
import StudyDoors, { type StudyDoor } from "@/components/today/StudyDoors";
import { useRevisionPlanToday } from "@/hooks/useRevisionPlanToday";
import { featureFlags } from "@/lib/app/feature-flags";
import { useStudyActions } from "@/hooks/useStudyActions";
import { useInterventionMaterial } from "@/hooks/useInterventionMaterial";
import {
  DAILY_REVIEW_MISSION_ID,
  noteMissionStarted,
  takeCompletedMission,
  type MissionHandoff,
} from "@/lib/learning/mission-handoff";
import { getStudyDayKey } from "@/lib/study/day";
import { noteStudyActionEvent } from "@/services/learning/study-action-events";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { Notebook } from "@/lib/workspace/notebooks";
import {
  getCachedDashboardSnapshot,
  loadDashboardSnapshot,
  type DashboardSnapshot,
} from "@/services/dashboard/today";
import { TutorialResumeCard, useTutorial } from "@/components/onboarding/TutorialProvider";
import { shouldInviteToTutorial } from "@/lib/onboarding/tutorial";
import FirstNightPanel from "@/components/onboarding/FirstNightPanel";
import { useFirstNight } from "@/components/onboarding/FirstNightProvider";

/**
 * The Study Hub.
 *
 * Today answers one question -- what should I do now? -- and the whole layout
 * is arranged around not making the student work for the answer. One mission
 * at full size, a quiet rail of how-much beside it, four doors for a student
 * who wants something else, and everything Jami merely noticed folded away.
 *
 * What it deliberately is not is a dashboard. Every count Jami holds could go
 * on this page and the result would be a student auditing themselves before
 * they had studied anything. The rule that keeps it honest: show the smallest
 * amount of information that makes the next decision easy, and put the rest
 * somewhere it can be asked for.
 *
 * Nothing here decides what to study. The Learning Engine chooses, the
 * intervention catalogue chooses what can be done about it, and the planner
 * says how much time there is. This page composes those three answers and
 * never adds a fourth.
 */

const PROGRESS_VISITED_KEY = "jami:progress-visited";

function DraftQueueCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Flashcard drafts"
        title={`${plan.drafts.length} draft${plan.drafts.length === 1 ? "" : "s"} to review`}
      />
      <div className="mt-5 space-y-3">
        {plan.drafts.slice(0, 2).map((draft) => (
          <div key={draft.id} className="app-subtle-panel rounded-lg p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
              {draft.sourceTitle ? "Source draft" : "Draft"}
            </div>
            <div className="mt-2 text-sm font-semibold text-text-primary">{draft.front}</div>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-secondary">{draft.back}</p>
            {draft.suggestedTopic ? (
              <div className="app-warning mt-3 rounded-full px-3 py-1 text-xs font-semibold">
                Suggested topic: {draft.suggestedTopic}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-5">
        <ButtonLink href="/dashboard/tutor" variant="secondary">
          Review drafts
        </ButtonLink>
      </div>
    </Card>
  );
}

function WeakTopicsCard({ plan }: { plan: TodayPlan }) {
  return (
    <Card padding="lg">
      <SectionHeader eyebrow="Weak-topic practice" title="Topics to repair" />
      <div className="mt-5 grid gap-3">
        {plan.weakTopics.map((topic) => (
          <Link
            key={topic.topicId}
            href={topic.href}
            className="app-subtle-panel grid gap-3 rounded-lg p-4 transition duration-fast hover:-translate-y-[1px] sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] sm:items-center"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary">{topic.name}</div>
              <div className="mt-1 text-xs text-text-muted">{topic.subject}</div>
            </div>
            <p className="text-sm leading-6 text-text-secondary sm:border-l sm:border-[var(--color-border)] sm:pl-4">
              {topic.reason}
            </p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function GoalSnapshotCard({ plan }: { plan: TodayPlan }) {
  if (!plan.goalSummary) return null;
  return (
    <Card padding="lg">
      <SectionHeader eyebrow="Goals" title="Goal in motion" />
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
          <ButtonLink href={plan.goalSummary.href} variant="secondary">
            Open goals
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}

/** 24x24 stroke paths, one family, drawn by `StudyDoors`. */
const DOOR_ICONS = {
  review: "M4 6.5h16M4 12h16M4 17.5h10",
  practice: "M5 4.5h11l3 3v12H5z M16 4.5v3h3",
  pastPaper: "M6 3.5h9l4 4v13H6z M9 12h7M9 16h5",
  folders: "M3.5 7a2 2 0 012-2h3.3l2 2h7.7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z",
} as const;

export default function DashboardHome() {
  const { user } = useUser();
  const tutorial = useTutorial();
  const firstNight = useFirstNight();

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
  const { feedback, success, showError, clear: clearFeedback } = useFeedback();
  const [inAppUsername, setInAppUsername] = useState<string | null>(null);
  const [completedMission, setCompletedMission] = useState<MissionHandoff | null>(null);
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

  const studyActions = useStudyActions(
    user.uid,
    featureFlags.enableLearnerProfile && featureFlags.enableStudyActions
  );
  const refreshStudyActions = studyActions.refresh;

  /*
   * Did they just come back from doing what the page asked?
   *
   * Read once, on arrival, and cleared as it is read -- the moment belongs to
   * the return journey. Nothing depends on it being there, so a browser that
   * refuses the storage simply gets the ordinary page.
   *
   * Finding one forces a recalculation rather than serving what is cached.
   * Both caches would otherwise hand back the answer from before the student
   * did the work -- the recommendations for five minutes, the snapshot for its
   * own window -- so Jami would acknowledge the session and then, in the same
   * breath, suggest it again. That is the worst thing this surface could do:
   * it would demonstrate that the loop is not really closed.
   */
  useEffect(() => {
    const completed = takeCompletedMission();
    if (!completed) return;
    setCompletedMission(completed);
    void loadAll(user.uid, { force: true });
    void refreshStudyActions();
  }, [loadAll, refreshStudyActions, user.uid]);

  /*
   * The plan is resolved against the same actions the rest of the page draws
   * on, so it can never disagree with them -- it is the same answer, arranged
   * on the student's own week.
   */
  const revisionPlan = useRevisionPlanToday({
    uid: user.uid,
    enabled: featureFlags.enableRevisionPlans,
    actions: studyActions.actions,
    folders: studyActions.folders,
    cards,
    decks,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    clearFeedback();
    try {
      await Promise.all([loadAll(user.uid, { force: true }), refreshStudyActions()]);
    } finally {
      setRefreshing(false);
    }
  }, [clearFeedback, loadAll, refreshStudyActions, user.uid]);

  const todayReviews = useMemo(() => countTodayReviews(studyActivity), [studyActivity]);
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
        studyActions: studyActions.actions,
        studyActionFolders: studyActions.folders,
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
      studyActions.actions,
      studyActions.folders,
      studyFolders,
      todayReviews,
      topics,
    ]
  );

  const folderName = useCallback(
    (folderId: string) =>
      studyActions.folders.find((folder) => folder.id === folderId)?.name ??
      studyFolders.find((folder) => folder.id === folderId)?.name ??
      "Flashcards",
    [studyActions.folders, studyFolders]
  );

  const material = useInterventionMaterial({ uid: user.uid, decks, folderName });
  const startMaterial = material.start;

  const mission = useMemo(
    () =>
      buildTodayMission({
        nextAction: todayPlan.nextAction,
        studyActions: todayPlan.studyActions,
      }),
    [todayPlan.nextAction, todayPlan.studyActions]
  );

  const isEmptyAccount = shouldInviteToTutorial({
    isLoading,
    sectionStates: {
      decks: sectionStates.decks,
      cards: sectionStates.cards,
      activity: sectionStates.activity,
      folders: sectionStates.folders,
      notebooks: sectionStates.notebooks,
    },
    deckCount: decks.length,
    cardCount: cards.length,
    activityCount: studyActivity.length,
    folderCount: studyFolders.length,
    notebookCount: notebooks.length,
  });

  // A brand-new account opens straight into First night, once, if it has never run.
  const firstNightNeverRan = firstNight.ready && !firstNight.state;
  useEffect(() => {
    if (isEmptyAccount && firstNightNeverRan && tutorial.canInvite) {
      tutorial.invite();
    }
  }, [firstNightNeverRan, isEmptyAccount, tutorial]);

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
  const planUnavailable = planSections.some((section) => sectionStates[section] === "unavailable");

  /*
   * The doors, and only the ones that lead somewhere.
   *
   * Past Paper Practice needs a folder with a course behind it; offering it to
   * a student who has none would be a door onto a wall.
   */
  const examFolder = useMemo(
    () => studyFolders.find((folder) => !folder.archived && folder.examCourse),
    [studyFolders]
  );
  const doors = useMemo<StudyDoor[]>(() => {
    const entries: StudyDoor[] = [
      {
        label: "Review",
        detail: "Cards that are due for retrieval.",
        href: getCustomStudyHref({ mode: "daily" }),
        icon: DOOR_ICONS.review,
      },
      {
        label: "Practice",
        detail: "Notebooks and papers to work in.",
        href: "/dashboard/practice",
        icon: DOOR_ICONS.practice,
      },
    ];
    if (featureFlags.enablePastPaperPractice && examFolder) {
      entries.push({
        label: "Past papers",
        detail: "Real exam questions, one at a time.",
        href: getQuestionPracticeSetupHref({ folderId: examFolder.id }),
        icon: DOOR_ICONS.pastPaper,
      });
    }
    entries.push({
      label: "Your folders",
      detail: "Everything you have, by subject.",
      href: "/dashboard/folders",
      icon: DOOR_ICONS.folders,
    });
    return entries;
  }, [examFolder]);

  const momentumWeek = useMemo(() => buildMomentumWeek(studyActivity), [studyActivity]);

  /** The engine's other advice: the mission's own recommendation is not repeated. */
  const remainingActions = useMemo(
    () => todayPlan.studyActions.filter((action) => action.id !== mission.action?.id),
    [mission.action?.id, todayPlan.studyActions]
  );

  const recordMissionStart = useCallback(() => {
    if (mission.action) {
      noteStudyActionEvent(user.uid, mission.action, "started", getStudyDayKey());
      noteMissionStarted({
        actionId: mission.action.id,
        headline: mission.headline,
        conceptLabel: mission.action.target.label,
        ...(mission.action.targetItems !== undefined
          ? { targetItems: mission.action.targetItems }
          : {}),
      });
      return;
    }
    if (todayPlan.nextAction.type === "review_due_cards") {
      noteMissionStarted({
        actionId: DAILY_REVIEW_MISSION_ID,
        headline: mission.headline,
        conceptLabel: "Your due cards",
        targetItems: todayPlan.dueCards.count,
      });
    }
  }, [mission, todayPlan.dueCards.count, todayPlan.nextAction.type, user.uid]);

  const handleGenerate = useCallback(
    (action: TodayStudyAction) => {
      void startMaterial(action);
    },
    [startMaterial]
  );

  const secondaryCount =
    remainingActions.length +
    Number(sectionStates.drafts !== "unavailable" && todayPlan.drafts.length > 0) +
    Number(
      sectionStates.topics !== "unavailable" &&
        sectionStates.mastery !== "unavailable" &&
        todayPlan.weakTopics.length > 0
    ) +
    Number(sectionStates.goals !== "unavailable" && Boolean(todayPlan.goalSummary)) +
    Number(sectionStates.dailyReview !== "unavailable" && remainingOptionalCount > 0);

  /*
   * The finished mission, worded. Held until the page is left rather than
   * timed out: it sits above the next recommendation as context for it, and
   * something that vanished mid-read would be worse than something that stays.
   */
  const completionCopy = useMemo(
    () =>
      completedMission
        ? missionCompletionCopy({
            conceptLabel: completedMission.conceptLabel,
            answered: completedMission.answered ?? 0,
            ...(completedMission.targetItems !== undefined
              ? { targetItems: completedMission.targetItems }
              : {}),
          })
        : undefined,
    [completedMission]
  );

  const missionBusy = material.generatingId !== null;
  const generatingMission = Boolean(mission.action && material.generatingId === mission.action.id);

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Today"
        width="2xl"
        action={<RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />}
        contentClassName="space-y-6 sm:space-y-8"
      >
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => clearFeedback()}
          />
        ) : null}
        {material.error ? (
          <FeedbackBanner type="error" message={material.error} onDismiss={material.dismissError} />
        ) : null}

        {material.confirmed ? (
          <MaterialReady
            kind={material.confirmed.kind}
            created={material.confirmed.created}
            conceptLabel={material.confirmed.conceptLabel}
            href={material.confirmed.href}
            onDismiss={material.dismissConfirmation}
          />
        ) : null}

        <header className="pt-1">
          {/*
            A greeting, not a heading: the top bar already carries this page's
            only h1, and a second one would leave a screen reader with two
            titles for the same page.
          */}
          <p className="text-xl font-medium tracking-[-0.01em] text-text-primary sm:text-2xl">
            {greeting()}
            {inAppUsername ? `, ${inAppUsername}` : ""}.
          </p>
          <p className="mt-1.5 text-sm text-text-muted">
            {isLoading
              ? "Getting today ready."
              : planUnavailable
                ? "Some of your study data could not be read just now."
                : hubSubline({
                    hasMission: !isLoading,
                    extraActions: remainingActions.length,
                  })}
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-5">
          {isLoading ? (
            <Skeleton className="h-[21rem] rounded-2xl" />
          ) : planUnavailable ? (
            <MissionCard
              tone="plain"
              eyebrow="Today"
              headline="Your study plan is temporarily unavailable."
              summary="Refresh in a moment. Jami will not treat missing data as an empty study list."
              /*
               * The acknowledgement survives a failed read.
               *
               * They did the work; not being able to read their profile is
               * Jami's problem, not a reason to act as though the session
               * never happened. What is lost is only the recommendation that
               * would have followed it.
               */
              {...(completionCopy ? { completion: completionCopy } : {})}
              action={
                <Button type="button" onClick={() => void handleRefresh()} size="lg">
                  Try again
                </Button>
              }
            />
          ) : (
            <MissionCard
              tone={mission.action ? "engine" : "plain"}
              eyebrow={mission.eyebrow}
              headline={mission.headline}
              summary={mission.summary}
              {...(completionCopy ? { completion: completionCopy } : {})}
              bodyKey={mission.action?.id ?? mission.headline}
              {...(mission.folderName ? { context: mission.folderName } : {})}
              facts={
                mission.effort
                  ? [mission.effort.items, mission.effort.minutes].filter(
                      (fact): fact is string => Boolean(fact)
                    )
                  : []
              }
              explanation={mission.explanation}
              action={
                mission.generate && mission.action ? (
                  <Button
                    type="button"
                    size="lg"
                    disabled={missionBusy}
                    onClick={() => handleGenerate(mission.action as TodayStudyAction)}
                  >
                    {generatingMission ? "Writing…" : mission.actionLabel}
                  </Button>
                ) : (
                  <ButtonLink href={mission.href} size="lg" onClick={recordMissionStart}>
                    {mission.actionLabel}
                  </ButtonLink>
                )
              }
              secondaryAction={
                mission.secondary ? (
                  <ButtonLink href={mission.secondary.href} variant="secondary" size="lg">
                    {mission.secondary.label}
                  </ButtonLink>
                ) : null
              }
            />
          )}

          <aside className="grid content-start gap-4">
            {isLoading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : (
              <MomentumStrip
                week={momentumWeek}
                unavailable={sectionStates.activity === "unavailable"}
              />
            )}
            {!isLoading && revisionPlan.plan && revisionPlan.day ? (
              <PlanSummary
                day={revisionPlan.day}
                planHref={getRevisionPlanHref()}
                scopeName={(slot) => revisionPlan.scopeNames.get(slot.scopeKey)}
              />
            ) : null}
          </aside>
        </div>

        {/*
          * The doors do not wait on the student's data, and must not.
          *
          * They were gated on the same check as the mission at first, which
          * meant a failed read took away both the recommendation *and* every
          * way in -- leaving a student looking at an apology with nothing to
          * press. Nothing here needs the profile: they are four places that
          * exist whether or not Jami could read anything today.
          */}
        {!isLoading ? (
          <section className="space-y-3">
            <h2 className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Or study your way
            </h2>
            <StudyDoors doors={doors} />
          </section>
        ) : null}

        <TutorialResumeCard />
        <FirstNightPanel />

        {!isLoading && !planUnavailable ? (
          <MoreForToday count={secondaryCount}>
            {remainingActions.length > 0 ? (
              <StudyActionsCard
                actions={remainingActions}
                uid={user.uid}
                onGenerate={handleGenerate}
                generatingId={material.generatingId}
              />
            ) : null}
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
            {sectionStates.dailyReview !== "unavailable" && remainingOptionalCount > 0 ? (
              <StatTile
                label="Easy extras"
                value={remainingOptionalCount}
                detail="Daily Review is clear, but these lighter passes are still available."
                href={getCustomStudyHref({ mode: "daily" })}
              />
            ) : null}
          </MoreForToday>
        ) : null}

        <InterventionDraftReview
          draft={material.draft}
          saving={material.saving}
          onCancel={material.cancel}
          onConfirm={material.confirm}
        />
      </AppPage>
    </Refreshable>
  );
}
