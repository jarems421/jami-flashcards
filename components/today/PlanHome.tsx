"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui";
import PlanCountdown from "@/components/planning/PlanCountdown";
import PlanTodayTimeline from "@/components/planning/PlanTodayTimeline";
import { longDayLabel } from "@/components/planning/PlanActiveView";
import type { StudyDoor } from "@/components/today/StudyDoors";
import type { RevisionPlanTodayState } from "@/hooks/useRevisionPlanToday";
import { planScopeColor } from "@/lib/planning/plan-colors";
import { planCountdown } from "@/lib/planning/plan-countdown";
import { planUpNext } from "@/lib/planning/plan-tasks";
import { PLAN_WEEKDAY_LABELS } from "@/lib/planning/types";
import { getStudyDayKey } from "@/lib/study/day";

/**
 * Today, led by the student's revision plan.
 *
 * One calm column: the week at a glance, the one thing to do next, the rest of
 * today under it, and how long is left until the exams. Everything a student
 * does here -- ticking, adding their own task, asking Jami for another -- is the
 * same as in the planner, because it is the same day.
 *
 * When the plan has nothing left for today, or today is a rest day, the
 * Learning Engine's own next step takes the lead instead, so Today always has
 * something honest to offer.
 */

export default function PlanHome({
  planToday,
  planHref,
  doors,
  fallback,
}: {
  planToday: RevisionPlanTodayState;
  planHref: string;
  doors: readonly StudyDoor[];
  /** What leads when the plan has nothing left for today: the engine's mission. */
  fallback: ReactNode;
}) {
  const { plan, day, week, days, scopeNames } = planToday;
  const scopeColor = useMemo(() => (scopeKey: string) => planScopeColor(plan, scopeKey), [plan]);
  if (!plan || !day || !week) return null;

  const todayDayKey = getStudyDayKey();
  const upNext = planUpNext(day);
  const countdown = planCountdown(plan, todayDayKey);
  const subject = upNext ? scopeNames.get(upNext.session.scopeKey) ?? "Study" : "";
  const hasToday = day.scheduled && day.sessions.length > 0 && !day.skipped;
  const allDone = day.slots.length > 0 && day.doneCount >= day.slots.length;
  // Said precisely: a day whose sittings Jami has nothing to fill yet is not a finished day.
  const fallbackReason = day.skipped
    ? "You took today off"
    : !hasToday
      ? "Nothing planned for today"
      : allDone
        ? "Today's plan is done"
        : "Jami has nothing to suggest for today's sessions yet";

  return (
    <div className="mx-auto w-full max-w-[55rem] space-y-10 sm:space-y-12">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-2xs font-bold uppercase tracking-[0.18em] text-text-muted">
          {longDayLabel(todayDayKey)} · {plan.title}
        </p>
        <Link href={planHref} className="text-sm font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]">
          Open your plan
        </Link>
      </div>

      <nav aria-label="This week in your plan">
        <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {week.days.map((weekDay, index) => {
            const sessions = days[index]?.sessions ?? [];
            const done = weekDay.expectedCount > 0 && weekDay.doneCount >= weekDay.expectedCount;
            return (
              <li key={weekDay.dayKey}>
                <Link
                  href={planHref}
                  aria-current={weekDay.isToday ? "date" : undefined}
                  aria-label={`${PLAN_WEEKDAY_LABELS[weekDay.weekday]} ${Number(weekDay.dayKey.slice(-2))}: ${
                    sessions.length === 0 ? "rest" : done ? "done" : `${sessions.length} planned`
                  }`}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border py-2.5 transition duration-fast hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                    weekDay.isToday
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                      : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] hover:border-[var(--color-border-strong)]"
                  }`}
                >
                  <span className={`text-2xs font-bold uppercase tracking-[0.08em] ${weekDay.isToday ? "text-[var(--color-accent)]" : "text-text-muted"}`}>
                    {PLAN_WEEKDAY_LABELS[weekDay.weekday]}
                  </span>
                  <span className="text-lg font-bold tabular-nums text-text-primary">{Number(weekDay.dayKey.slice(-2))}</span>
                  <span className="flex h-1.5 gap-1" aria-hidden="true">
                    {done ? (
                      <span className="h-1.5 w-4 rounded-full bg-[var(--color-success)]" />
                    ) : (
                      sessions.map((session) => (
                        <span key={session.id} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: scopeColor(session.scopeKey) }} />
                      ))
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      {upNext ? (
        <section
          aria-labelledby="up-next-title"
          className="relative overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] px-6 py-8 shadow-e2 sm:px-10 sm:py-10"
        >
          <div aria-hidden="true" className="plan-aurora" />
          <div className="relative space-y-4">
            <p className="flex items-center gap-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-text-secondary">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: scopeColor(upNext.session.scopeKey) }} aria-hidden="true" />
              Up next · {subject}
              {upNext.session.startTime ? ` at ${upNext.session.startTime}` : ""}
            </p>
            <h2 id="up-next-title" className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-text-primary sm:text-4xl">
              {upNext.task.label}
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-text-secondary">
              About {upNext.task.slot.minutes} minutes.
              {upNext.task.description ? ` ${upNext.task.description}` : ""}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              {upNext.task.href ? (
                <ButtonLink href={upNext.task.href} size="lg">
                  {upNext.task.actionLabel ?? "Start"}
                </ButtonLink>
              ) : (
                <Button type="button" size="lg" onClick={() => planToday.toggleSlot(upNext.task.slot)}>
                  Mark it done
                </Button>
              )}
              <ButtonLink href="#rest-of-today" variant="ghost" size="lg">
                See the rest of today
              </ButtonLink>
            </div>
          </div>
        </section>
      ) : (
        <div className="space-y-3">
          <p className="text-2xs font-bold uppercase tracking-[0.16em] text-text-muted">{fallbackReason}</p>
          {fallback}
        </div>
      )}

      {hasToday ? (
        <div id="rest-of-today" className="scroll-mt-24">
          <PlanTodayTimeline
            day={day}
            title={upNext ? "The rest of today" : "Today"}
            summary={`${day.doneCount} of ${day.slots.length} done`}
            scopeNames={scopeNames}
            scopeColor={scopeColor}
            isToday
            {...(upNext ? { upNextSlotId: upNext.task.slot.id } : {})}
            onToggle={(slot) => planToday.toggleSlot(slot)}
            onAddOwnTask={(sessionId, label) => planToday.addOwnTask(todayDayKey, sessionId, label)}
            onAskJami={planToday.addJamiTask}
            onRemoveTask={(actionId) => planToday.removeTask(todayDayKey, actionId)}
          />
        </div>
      ) : null}

      <PlanCountdown items={countdown} scopeColor={scopeColor} variant="line" changeHref={planHref} />

      {doors.length > 0 ? (
        <nav aria-label="Other ways to study" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--color-border)] pt-6">
          <span className="text-2xs font-bold uppercase tracking-[0.16em] text-text-muted">Or study your way</span>
          {doors.map((door) => (
            <Link key={door.label} href={door.href} className="text-sm font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]">
              {door.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
