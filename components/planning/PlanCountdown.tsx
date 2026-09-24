import Link from "next/link";
import type { PlanCountdownItem } from "@/lib/planning/plan-countdown";

/**
 * How long until each exam: a list beside the planner, or one quiet line on
 * Home, where the countdown is context rather than the point.
 */

function dateLabel(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year as number, (month as number) - 1, day as number)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function PlanCountdown({
  items,
  scopeColor,
  variant = "list",
  changeHref,
}: {
  items: readonly PlanCountdownItem[];
  scopeColor: (scopeKey: string) => string;
  variant?: "list" | "line";
  changeHref?: string;
}) {
  if (items.length === 0) return null;
  if (variant === "line") {
    return (
      <section
        aria-label="Counting down"
        className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-5 py-4"
      >
        <span className="text-2xs font-bold uppercase tracking-[0.16em] text-text-muted">Counting down</span>
        {items.map((item) => (
          <span key={item.id} className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 self-center rounded-full"
              style={{ backgroundColor: item.scopeKey ? scopeColor(item.scopeKey) : "var(--color-accent)" }}
            />
            <span className="text-xl font-bold tabular-nums text-text-primary">{item.daysLeft}</span>
            <span className="text-sm text-text-secondary">
              {item.daysLeft === 1 ? "day" : "days"} · {item.label}
            </span>
          </span>
        ))}
        {changeHref ? (
          <Link href={changeHref} className="ml-auto text-sm font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]">
            Change with Jami
          </Link>
        ) : null}
      </section>
    );
  }
  return (
    <section aria-label="Counting down" className="app-subtle-panel rounded-2xl p-5">
      <h2 className="mb-2 text-base font-bold text-text-primary">Counting down</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 border-t border-[var(--color-border)] py-3 first:border-t-0">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.scopeKey ? scopeColor(item.scopeKey) : "var(--color-accent)" }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-text-primary">{item.label}</span>
              <span className="block text-xs text-text-muted">
                {dateLabel(item.dayKey)}
                {item.sessionsBefore > 0 ? ` · ${item.sessionsBefore} sessions before then` : ""}
              </span>
            </span>
            <span className="text-right">
              <span className="block text-2xl font-bold leading-none tabular-nums text-text-primary">{item.daysLeft}</span>
              <span className="text-2xs text-text-muted">{item.daysLeft === 1 ? "day" : "days"}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
