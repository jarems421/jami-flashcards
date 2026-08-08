import { Card, SectionHeader } from "@/components/ui";
import type { SpacedRepetitionAnalytics } from "@/lib/study/analytics";

export function ScheduleForecastPanel({ analytics }: { analytics: SpacedRepetitionAnalytics }) {
  const maxDueCount = Math.max(1, ...analytics.dueForecast7d.map((point) => point.dueCount));
  const weeklyDueCount = analytics.dueForecast7d.reduce(
    (sum, point) => sum + point.dueCount,
    0
  );

  return (
    <Card padding="md" className="animate-fade-in">
      <SectionHeader
        title="Scheduling forecast"
        description={`${weeklyDueCount} card${weeklyDueCount === 1 ? "" : "s"} scheduled over the next 7 days.`}
      />
      <div
        className="app-subtle-panel mt-4 rounded-lg px-3 pb-3 pt-4 sm:px-4"
        role="img"
        aria-label={`Seven-day scheduling forecast with ${weeklyDueCount} cards scheduled`}
      >
        <div className="grid grid-cols-7 gap-2 sm:gap-3">
          {analytics.dueForecast7d.map((point, index) => (
            <div key={point.dayKey} className="min-w-0 text-center">
              <div className="h-5 text-xs font-semibold tabular-nums text-text-secondary">
                {point.dueCount > 0 ? point.dueCount : ""}
              </div>
              <div className="mt-1 flex h-24 items-end rounded-md bg-glass-medium px-1.5 pt-2">
                <div
                  className={`w-full rounded-t-sm ${
                    index === 0
                      ? "bg-[var(--color-warm-accent)]"
                      : "bg-[var(--color-accent)]"
                  }`}
                  style={{
                    height:
                      point.dueCount === 0
                        ? "3px"
                        : `${Math.max(12, Math.round((point.dueCount / maxDueCount) * 100))}%`,
                  }}
                />
              </div>
              <div
                className={`mt-2 truncate text-2xs font-semibold ${
                  index === 0 ? "text-warm-accent" : "text-text-muted"
                }`}
              >
                {index === 0 ? "Today" : point.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
