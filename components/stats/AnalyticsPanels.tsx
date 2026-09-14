import { Card, SectionHeader } from "@/components/ui";
import type { SpacedRepetitionAnalytics } from "@/lib/study/analytics";
import { buildMemorySummary, type MemoryGroupKey } from "@/lib/study/memory-summary";

const GROUP_COLOUR: Record<MemoryGroupKey, string> = {
  strong: "bg-success",
  settling: "bg-[var(--color-accent)]",
  slipping: "bg-warning",
  unstudied: "bg-glass-strong",
};

/**
 * How much of what the student has studied is sticking.
 *
 * Replaces the scheduling forecast, which drew the scheduler's bookings as bars
 * and left the student to work out what that meant for them.
 */
export function MemoryPanel({
  analytics,
}: {
  analytics: Pick<SpacedRepetitionAnalytics, "retentionSummary" | "dueForecast7d">;
}) {
  const summary = buildMemorySummary(analytics);
  const { busiestDay, reviews } = summary.weekAhead;

  return (
    <Card padding="md" className="animate-fade-in">
      <SectionHeader
        title="How well you remember"
        description={
          summary.studiedCards > 0
            ? `${summary.rememberedWell} of your ${summary.studiedCards} studied card${summary.studiedCards === 1 ? " is" : "s are"} remembered well.`
            : "Review a few cards and this shows how much is sticking."
        }
      />

      {/* Before anything is studied, four rows of zeros say less than the line above. */}
      {summary.studiedCards > 0 ? (
        <>
          <div
            className="mt-4 flex h-3 overflow-hidden rounded-full bg-glass-medium"
            role="img"
            aria-label={summary.groups.map((group) => `${group.label}: ${group.count}`).join(", ")}
          >
            {summary.groups
              .filter((group) => group.count > 0)
              .map((group) => (
                <div
                  key={group.key}
                  className={`h-full ${GROUP_COLOUR[group.key]}`}
                  style={{ width: `${group.percent}%` }}
                />
              ))}
          </div>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {summary.groups.map((group) => (
              <li key={group.key} className="app-subtle-panel flex items-start gap-2.5 rounded-lg px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${GROUP_COLOUR[group.key]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary">{group.label}</span>
                    <span className="text-sm font-semibold tabular-nums text-text-primary">
                      {group.count}
                    </span>
                  </div>
                  <p className="mt-0.5 text-2xs text-text-muted">{group.detail}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-text-muted">
            {reviews > 0
              ? `${reviews} review${reviews === 1 ? "" : "s"} over the next 7 days${
                  busiestDay
                    ? `, busiest ${busiestDay.isToday ? "today" : `on ${busiestDay.label}`} (${busiestDay.count})`
                    : ""
                }.`
              : "Nothing scheduled for the next 7 days."}
          </p>
        </>
      ) : null}
    </Card>
  );
}
