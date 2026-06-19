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
import type { Source } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import { buildSpacedRepetitionAnalytics } from "@/lib/study/analytics";
import { computeStudyStreak, type DailyStudyActivity } from "@/lib/study/activity";
import type { Card as StudyCard } from "@/lib/study/cards";
import { getStudyDayWindow } from "@/lib/study/day";
import { normalizeGoal, type Goal } from "@/lib/study/goals";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import {
  buildAccuracySeries,
  buildStudyTimeSeries,
  buildWorkspaceActivitySummary,
  countStudyActiveDays,
  filterStudyActivityByRange,
  getStudyAccuracy,
  PROGRESS_TIME_RANGE_OPTIONS,
  type ProgressTimeRange,
} from "@/lib/study/progress-statistics";
import type { Notebook } from "@/lib/workspace/notebooks";
import { ensureStudyStateSetup, loadUserCards } from "@/services/study/daily-review";
import { getGeneratedContentDrafts, type GeneratedContentDraft } from "@/services/study/generated-content";
import { loadStudyActivity } from "@/services/study/activity";
import { getDecks, type Deck } from "@/services/study/decks";
import { getActiveSources } from "@/services/study/sources";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import AppPage from "@/components/layout/AppPage";
import { ScheduleForecastPanel } from "@/components/stats/AnalyticsPanels";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  FeedbackBanner,
  PageHero,
  SectionHeader,
  Skeleton,
  StatTile,
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
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
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
          nextCards,
          nextDrafts,
          nextSources,
          nextNotebooks,
          nextDecks,
          nextTopics,
          nextStudyActivity,
          goalsSnapshot,
        ] = await Promise.all([
          loadUserCards(user.uid),
          getGeneratedContentDrafts(user.uid).catch(() => [] as GeneratedContentDraft[]),
          getActiveSources(user.uid).catch(() => [] as Source[]),
          getActiveNotebooks(user.uid).catch(() => [] as Notebook[]),
          getDecks(user.uid).catch(() => [] as Deck[]),
          getActiveTopics(user.uid).catch(() => [] as Topic[]),
          loadStudyActivity(user.uid).catch(() => [] as DailyStudyActivity[]),
          getDocs(collection(db, "users", user.uid, "goals")).catch(() => null),
        ]);

        if (!cancelled) {
          setCards(nextCards);
          setDrafts(nextDrafts);
          setSources(nextSources);
          setNotebooks(nextNotebooks);
          setDecks(nextDecks);
          setTopics(nextTopics);
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

  const deckNamesById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );
  const topicNamesById = useMemo(
    () => Object.fromEntries(topics.map((topic) => [topic.id, topic.name])),
    [topics]
  );
  const analytics = useMemo(
    () =>
      buildSpacedRepetitionAnalytics(
        cards,
        studyActivity,
        deckNamesById,
        undefined,
        topicNamesById
      ),
    [cards, deckNamesById, studyActivity, topicNamesById]
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
    const currentStudyDayStart = getStudyDayWindow(now).start;
    return decks
      .map((deck) => {
        const deckCards = cards.filter((card) => card.deckId === deck.id);
        const risks = deckCards.map((card) => getMemoryRiskInfo(card, now));
        const weakCount = risks.filter((risk) => risk.tier === "high").length;
        const dueCount = deckCards.filter(
          (card) => typeof card.dueDate === "number" && card.dueDate <= now
        ).length;
        const overdueCount = deckCards.filter(
          (card) =>
            typeof card.dueDate === "number" &&
            card.dueDate < currentStudyDayStart
        ).length;
        const holdingCount = risks.filter((risk) => risk.tier === "low").length;
        const holdingPercent =
          deckCards.length > 0
            ? Math.round((holdingCount / deckCards.length) * 100)
            : 0;
        const weakPercent =
          deckCards.length > 0
            ? Math.round((weakCount / deckCards.length) * 100)
            : 0;
        const status: "attention" | "review" | "healthy" =
          overdueCount > 0 || weakPercent >= 25
            ? "attention"
            : dueCount > 0 || weakCount > 0
              ? "review"
              : "healthy";

        return {
          deck,
          cardCount: deckCards.length,
          weakCount,
          dueCount,
          overdueCount,
          holdingPercent,
          status,
        };
      })
      .filter((summary) => summary.cardCount > 0)
      .sort((left, right) => {
        const priority = { attention: 2, review: 1, healthy: 0 };
        return (
          priority[right.status] - priority[left.status] ||
          right.overdueCount - left.overdueCount ||
          right.dueCount - left.dueCount ||
          left.holdingPercent - right.holdingPercent
        );
      });
  }, [cards, decks]);
  const decksNeedingReview = deckHealth.filter(
    (summary) => summary.status !== "healthy"
  ).length;
  const selectedHasReviews = selectedActivity.some((entry) => entry.reviewCount > 0);
  const selectedHasTime = selectedActivity.some((entry) => entry.totalDurationMs > 0);
  const cardsDue = cards.filter(
    (card) => typeof card.dueDate === "number" && card.dueDate <= Date.now()
  ).length;

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
          <section aria-labelledby="progress-charts-heading">
            <Card padding="md">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 id="progress-charts-heading" className="text-lg font-semibold text-text-primary">
                    Study trends
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
                    Accuracy and study time across the same selected range.
                  </p>
                </div>
                <div className="flex gap-2 overflow-x-auto sm:justify-end" aria-label="Statistics time range">
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

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <div className="rounded-[1.25rem] border border-border/70 bg-surface-subtle/55 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">Accuracy</h3>
                    <p className="mt-1 text-xs text-text-muted">
                      Recall accuracy across this range.
                    </p>
                  </div>
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
                </div>

                <div className="rounded-[1.25rem] border border-border/70 bg-surface-subtle/55 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">Study time</h3>
                    <p className="mt-1 text-xs text-text-muted">
                      Minutes spent in completed study sessions.
                    </p>
                  </div>
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
                </div>
              </div>
            </Card>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <Card padding="md">
              <SectionHeader
                title="Due workload"
                description="Cards ready to review now, with the overdue portion shown separately."
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <StatTile compact label="Cards due" value={cardsDue} />
                <StatTile
                  compact
                  label="Overdue cards"
                  value={analytics.retentionSummary.overdue}
                />
              </div>
              {cardsDue > 0 ? (
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

          <Card padding="md">
              <SectionHeader
                title="Deck health"
                description="See which decks are holding up well and which have cards ready or overdue."
              />
              {deckHealth.length > 0 ? (
                <div className="app-chip mt-4 inline-flex rounded-full px-3 py-1.5 text-xs font-semibold">
                  {decksNeedingReview === 0
                    ? "All decks are up to date"
                    : `${decksNeedingReview} of ${deckHealth.length} deck${deckHealth.length === 1 ? "" : "s"} need review`}
                </div>
              ) : null}
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
                            {summary.dueCount} due
                            <span aria-hidden="true"> / </span>
                            {summary.overdueCount} overdue
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            summary.status === "healthy"
                              ? "border-success/35 bg-success-muted text-[var(--color-success-text)]"
                              : summary.status === "attention"
                                ? "border-error/35 bg-error-muted text-[var(--color-error-text)]"
                                : "app-selected"
                          }`}
                        >
                          {summary.status === "healthy"
                            ? "Healthy"
                            : summary.status === "attention"
                              ? "Needs attention"
                              : "Needs review"}
                        </span>
                      </div>
                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                          <span className="text-text-muted">Cards holding well</span>
                          <span className="font-semibold tabular-nums text-text-primary">
                            {summary.holdingPercent}%
                          </span>
                        </div>
                        <div
                          className="h-2 overflow-hidden rounded-full bg-glass-medium"
                          role="progressbar"
                          aria-label={`${summary.deck.name} cards holding well`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={summary.holdingPercent}
                        >
                          <div
                            className="h-full rounded-full bg-success transition-all duration-slow"
                            style={{ width: `${summary.holdingPercent}%` }}
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-text-muted">
                          {summary.cardCount} card{summary.cardCount === 1 ? "" : "s"} total
                        </span>
                        <ButtonLink
                          href={getDeckStudyHref(summary.deck.id)}
                          size="sm"
                          variant="ghost"
                        >
                          Open deck
                        </ButtonLink>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    variant="plain"
                    emoji="Decks"
                    title="No deck health data yet"
                    description="Add cards to a deck and start reviewing to see how it is doing."
                  />
                )}
              </div>
          </Card>

          <Card padding="sm" tone="subtle">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">Your workspace</div>
                <p className="mt-1 text-xs text-text-muted">
                  A quick count of what you are currently working with.
                </p>
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:max-w-3xl">
                {[
                  { label: "Notebooks", value: workspace.notebookCount },
                  { label: "Sources", value: workspace.sourceCount },
                  { label: "Drafts waiting", value: workspace.waitingDraftCount },
                  { label: "Active goals", value: workspace.activeGoalCount },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="app-chip flex min-w-0 items-center justify-between gap-3 rounded-[1rem] px-3 py-2.5"
                  >
                    <div className="min-w-0 text-xs font-semibold text-text-muted">
                      {item.label}
                    </div>
                    <div className="shrink-0 text-base font-semibold tabular-nums text-text-primary">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
              <ButtonLink
                href="/dashboard/folders"
                size="sm"
                variant="ghost"
                className="shrink-0"
              >
                Open workspace
              </ButtonLink>
            </div>
          </Card>
        </>
      )}
    </AppPage>
  );
}
