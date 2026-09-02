"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { featureFlags } from "@/lib/app/feature-flags";
import { getCustomStudyHref, getDeckStudyHref } from "@/lib/app/routes";
import type { Topic } from "@/lib/material/topics";
import { buildSpacedRepetitionAnalytics } from "@/lib/study/analytics";
import { computeStudyStreak, type DailyStudyActivity } from "@/lib/study/activity";
import type { Card as StudyCard } from "@/lib/study/cards";
import { isCardDue } from "@/lib/study/daily-review";
import { getStudyDayWindow } from "@/lib/study/day";
import type { Deck } from "@/lib/study/decks";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { WeakArea } from "@/lib/study/weak-points";
import { loadUserCards } from "@/services/study/cards";
import { loadStudyActivity } from "@/services/study/activity";
import { getDecks } from "@/services/study/decks";
import { getActiveTopics } from "@/services/study/topics";
import { ensureStudyStateSetup } from "@/services/study/daily-review";
import AppPage from "@/components/layout/AppPage";
import { ScheduleForecastPanel } from "@/components/stats/AnalyticsPanels";
import {
  ButtonLink,
  Card,
  EmptyState,
  FeedbackBanner,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import {
  useDashboardData,
  type DashboardDataLoadOptions,
} from "@/hooks/useDashboardData";

const PROGRESS_VISITED_KEY = "jami:progress-visited";

/** How many weak areas are worth naming before the list becomes a wall. */
const WEAK_AREA_LIMIT = 4;

/** How many decks are shown before Flashcards is the better place to look. */
const DECK_HEALTH_LIMIT = 5;

function formatMinutes(minutes: number) {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole}m`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * One number, and which way it moved since the week before.
 *
 * A raw count says almost nothing on its own -- "142 reviews" is only good or
 * bad next to what you usually do -- and this is what replaced two charts that
 * took six hundred pixels to say less.
 *
 * A fall is never drawn as a failure. It is the same muted grey as the label,
 * because Progress is meant to be somewhere you look when a week went badly,
 * and a page that turns red at you is a page you stop opening.
 */
function WeekStat({
  label,
  value,
  delta,
  formatDelta = (change: number) => `${change > 0 ? "+" : "−"}${Math.abs(change)}`,
}: {
  label: string;
  value: string;
  delta?: number;
  formatDelta?: (change: number) => string;
}) {
  const moved = typeof delta === "number" && delta !== 0;

  return (
    <div className="app-chip rounded-lg px-3 py-2.5">
      <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums text-text-primary">
          {value}
        </span>
        {moved ? (
          <span
            className={`text-2xs font-semibold tabular-nums ${
              delta > 0 ? "text-[var(--color-success-text)]" : "text-text-muted"
            }`}
          >
            {formatDelta(delta)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A deck or Topic you forget more often than the rest, and a way into it.
 *
 * The ranking behind this has been computed on every load of this page for as
 * long as it has existed and was never drawn, which left Progress with plenty
 * of numbers and nothing to do about any of them.
 */
function WeakAreaRow({ area }: { area: WeakArea }) {
  const href =
    area.kind === "topic"
      ? getCustomStudyHref({ mode: "custom", topicIds: [area.id] })
      : getDeckStudyHref(area.id);

  return (
    <li className="app-subtle-panel flex items-center gap-3 rounded-lg py-2 pl-3 pr-2">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {area.name}
          </span>
          <span className="app-chip shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold">
            {area.kind === "topic" ? "Topic" : "Deck"}
          </span>
        </div>
        <div className="mt-0.5 text-2xs text-text-muted">
          {area.cardCount} card{area.cardCount === 1 ? "" : "s"}
          {area.totalLapses > 0
            ? ` · forgotten ${area.totalLapses} time${area.totalLapses === 1 ? "" : "s"}`
            : ""}
        </div>
      </div>
      <ButtonLink href={href} size="sm" variant="secondary" className="shrink-0">
        Study
      </ButtonLink>
    </li>
  );
}

export default function ProgressPage() {
  const { user } = useUser();
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [studyActivity, setStudyActivity] = useState<DailyStudyActivity[]>([]);
  const [dataLoadedAt, setDataLoadedAt] = useState(() => Date.now());
  const { feedback, showError, clear: clearFeedback } = useFeedback();

  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_VISITED_KEY, "true");
    } catch {
      // Local dashboard checklist only.
    }
  }, [user.uid]);

  /*
   * Notebooks, sources, drafts and goals are no longer read here.
   *
   * They fed a row counting what the workspace contained, which is inventory
   * rather than progress -- knowing you own twelve notebooks says nothing about
   * how you are doing. Four collections stopped being fetched with it.
   */
  const loadProgressData = useCallback(
    async (reads: DashboardDataLoadOptions = {}) => {
      await ensureStudyStateSetup(user.uid);
      const [nextCards, nextDecks, nextTopics, nextStudyActivity] =
        await Promise.all([
          loadUserCards(user.uid, reads),
          getDecks(user.uid, reads),
          getActiveTopics(user.uid, reads),
          loadStudyActivity(user.uid),
        ]);
      return {
        cards: nextCards,
        decks: nextDecks,
        topics: nextTopics,
        studyActivity: nextStudyActivity,
      };
    },
    [user.uid]
  );

  const applyProgressData = useCallback(
    (data: Awaited<ReturnType<typeof loadProgressData>>) => {
      setCards(data.cards);
      setDecks(data.decks);
      setTopics(data.topics);
      setStudyActivity(data.studyActivity);
      setDataLoadedAt(Date.now());
    },
    []
  );

  const handleProgressLoadError = useCallback(
    (error: unknown) => {
      console.error("Failed to load Progress data.", error);
      showError("Failed to load Progress.");
    },
    [showError]
  );

  const handleProgressLoadStart = useCallback(() => {
    clearFeedback();
  }, [clearFeedback]);

  const { loading } = useDashboardData({
    requestKey: user.uid,
    load: loadProgressData,
    apply: applyProgressData,
    onError: handleProgressLoadError,
    onLoadStart: handleProgressLoadStart,
  });

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
  const currentStreak = useMemo(
    () => computeStudyStreak(studyActivity),
    [studyActivity]
  );
  const deckHealth = useMemo(() => {
    const currentStudyDayStart = getStudyDayWindow(dataLoadedAt).start;
    return decks
      .map((deck) => {
        const deckCards = cards.filter((card) => card.deckId === deck.id);
        const risks = deckCards.map((card) =>
          getMemoryRiskInfo(card, dataLoadedAt)
        );
        const weakCount = risks.filter((risk) => risk.tier === "high").length;
        const dueCount = deckCards.filter((card) =>
          isCardDue(card, dataLoadedAt)
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
  }, [cards, dataLoadedAt, decks]);
  const decksNeedingReview = deckHealth.filter(
    (summary) => summary.status !== "healthy"
  ).length;
  // isCardDue is the definition the rest of the app studies by: a card that has
  // never been reviewed has no dueDate and is due now. Counting only scheduled
  // cards here made Progress report fewer due cards than Decks and Learn.
  const cardsDue = cards.filter((card) => isCardDue(card, dataLoadedAt)).length;
  const weakAreas = analytics.weakestAreas.slice(0, WEAK_AREA_LIMIT);
  const week = analytics.recentChanges;

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
      width="xl"
      contentClassName="space-y-4"
    >
      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => clearFeedback()}
        />
      ) : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-56" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          {/*
            * What to do right now, said once.
            *
            * The number of cards due was on this page three times over -- its
            * own tile, the first bar of the forecast, and a line on every deck
            * row. It is the one thing somebody opens Progress to act on, so it
            * gets the top of the page and nowhere else.
            */}
          <Card tone="warm" padding="md">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Ready now
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
                  {cardsDue > 0
                    ? `${cardsDue} card${cardsDue === 1 ? "" : "s"} to review`
                    : "Nothing due right now"}
                </h2>
                <p className="mt-1.5 text-xs text-text-muted">
                  {currentStreak > 0
                    ? `${currentStreak} day streak`
                    : "Review today to start a streak"}
                </p>
              </div>
              {cardsDue > 0 ? (
                <ButtonLink
                  href={getCustomStudyHref({ mode: "daily" })}
                  className="shrink-0"
                >
                  Start daily review
                </ButtonLink>
              ) : null}
            </div>
          </Card>

          <Card padding="md">
            <SectionHeader
              title="Needs attention"
              description="The Topics and decks you forget most often. Studying one drills only that material."
            />
            {weakAreas.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {weakAreas.map((area) => (
                  <WeakAreaRow key={`${area.kind}:${area.id}`} area={area} />
                ))}
              </ul>
            ) : (
              <div className="mt-4">
                <EmptyState
                  variant="plain"
                  align="left"
                  title="Nothing is standing out yet"
                  description="Review a deck a few times and Jami will point at whatever you are forgetting most."
                />
              </div>
            )}
          </Card>

          <ScheduleForecastPanel analytics={analytics} />

          <Card padding="md">
            <SectionHeader
              title="Deck health"
              description="How much of each deck you are holding on to."
              action={
                deckHealth.length > 0 ? (
                  <span className="app-chip inline-flex rounded-full px-3 py-1.5 text-xs font-semibold">
                    {decksNeedingReview === 0
                      ? "All decks up to date"
                      : `${decksNeedingReview} of ${deckHealth.length} need review`}
                  </span>
                ) : null
              }
            />
            <div className="mt-4 space-y-2">
              {deckHealth.length > 0 ? (
                deckHealth.slice(0, DECK_HEALTH_LIMIT).map((summary) => (
                  <div
                    key={summary.deck.id}
                    className="app-subtle-panel rounded-lg p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {summary.deck.name}
                        </div>
                        <div className="mt-0.5 text-2xs text-text-muted">
                          {summary.cardCount} card
                          {summary.cardCount === 1 ? "" : "s"}
                          {summary.dueCount > 0
                            ? ` · ${summary.dueCount} due`
                            : ""}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-2xs font-semibold ${
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
                    <div className="mt-3 flex items-center gap-3">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-glass-medium"
                        role="progressbar"
                        aria-label={`${summary.deck.name}: remembering ${summary.holdingPercent} per cent`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={summary.holdingPercent}
                      >
                        <div
                          className="h-full rounded-full bg-success transition-all duration-slow"
                          style={{ width: `${summary.holdingPercent}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-2xs font-semibold tabular-nums text-text-secondary">
                        {summary.holdingPercent}% remembered
                      </span>
                      <ButtonLink
                        href={getDeckStudyHref(summary.deck.id)}
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                      >
                        Open
                      </ButtonLink>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  variant="plain"
                  align="left"
                  emoji="Decks"
                  title="No deck health data yet"
                  description="Add cards to a deck and start reviewing to see how it is doing."
                />
              )}
            </div>
          </Card>

          <Card padding="md">
            <SectionHeader
              title="This week"
              description="The last seven days, against the seven before them."
            />
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <WeekStat
                label="Reviews"
                value={String(week.last7Reviews)}
                delta={week.last7Reviews - week.previous7Reviews}
              />
              <WeekStat
                label="Accuracy"
                value={`${week.last7Accuracy}%`}
                delta={week.last7Accuracy - week.previous7Accuracy}
                formatDelta={(change) =>
                  `${change > 0 ? "+" : "−"}${Math.abs(change)}%`
                }
              />
              <WeekStat
                label="Time"
                value={formatMinutes(week.last7Minutes)}
                delta={week.last7Minutes - week.previous7Minutes}
                formatDelta={(change) =>
                  `${change > 0 ? "+" : "−"}${formatMinutes(Math.abs(change))}`
                }
              />
              {/*
                * No delta on new cards: only this week's figure is counted, and
                * inventing a comparison it cannot make would be worse than
                * leaving the number to stand on its own.
                */}
              <WeekStat label="New cards" value={String(week.newCardsLast7Days)} />
            </div>
          </Card>
        </>
      )}
    </AppPage>
  );
}
