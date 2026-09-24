"use client";

import { planSessionFocus } from "@/lib/planning/plan-tasks";
import type { PlanWeek, PlanWeekDay } from "@/lib/planning/plan-week";
import { PLAN_WEEKDAY_FULL_LABELS, PLAN_WEEKDAY_LABELS, type PlanDay } from "@/lib/planning/types";

/**
 * The week as seven days, each showing the sittings it holds.
 *
 * Also how a day is chosen: picking one shows it in full below. A sitting's
 * topic is only known today -- Jami decides what goes in Saturday on Saturday
 * -- so other days show the student's own label, or just the subject.
 */

export type PlanWeekRowProps = {
  week: PlanWeek;
  days: readonly PlanDay[];
  scopeNames: ReadonlyMap<string, string>;
  scopeColor: (scopeKey: string) => string;
  selectedDayKey: string;
  onSelect: (dayKey: string) => void;
  /** Smaller cards, for pages where the week is context rather than the point. */
  compact?: boolean;
};

export function planDayState(day: PlanWeekDay): { text: string; done: boolean } {
  if (!day.withinPlan || !day.scheduled) return { text: "Rest", done: false };
  if (day.skipped) return { text: "Taken off", done: false };
  if (day.expectedCount > 0 && day.doneCount >= day.expectedCount) return { text: "Done", done: true };
  if (day.isToday) return { text: "Today", done: false };
  if (day.doneCount > 0) return { text: `${day.doneCount} of ${day.expectedCount}`, done: false };
  const hours = Math.floor(day.minutes / 60);
  const minutes = day.minutes % 60;
  return { text: hours > 0 ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`, done: false };
}

export default function PlanWeekRow({ week, days, scopeNames, scopeColor, selectedDayKey, onSelect, compact }: PlanWeekRowProps) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7 lg:gap-2.5">
      {week.days.map((weekDay, index) => {
        const resolved = days[index];
        const state = planDayState(weekDay);
        const selected = weekDay.dayKey === selectedDayKey;
        const date = Number(weekDay.dayKey.slice(-2));
        return (
          <li key={weekDay.dayKey} className="min-w-0">
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`${PLAN_WEEKDAY_FULL_LABELS[weekDay.weekday]} ${date}: ${state.text}`}
              onClick={() => onSelect(weekDay.dayKey)}
              className={`flex h-full w-full min-w-0 flex-col gap-2 rounded-2xl border p-3 text-left transition duration-fast ease-spring hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                compact ? "min-h-[7.5rem]" : "min-h-[10.5rem]"
              } ${
                selected
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                  : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] hover:border-[var(--color-border-strong)]"
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-2xs font-bold uppercase tracking-[0.1em] ${
                    weekDay.isToday ? "text-[var(--color-accent)]" : "text-text-secondary"
                  }`}
                >
                  {PLAN_WEEKDAY_LABELS[weekDay.weekday]} {date}
                </span>
                <span className={`text-2xs font-semibold ${state.done ? "text-[var(--color-success)]" : "text-text-muted"}`}>
                  {state.text}
                </span>
              </span>
              {resolved?.sessions.map((session) => {
                const focus = weekDay.isToday ? planSessionFocus(session) : session.label;
                const yours = session.slots.filter((slot) => slot.item.kind === "pinned").length;
                return (
                  <span key={session.id} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-[var(--color-glass-medium)] px-2.5 py-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.06em] text-text-secondary">
                      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: scopeColor(session.scopeKey) }} />
                      <span className="truncate">{scopeNames.get(session.scopeKey) ?? "Study"}</span>
                    </span>
                    {focus ? <span className="truncate text-sm font-semibold text-text-primary">{focus}</span> : null}
                    {compact ? null : (
                      <span className="truncate text-2xs text-text-muted">
                        {session.startTime ? `${session.startTime} · ` : ""}
                        {session.minutes} min{yours ? ` · ${yours} yours` : ""}
                      </span>
                    )}
                  </span>
                );
              })}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
