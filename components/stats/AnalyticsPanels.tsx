import { Card, EmptyState, SectionHeader } from "@/components/ui";
import type { SpacedRepetitionAnalytics } from "@/lib/study/analytics";
import type { StreakPrediction } from "@/lib/study/streak-prediction";

function formatDelta(value: number, suffix = "") {
  const rounded = Math.round(value);
  if (rounded === 0) {
    return "No change";
  }
  return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
}

function getToneClass(riskTier: StreakPrediction["riskTier"]) {
  if (riskTier === "low") {
    return "border-emerald-300/20 bg-emerald-400/[0.08] text-emerald-100";
  }
  if (riskTier === "medium") {
    return "border-amber-300/20 bg-amber-300/[0.08] text-amber-100";
  }
  return "border-rose-300/20 bg-rose-400/[0.08] text-rose-100";
}

function getStreakStatus(prediction: StreakPrediction) {
  if (prediction.studiedToday) {
    return {
      label: "Protected today",
      detail: "You already logged study today.",
    };
  }

  if (prediction.currentStreak === 0) {
    return {
      label: "Ready to restart",
      detail: "A short session will start a new streak.",
    };
  }

  if (prediction.riskTier === "low") {
    return {
      label: "On track",
      detail: "A light session should be enough.",
    };
  }

  if (prediction.riskTier === "medium") {
    return {
      label: "Needs a short session",
      detail: "A focused catch-up today should keep it moving.",
    };
  }

  return {
    label: "Needs attention",
    detail: "Study today to avoid losing momentum.",
  };
}

export function StreakPredictionPanel({ prediction }: { prediction: StreakPrediction }) {
  const status = getStreakStatus(prediction);

  return (
    <Card padding="lg" className="animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <SectionHeader
            title="Streak check-in"
            description={`${prediction.explanation} This view uses today's study, your last 7 active days, and the current due load.`}
          />
          <div className="mt-4 text-lg font-semibold text-white">{prediction.headline}</div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {prediction.actionLabel}
          </p>
        </div>
        <div className={`rounded-[1.4rem] border px-4 py-3 text-sm ${getToneClass(prediction.riskTier)}`}>
          <div className="text-xs uppercase tracking-[0.16em]">Streak status</div>
          <div className="mt-2 text-2xl font-semibold">
            {status.label}
          </div>
          <div className="mt-2 text-xs opacity-80">
            {status.detail}
          </div>
          <div className="mt-3 text-xs opacity-80">
            {prediction.studiedToday
              ? "No rescue session needed."
              : `Suggested session: ${prediction.rescueCards} cards / ${prediction.rescueMinutes} min`}
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {[
          { label: "Current streak", value: `${prediction.currentStreak}d` },
          { label: "Active days (7d)", value: `${prediction.trailing7ActiveDays}d` },
          { label: "Due now", value: prediction.dueBacklog },
          { label: "Overdue", value: prediction.overdueBacklog },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.045] px-3 py-3 text-center"
          >
            <div className="text-lg font-semibold tabular-nums text-white">{item.value}</div>
            <div className="mt-1 text-[0.68rem] uppercase tracking-[0.12em] text-text-muted">
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function RetentionHealthPanel({ analytics }: { analytics: SpacedRepetitionAnalytics }) {
  return (
    <Card padding="lg" className="animate-fade-in">
      <SectionHeader
        title="Retention health"
        description="FSRS state, difficulty, and risk are now grouped into one calmer view of what is holding and what is sliding."
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.045] p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-text-muted">Risk mix</div>
          <div className="mt-3 grid gap-2">
            {[
              { label: "High", value: analytics.retentionSummary.high },
              { label: "Medium", value: analytics.retentionSummary.medium },
              { label: "Low", value: analytics.retentionSummary.low },
              { label: "New", value: analytics.retentionSummary.new },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">{item.label}</span>
                <span className="font-semibold tabular-nums text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.045] p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-text-muted">FSRS stages</div>
          <div className="mt-3 space-y-2">
            {analytics.stateDistribution.map((item) => (
              <div key={item.label} className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">{item.label}</span>
                <span className="font-semibold tabular-nums text-white">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.045] p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-text-muted">Learning pressure</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Lapse rate</span>
              <span className="font-semibold tabular-nums text-white">{analytics.retentionSummary.lapseRate}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Avg difficulty</span>
              <span className="font-semibold tabular-nums text-white">{analytics.retentionSummary.averageDifficulty}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Overdue</span>
              <span className="font-semibold tabular-nums text-white">{analytics.retentionSummary.overdue}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Avg overdue days</span>
              <span className="font-semibold tabular-nums text-white">{analytics.averageOverdueDays}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ScheduleForecastPanel({ analytics }: { analytics: SpacedRepetitionAnalytics }) {
  const maxDueCount = Math.max(1, ...analytics.dueForecast7d.map((point) => point.dueCount));

  return (
    <Card padding="lg" className="animate-fade-in">
      <SectionHeader
        title="Scheduling forecast"
        description={`FSRS has ${analytics.dueIn7Days} card${analytics.dueIn7Days === 1 ? "" : "s"} due in the next 7 days and ${analytics.dueIn30Days} due inside 30 days.`}
      />
      <div className="mt-5 grid gap-3 sm:grid-cols-7">
        {analytics.dueForecast7d.map((point) => (
          <div
            key={point.dayKey}
            className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.045] p-3"
          >
            <div className="text-xs text-text-muted">{point.label}</div>
            <div className="mt-2 flex h-20 items-end">
              <div
                className="w-full rounded-[0.9rem] bg-[linear-gradient(180deg,#ffc7ea_0%,#b77cff_100%)]"
                style={{
                  height: `${Math.max(12, Math.round((point.dueCount / maxDueCount) * 100))}%`,
                }}
              />
            </div>
            <div className="mt-2 text-sm font-semibold tabular-nums text-white">
              {point.dueCount}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function RecentChangesPanel({ analytics }: { analytics: SpacedRepetitionAnalytics }) {
  const reviewDelta = analytics.recentChanges.last7Reviews - analytics.recentChanges.previous7Reviews;
  const accuracyDelta = analytics.recentChanges.last7Accuracy - analytics.recentChanges.previous7Accuracy;
  const minutesDelta = analytics.recentChanges.last7Minutes - analytics.recentChanges.previous7Minutes;

  return (
    <Card padding="lg" className="animate-fade-in">
      <SectionHeader
        title="What changed recently"
        description="A 7-day comparison against the previous week so the stats page feels directional instead of static."
      />
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Reviews",
            value: analytics.recentChanges.last7Reviews,
            detail: formatDelta(reviewDelta),
          },
          {
            label: "Accuracy",
            value: `${analytics.recentChanges.last7Accuracy}%`,
            detail: formatDelta(accuracyDelta, " pts"),
          },
          {
            label: "Focus time",
            value: `${analytics.recentChanges.last7Minutes} min`,
            detail: formatDelta(minutesDelta, " min"),
          },
          {
            label: "New cards added",
            value: analytics.recentChanges.newCardsLast7Days,
            detail: "Last 7 days",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.045] p-4"
          >
            <div className="text-xs uppercase tracking-[0.16em] text-text-muted">{item.label}</div>
            <div className="mt-3 text-xl font-semibold text-white">{item.value}</div>
            <div className="mt-2 text-sm text-text-secondary">{item.detail}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function WeakAreasPanel({
  analytics,
  title = "Weakest areas",
  description = "Decks and tags carrying the heaviest lapse and difficulty signal right now.",
}: {
  analytics: SpacedRepetitionAnalytics;
  title?: string;
  description?: string;
}) {
  return (
    <Card padding="lg" className="animate-fade-in">
      <SectionHeader title={title} description={description} />
      <div className="mt-4 space-y-3">
        {analytics.weakestAreas.length > 0 ? (
          analytics.weakestAreas.map((area) => (
            <div
              key={`${area.kind}-${area.name}`}
              className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.045] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{area.name}</div>
                  <div className="mt-1 text-xs text-text-muted">
                    {area.kind === "deck" ? "Deck" : "Tag"} - {area.cardCount} reviewed card{area.cardCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                  {area.score.toFixed(1)}
                </div>
              </div>
              <div className="mt-3 text-sm leading-6 text-text-secondary">
                Difficulty {area.avgDifficulty.toFixed(1)} / 10 with {area.totalLapses} lapse{area.totalLapses === 1 ? "" : "s"}.
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            variant="plain"
            emoji="Stats"
            eyebrow="No weak areas yet"
            title="Review data is still building"
            description="Once cards have a little more history, weak patterns will surface here."
          />
        )}
      </div>
    </Card>
  );
}
