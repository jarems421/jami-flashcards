"use client";

import Link from "next/link";
import { PLAN_WEEKDAY_FULL_LABELS, PLAN_WEEKDAY_LABELS } from "@/lib/planning/types";
import type { PlanWeek, PlanWeekDay } from "@/lib/planning/plan-week";

/**
 * The student's week, seven cells wide.
 *
 * The thing a plan was missing was any sense of a week. A single day's list
 * says what to do; it does not say that this is the third of five evenings, or
 * that Thursday is free, or that Sunday is still ahead -- and without that a
 * plan reads as a to-do list that happens to be dated.
 *
 * Quiet on purpose. It is drawn every morning above work the student actually
 * came to do, so each day is a letter and a bar, and only today is picked out.
 */

type DayState = "rest" | "ahead" | "part" | "done" | "missed" | "skipped";

function stateOf(day: PlanWeekDay): DayState {
  if (!day.withinPlan || !day.scheduled) return "rest";
  if (day.skipped) return "skipped";
  if (day.expectedCount > 0 && day.doneCount >= day.expectedCount) return "done";
  if (day.doneCount > 0) return "part";
  // Only a past day can be behind. Today has not failed at anything yet, and
  // saying so first thing in the morning would be a strange way to open.
  return day.isPast ? "missed" : "ahead";
}

const BAR_CLASSES: Record<DayState, string> = {
  rest: "bg-[var(--color-border)]",
  ahead: "bg-[var(--color-accent-muted)]",
  part: "bg-[var(--color-accent-muted)]",
  done: "bg-[var(--color-accent)]",
  missed: "bg-[var(--color-border-strong)]",
  skipped: "bg-[var(--color-border-strong)]",
};

const STATE_WORDS: Record<DayState, string> = {
  rest: "rest day",
  ahead: "planned",
  part: "part done",
  done: "done",
  missed: "not marked off",
  skipped: "taken off",
};

function DayCell({ day }: { day: PlanWeekDay }) {
  const state = stateOf(day);
  const filled =
    state === "done"
      ? 1
      : day.expectedCount > 0
        ? Math.min(1, day.doneCount / day.expectedCount)
        : 0;

  return (
    <li
      className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-0.5 py-1.5 transition duration-normal ease-spring group-hover:-translate-y-[1px] ${
        day.isToday
          ? "bg-[var(--color-glass-subtle)] shadow-accent ring-1 ring-[var(--color-accent-muted)]"
          : ""
      }`}
    >
      <span
        className={`text-2xs font-semibold uppercase tracking-[0.1em] transition duration-fast ${
          day.isToday ? "text-[var(--color-accent)]" : "text-text-muted"
        }`}
      >
        {PLAN_WEEKDAY_LABELS[day.weekday].slice(0, 1)}
      </span>

      <span
        aria-hidden="true"
        className={`relative h-1.5 w-full overflow-hidden rounded-full transition duration-slow ${
          state === "rest" ? "opacity-60" : ""
        } ${BAR_CLASSES[state]}`}
      >
        {filled > 0 && state !== "done" ? (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)] transition-all duration-slow"
            style={{ width: `${Math.round(filled * 100)}%` }}
          />
        ) : null}
      </span>

      <span className="sr-only">
        {PLAN_WEEKDAY_FULL_LABELS[day.weekday]}: {STATE_WORDS[state]}
        {day.minutes > 0 ? `, ${day.minutes} minutes` : ""}
      </span>

      <span className="hidden text-2xs text-text-muted sm:block">
        {day.minutes > 0 ? `${day.minutes}m` : "—"}
      </span>
    </li>
  );
}

export default function PlanWeekStrip({
  week,
  planHref,
  className = "",
}: {
  week: PlanWeek;
  planHref: string;
  className?: string;
}) {
  const studyDays = week.days.filter((day) => day.scheduled).length;

  return (
    <Link
      href={planHref}
      aria-label="See your whole plan"
      className={`group block rounded-xl px-1 py-1 transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${className}`}
    >
      <ul className="app-rise grid grid-cols-7 gap-1">
        {week.days.map((day) => (
          <DayCell key={day.dayKey} day={day} />
        ))}
      </ul>
      <p className="mt-2 px-1 text-2xs text-text-muted">
        This week ·{" "}
        {studyDays > 0
          ? `${studyDays} study day${studyDays === 1 ? "" : "s"}, ${week.minutes} min`
          : "nothing scheduled"}
        <span className="ml-1.5 text-[var(--color-accent)] opacity-0 transition duration-normal group-hover:opacity-100">
          See the plan
        </span>
      </p>
    </Link>
  );
}
