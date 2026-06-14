"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useUser } from "@/lib/auth/user-context";
import { featureFlags } from "@/lib/app/feature-flags";
import { getCustomStudyHref, getDeckStudyHref } from "@/lib/app/routes";
import { db } from "@/services/firebase/client";
import { buildTopicProgress } from "@/lib/practice/progress";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Source } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import { buildSpacedRepetitionAnalytics } from "@/lib/study/analytics";
import { computeStudyStreak, type DailyStudyActivity } from "@/lib/study/activity";
import type { Card as StudyCard } from "@/lib/study/cards";
import { normalizeGoal, type Goal } from "@/lib/study/goals";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import {
  buildAccuracySeries,
  buildStudyTimeSeries,
  buildWorkspaceActivitySummary,
  countStudyActiveDays,
  filterStudyActivityByRange,
  getAverageReviewsPerActiveDay,
  getAverageStudySessionMinutes,
  getPercentage,
  getStudyAccuracy,
  PROGRESS_TIME_RANGE_OPTIONS,
  type ProgressTimeRange,
} from "@/lib/study/progress-statistics";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { ensureStudyStateSetup, loadUserCards } from "@/services/study/daily-review";
import { getGeneratedContentDrafts, type GeneratedContentDraft } from "@/services/study/generated-content";
import { getMasteryEvents } from "@/services/study/mastery";
import { loadStudyActivity } from "@/services/study/activity";
import { getDecks, type Deck } from "@/services/study/decks";
import { getActiveSources } from "@/services/study/sources";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import AppPage from "@/components/layout/AppPage";
import { RetentionHealthPanel, ScheduleForecastPanel } from "@/components/stats/AnalyticsPanels";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  FeedbackBanner,
  MetricStrip,
  PageHero,
  ProgressBar,
  SectionHeader,
  Skeleton,
  StatTile,
  StudyText,
} from "@/components/ui";

type Feedback = { type: "success" | "error"; message: string };
const PROGRESS_VISITED_KEY = "jami:progress-visited";

function formatTooltipNumber(value: unknown, suffix = "") {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}${suffix}`;
  }
  if (typeof value === "string" && value.trim()) {
    return `${value}${suffix}`;
  }
  return `0${suffix}`;
}

function formatDueStatus(card: StudyCard, now = Date.now()) {
  if (typeof card.dueDate !== "number") {
    return "Not scheduled";
  }
  if (card.dueDate <= now) {
    const days = Math.max(1, Math.ceil((now - card.dueDate) / 86_400_000));
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }

  const days = Math.max(1, Math.ceil((card.dueDate - now) / 86_400_000));
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

function HeroMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="app-chip rounded-[1rem] px-3 py-3 text-center">
      <div className="text-lg font-semibold tabular-nums text-text-primary sm:text-xl">
        {value}
      </div>
      <div className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
    </div>
  );
}

export default function ProgressPage() {
  const { user } = useUser();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [masteryEvents, setMasteryEvents] = useState<MasteryEvent[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [studyFolders, setStudyFolders] = useState<StudyFolder[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [studyActivity, setStudyActivity] = useState<DailyStudyActivity[]>([]);
  const [range, setRange] = useState<ProgressTimeRange>("30d");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_VISITED_KEY, "true");
    } catch {
      // Local dashboard checklist only.
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFeedback(null);
      try {
        await ensureStudyStateSetup(user.uid);
        const [
          nextTopics,
          nextCards,
          nextMasteryEvents,
          nextDrafts,
          nextSources,
          nextStudyFolders,
          nextNotebooks,
          nextDecks,
          nextStudyActivity,
          goalsSnapshot,
        ] = await Promise.all([
          getActiveTopics(user.uid),
          loadUserCards(user.uid),
          getMasteryEvents(user.uid),
          getGeneratedContentDrafts(user.uid).catch(() => [] as GeneratedContentDraft[]),
          getActiveSources(user.uid).catch(() => [] as Source[]),
          getActiveStudyFolders(user.uid).catch(() => [] as StudyFolder[]),
          getActiveNotebooks(user.uid).catch(() => [] as Notebook[]),
          getDecks(user.uid).catch(() => [] as Deck[]),
          loadStudyActivity(user.uid).catch(() => [] as DailyStudyActivity[]),
          getDocs(collection(db, "users", user.uid, "goals")).catch(() => null),
        ]);

        if (!cancelled) {
          setTopics(nextTopics);
          setCards(nextCards);
          setMasteryEvents(nextMasteryEvents);
          setDrafts(nextDrafts);
          setSources(nextSources);
          setStudyFolders(nextStudyFolders);
          setNotebooks(nextNotebooks);
          setDecks(nextDecks);
          setStudyActivity(nextStudyActivity);
          setGoals(
            goalsSnapshot
              ? goalsSnapshot.docs.map((goalDoc) =>
                  normalizeGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
                )
              : []
          );
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setFeedback({ type: "error", message: "Failed to load Progress." });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  const topicProgress = useMemo(
    () => buildTopicProgress({ topics, cards, masteryEvents, sources, studyFolders, notebooks }),
    [cards, masteryEvents, notebooks, sources, studyFolders, topics]
  );
  const weakTopics = topicProgress.slice(0, 5);
  const deckNamesById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );
  const analytics = useMemo(
    () => buildSpacedRepetitionAnalytics(cards, studyActivity, deckNamesById),
    [cards, deckNamesById, studyActivity]
  );
  const last7Activity = useMemo(
    () => filterStudyActivityByRange(studyActivity, "7d"),
    [studyActivity]
  );
  const last30Activity = useMemo(
    () => filterStudyActivityByRange(studyActivity, "30d"),
    [studyActivity]
  );
  const selectedActivity = useMemo(
    () => filterStudyActivityByRange(studyActivity, range),
    [range, studyActivity]
  );
  const accuracyData = useMemo(
    () => buildAccuracySeries(studyActivity, range),
    [range, studyActivity]
  );
  const studyTimeData = useMemo(
    () => buildStudyTimeSeries(studyActivity, range),
    [range, studyActivity]
  );
  const currentStreak = useMemo(
    () => computeStudyStreak(studyActivity),
    [studyActivity]
  );
  const reviewedThisWeek = useMemo(
    () => last7Activity.reduce((sum, entry) => sum + entry.reviewCount, 0),
    [last7Activity]
  );
  const workspace = useMemo(
    () => buildWorkspaceActivitySummary({ notebooks, sources, drafts, goals }),
    [drafts, goals, notebooks, sources]
  );
  const deckHealth = useMemo(() => {
    const now = Date.now();
    return decks
      .map((deck) => {
        const deckCards = cards.filter((card) => card.deckId === deck.id);
        const risks = deckCards.map((card) => getMemoryRiskInfo(card, now));
        return {
          deck,
          cardCount: deckCards.length,
          weakCount: risks.filter((risk) => risk.tier === "high").length,
          dueCount: deckCards.filter(
            (card) => typeof card.dueDate === "number" && card.dueDate <= now
          ).length,
          averageRisk:
            risks.length > 0
              ? risks.reduce((sum, risk) => sum + risk.score, 0) / risks.length
              : 0,
        };
      })
      .filter((summary) => summary.cardCount > 0)
      .sort((left, right) => right.averageRisk - left.averageRisk);
  }, [cards, decks]);
  const hardestCards = useMemo(() => {
    const now = Date.now();
    return cards
      .map((card) => ({ card, risk: getMemoryRiskInfo(card, now) }))
      .filter(({ card }) => (card.reps ?? 0) > 0)
      .sort((left, right) => right.risk.score - left.risk.score)
      .slice(0, 5);
  }, [cards]);

  const selectedHasReviews = selectedActivity.some((entry) => entry.reviewCount > 0);
  const selectedHasTime = selectedActivity.some((entry) => entry.totalDurationMs > 0);
  const reviewedCoverage = getPercentage(analytics.reviewedCards, analytics.totalCards);
  const dueToday = analytics.dueForecast7d[0]?.dueCount ?? 0;

  if (!featureFlags.enableMasteryProgress) {
    return (
      <AppPage title="Progress" backHref="/dashboard" backLabel="Today">
        <EmptyState
          emoji="Progress"
          eyebrow="Not enabled"
          title="Progress is behind a feature flag"
          description="Enable mastery progress after topics and notebooks are ready."
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Progress"
      backHref="/dashboard"
      backLabel="Today"
      width="3xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <PageHero
        eyebrow="Progress"
        title="Your study picture"
        description="Review consistency, memory health, workload, and workspace activity in one place."
        tone="warm"
        aside={
          <div className="grid w-full grid-cols-2 gap-2 sm:min-w-[24rem] sm:grid-cols-4">
            <HeroMetric label="Reviews 7d" value={loading ? "..." : reviewedThisWeek} />
            <HeroMetric label="Streak" value={loading ? "..." : `${currentStreak}d`} />
            <HeroMetric
              label="Accuracy 30d"
              value={loading ? "..." : `${getStudyAccuracy(last30Activity)}%`}
            />
            <HeroMetric
              label="Active 30d"
              value={loading ? "..." : countStudyActiveDays(last30Activity)}
            />
          </div>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : (
        <>
          <Card padding="sm" tone="subtle">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-text-primary">Chart range</div>
                <div className="mt-1 text-xs text-text-muted">
                  Change the time window without changing the rest of your dashboard.
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto" aria-label="Statistics time range">
                {PROGRESS_TIME_RANGE_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={range === option.value ? "warm" : "ghost"}
                    aria-pressed={range === option.value}
                    onClick={() => setRange(option.value)}
                    className="shrink-0"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card padding="md">
              <SectionHeader
                title="Accuracy"
                description="Recall accuracy across the selected range."
              />
              <div
                className="mt-4 h-64 w-full"
                role="img"
                aria-label={`Accuracy chart for ${PROGRESS_TIME_RANGE_OPTIONS.find((option) => option.value === range)?.label}`}
              >
                {selectedHasReviews ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={accuracyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(value: number) => `${value}%`} />
                      <Tooltip formatter={(value: unknown) => [formatTooltipNumber(value, "%"), "Accuracy"]} />
                      <Line
                        type="monotone"
                        dataKey="accuracy"
                        stroke="var(--color-accent)"
                        strokeWidth={2.5}
                        dot={range === "7d"}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      variant="plain"
                      emoji="Stats"
                      title="No reviews in this range"
                      description="Accuracy will appear after you review some cards."
                    />
                  </div>
                )}
              </div>
            </Card>

            <Card padding="md">
              <SectionHeader
                title="Study time"
                description="Minutes spent in completed study sessions."
              />
              <div
                className="mt-4 h-64 w-full"
                role="img"
                aria-label={`Study time chart for ${PROGRESS_TIME_RANGE_OPTIONS.find((option) => option.value === range)?.label}`}
              >
                {selectedHasTime ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={studyTimeData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(value: number) => `${value}m`} />
                      <Tooltip formatter={(value: unknown) => [formatTooltipNumber(value, " min"), "Time"]} />
                      <Bar dataKey="minutes" fill="var(--color-accent)" radius={[7, 7, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      variant="plain"
                      emoji="Time"
                      title="No study time in this range"
                      description="Completed sessions will build this chart."
                    />
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <Card padding="md">
              <SectionHeader
                title="Due workload"
                description="The current card load and how much of your library has review history."
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <StatTile compact label="Due today" value={dueToday} />
                <StatTile compact label="Overdue" value={analytics.retentionSummary.overdue} />
                <StatTile compact label="Due next 7" value={analytics.dueIn7Days} />
                <StatTile compact label="Reviewed" value={`${reviewedCoverage}%`} />
              </div>
              {analytics.retentionSummary.overdue > 0 ? (
                <ButtonLink
                  href={getCustomStudyHref({ mode: "daily" })}
                  size="sm"
                  variant="ghost"
                  className="mt-4"
                >
                  Review weak cards
                </ButtonLink>
              ) : null}
            </Card>
            <ScheduleForecastPanel analytics={analytics} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
            <RetentionHealthPanel analytics={analytics} compact />
            <Card padding="md">
              <SectionHeader
                title="Hardest cards"
                description="Cards carrying the strongest current memory-risk signal."
              />
              <div className="mt-4 space-y-2">
                {hardestCards.length > 0 ? (
                  hardestCards.map(({ card, risk }) => (
                    <div key={card.id} className="app-subtle-panel rounded-[1.1rem] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <StudyText
                            as="div"
                            text={card.front}
                            className="truncate text-sm font-semibold text-text-primary"
                          />
                          <div className="mt-1 text-xs text-text-muted">
                            {deckNamesById[card.deckId] ?? "Unknown deck"} · {formatDueStatus(card)}
                          </div>
                        </div>
                        <span className="app-selected shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold">
                          {risk.label}
                        </span>
                      </div>
                      <ButtonLink
                        href={getDeckStudyHref(card.deckId)}
                        size="sm"
                        variant="ghost"
                        className="mt-2"
                      >
                        Open deck
                      </ButtonLink>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    variant="plain"
                    emoji="Cards"
                    title="No hard cards yet"
                    description="Difficulty statistics appear after cards have review history."
                  />
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card padding="md">
              <SectionHeader
                title="Weak topics"
                description="Topics with the greatest mix of weak, due, and low-mastery cards."
              />
              <div className="mt-4 space-y-3">
                {weakTopics.length > 0 ? (
                  weakTopics.map((summary) => {
                    const stability =
                      summary.cardCount > 0
                        ? Math.max(0, 100 - summary.weakCardCount * 20)
                        : 0;
                    return (
                      <div key={summary.topic.id} className="app-subtle-panel rounded-[1.15rem] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-text-primary">
                              {summary.topic.name}
                            </div>
                            <div className="mt-1 text-xs text-text-muted">
                              {summary.cardCount} cards · {summary.weakCardCount} weak · {summary.dueCardCount} due
                            </div>
                          </div>
                          <span className="app-chip shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold">
                            {summary.masteryScore}
                          </span>
                        </div>
                        <ProgressBar progress={stability} className="mt-3" />
                        <div className="mt-2 flex flex-wrap gap-1">
                          <ButtonLink
                            href={`/dashboard/folders?topic=${encodeURIComponent(summary.topic.id)}`}
                            size="sm"
                            variant="ghost"
                          >
                            Open topic
                          </ButtonLink>
                          <ButtonLink
                            href={getCustomStudyHref({ mode: "custom", tags: [summary.topic.name] })}
                            size="sm"
                            variant="ghost"
                          >
                            Review cards
                          </ButtonLink>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <EmptyState
                    variant="plain"
                    emoji="Topics"
                    title="No weak topics yet"
                    description="Linked topics and review history will build this comparison."
                  />
                )}
              </div>
            </Card>

            <Card padding="md">
              <SectionHeader
                title="Deck health"
                description="A risk-based comparison of decks with reviewed cards."
              />
              <div className="mt-4 space-y-3">
                {deckHealth.length > 0 ? (
                  deckHealth.slice(0, 6).map((summary) => (
                    <div key={summary.deck.id} className="app-subtle-panel rounded-[1.15rem] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-text-primary">
                            {summary.deck.name}
                          </div>
                          <div className="mt-1 text-xs text-text-muted">
                            {summary.cardCount} cards · {summary.weakCount} high risk · {summary.dueCount} due
                          </div>
                        </div>
                        <span className="app-chip shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold">
                          {Math.round(summary.averageRisk)}
                        </span>
                      </div>
                      <ButtonLink
                        href={getDeckStudyHref(summary.deck.id)}
                        size="sm"
                        variant="ghost"
                        className="mt-2"
                      >
                        Open deck
                      </ButtonLink>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    variant="plain"
                    emoji="Decks"
                    title="No deck health data yet"
                    description="Review cards in a deck to reveal its memory-risk pattern."
                  />
                )}
              </div>
            </Card>
          </div>

          <Card padding="md">
            <SectionHeader
              title="Workspace activity"
              description="High-level activity only; your actual notebook and draft content stays in its workspace."
            />
            <MetricStrip
              variant="full"
              className="mt-4"
              items={[
                { label: "Notebooks", value: workspace.notebookCount },
                { label: "Edited 30d", value: workspace.recentlyEditedNotebookCount },
                { label: "Sources", value: workspace.sourceCount },
                {
                  label: "Drafts waiting",
                  value: workspace.waitingDraftCount,
                  tone: workspace.waitingDraftCount > 0 ? "warm" : "good",
                },
                { label: "Active goals", value: workspace.activeGoalCount },
                { label: "Completed goals", value: workspace.completedGoalCount, tone: "good" },
                {
                  label: "Avg session",
                  value: `${getAverageStudySessionMinutes(last30Activity)}m`,
                },
                {
                  label: "Reviews / active day",
                  value: getAverageReviewsPerActiveDay(last30Activity),
                },
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href="/dashboard/folders" size="sm" variant="ghost">
                Open folders
              </ButtonLink>
              <ButtonLink href="/dashboard/library" size="sm" variant="ghost">
                Open library
              </ButtonLink>
              <ButtonLink href="/dashboard/goals" size="sm" variant="ghost">
                Open goals
              </ButtonLink>
            </div>
          </Card>
        </>
      )}
    </AppPage>
  );
}
