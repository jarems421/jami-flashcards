"use client";

import { planSessionEndTime, planSessionsOn } from "@/lib/planning/plan-schedule";
import type { PlanWeek, PlanWeekDay } from "@/lib/planning/plan-week";
import {
  PLAN_WEEKDAY_FULL_LABELS,
  PLAN_WEEKDAY_LABELS,
  type RevisionPlan,
  type RevisionPlanEntry,
  type RevisionPlanSession,
} from "@/lib/planning/types";

/**
 * The plan as a week, laid out.
 *
 * Today shows the day; this shows the shape, and until now "the shape" was a
 * row of chips reading "Mon · 45m". That is a summary of a timetable, not a
 * timetable: it cannot show two sittings in an evening, cannot show a time, and
 * gives a student no place to put something on a Thursday.
 *
 * Seven columns on a desktop and seven stacked rows on anything narrower.
 * Sittings are drawn at the length they are, so a ninety-minute evening is
 * visibly longer than a twenty-minute one -- which is most of what makes a
 * timetable readable at a glance.
 *
 * What is *inside* a sitting is still not shown here, because it is not decided
 * until the day. Pinned items are the exception, and they are the exception
 * precisely because the student put them there.
 */

/** Pixels per minute, so the blocks are comparable without being enormous. */
const MINUTE_HEIGHT = 0.9;
const MIN_BLOCK_HEIGHT = 44;

function blockHeight(minutes: number) {
  return Math.max(MIN_BLOCK_HEIGHT, Math.round(minutes * MINUTE_HEIGHT));
}

function SessionBlock({
  session,
  scopeName,
  index,
  total,
}: {
  session: RevisionPlanSession;
  scopeName?: string;
  index: number;
  total: number;
}) {
  const endTime = session.startTime
    ? planSessionEndTime(session.startTime, session.minutes)
    : undefined;

  return (
    <li
      className="app-subtle-panel flex flex-col justify-between rounded-lg px-2.5 py-2 transition duration-normal ease-spring hover:-translate-y-[1px] hover:shadow-accent"
      style={{ minHeight: `${blockHeight(session.minutes)}px` }}
    >
      <div className="min-w-0">
        <p className="truncate text-2xs font-semibold uppercase tracking-[0.1em] text-text-muted">
          {session.startTime
            ? `${session.startTime}${endTime ? `–${endTime}` : ""}`
            : total > 1
              ? `Session ${index + 1}`
              : "Any time"}
        </p>
        <p className="mt-0.5 truncate text-xs font-semibold text-text-primary">
          {session.label || scopeName || "Whatever needs it most"}
        </p>
      </div>
      <p className="mt-1 text-2xs tabular-nums text-text-muted">{session.minutes} min</p>
    </li>
  );
}

function DayColumn({
  day,
  sessions,
  entry,
  scopeNames,
  onPin,
}: {
  day: PlanWeekDay;
  sessions: readonly RevisionPlanSession[];
  entry?: RevisionPlanEntry;
  scopeNames: ReadonlyMap<string, string>;
  onPin?: (dayKey: string) => void;
}) {
  const pinned = entry?.pinned ?? [];
  const dayNumber = day.dayKey.slice(-2);

  return (
    <section
      aria-label={`${PLAN_WEEKDAY_FULL_LABELS[day.weekday]} ${dayNumber}`}
      className={`flex min-w-0 flex-col rounded-xl border p-2 transition duration-normal ${
        day.isToday
          ? "border-[var(--color-accent-muted)] bg-[var(--color-glass-subtle)] shadow-accent"
          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <p
          className={`text-2xs font-semibold uppercase tracking-[0.12em] ${
            day.isToday ? "text-[var(--color-accent)]" : "text-text-muted"
          }`}
        >
          {PLAN_WEEKDAY_LABELS[day.weekday]} {dayNumber}
        </p>
        {day.minutes > 0 ? (
          <p className="text-2xs tabular-nums text-text-muted">{day.minutes}m</p>
        ) : null}
      </div>

      {day.skipped ? (
        <p className="mt-2 px-0.5 text-2xs leading-5 text-text-muted">Taken off.</p>
      ) : sessions.length === 0 ? (
        <p className="mt-2 px-0.5 text-2xs leading-5 text-text-muted">
          {day.withinPlan ? "Rest day." : "Outside the plan."}
        </p>
      ) : (
        <ul className="app-rise mt-2 space-y-1.5">
          {sessions.map((session, index) => (
            <SessionBlock
              key={session.id}
              session={session}
              index={index}
              total={sessions.length}
              scopeName={session.scopeKey ? scopeNames.get(session.scopeKey) : undefined}
            />
          ))}
        </ul>
      )}

      {pinned.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {pinned.map((item) => (
            <li
              key={item.actionId}
              className="rounded-lg border border-[var(--color-accent-muted)] px-2.5 py-1.5"
            >
              <p className="truncate text-2xs font-medium text-text-primary">{item.label}</p>
              <p className="text-2xs text-text-muted">You added this</p>
            </li>
          ))}
        </ul>
      ) : null}

      {onPin && day.withinPlan && !day.isPast ? (
        <button
          type="button"
          onClick={() => onPin(day.dayKey)}
          className="mt-1.5 min-h-9 rounded-lg border border-dashed border-[var(--color-border)] px-2 text-2xs font-semibold text-text-muted transition duration-fast hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        >
          + Add
        </button>
      ) : null}
    </section>
  );
}

export default function PlanWeekTimetable({
  plan,
  week,
  entries,
  scopeNames,
  onPin,
}: {
  plan: RevisionPlan;
  week: PlanWeek;
  entries: readonly RevisionPlanEntry[];
  scopeNames: ReadonlyMap<string, string>;
  /** Opens the pin picker for a day. Omitted where pinning is not available. */
  onPin?: (dayKey: string) => void;
}) {
  const byDayKey = new Map(entries.map((entry) => [entry.dayKey, entry]));

  return (
    <div className="app-rise grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {week.days.map((day) => (
        <DayColumn
          key={day.dayKey}
          day={day}
          sessions={day.withinPlan ? planSessionsOn(plan.sessions, day.dayKey) : []}
          entry={byDayKey.get(day.dayKey)}
          scopeNames={scopeNames}
          onPin={onPin}
        />
      ))}
    </div>
  );
}
