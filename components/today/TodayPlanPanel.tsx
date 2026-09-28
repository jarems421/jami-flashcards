"use client";

import { useMemo } from "react";
import { PlanAddTask, PlanTaskRow } from "@/components/planning/PlanTodayTimeline";
import { formatPlanMinutes } from "@/components/planning/PlanActiveView";
import type { RevisionPlanTodayState } from "@/hooks/useRevisionPlanToday";
import { planScopeColor } from "@/lib/planning/plan-colors";
import { planTask, planUpNext } from "@/lib/planning/plan-tasks";

/**
 * Today's part of the revision plan, as one contained list.
 *
 * Today used to lead with a large card for the next task, then the rest of the
 * day on a time rail, then a countdown -- the same day told three ways, loose
 * down the page. It is one panel now, laid out like a day in a planner: each
 * sitting a short section, its work a checklist under it, and the next thing
 * to do highlighted where it sits, with its Start button beside it. What Jami
 * suggests beyond the plan goes in its own panel underneath, so the plan stays
 * the student's and reads as a whole.
 */
export default function TodayPlanPanel({ planToday }: { planToday: RevisionPlanTodayState }) {
  const { plan, day, scopeNames } = planToday;
  const scopeColor = useMemo(() => (scopeKey: string) => planScopeColor(plan, scopeKey), [plan]);
  if (!plan || !day) return null;

  const upNext = planUpNext(day);
  const tasks = day.slots.filter((slot) => slot.item.kind !== "open").length;
  const hasToday = day.scheduled && day.sessions.length > 0 && !day.skipped;
  const allDone = tasks > 0 && day.doneCount >= tasks;
  const summary = !hasToday
    ? null
    : allDone
      ? "All done"
      : day.doneCount > 0
        ? `${day.doneCount} of ${tasks} done`
        : `${tasks} ${tasks === 1 ? "task" : "tasks"} · about ${formatPlanMinutes(day.minutes)}`;

  return (
    <section aria-labelledby="today-plan-title" className="app-panel rounded-3xl p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-3">
        <h2 id="today-plan-title" className="text-base font-bold tracking-tight text-text-primary">
          Today&rsquo;s plan
        </h2>
        {summary ? <span className="text-xs tabular-nums text-text-muted">{summary}</span> : null}
      </div>

      {day.skipped ? (
        <p className="px-1 text-sm leading-6 text-text-secondary">You took today off. Rest counts.</p>
      ) : !hasToday ? (
        <p className="px-1 text-sm leading-6 text-text-secondary">
          Nothing planned today. Rest counts — or pick something Jami suggests below.
        </p>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {day.sessions.map((session, index) => {
            const subject = scopeNames.get(session.scopeKey) ?? "Study";
            return (
              <section key={session.id} aria-label={subject} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline gap-2.5 px-1 pb-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 self-center rounded-full"
                    style={{ backgroundColor: scopeColor(session.scopeKey) }}
                  />
                  <span className="text-xs font-bold tabular-nums text-text-primary">
                    {session.startTime ?? (day.sessions.length > 1 ? `Session ${index + 1}` : "Any time")}
                  </span>
                  <h3 className="min-w-0 truncate text-sm font-semibold text-text-primary">{subject}</h3>
                  <span className="ml-auto shrink-0 text-2xs tabular-nums text-text-muted">
                    {session.minutes} min
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {session.slots.map((slot) => (
                    <PlanTaskRow
                      key={slot.id}
                      task={planTask(slot)}
                      isToday
                      isPast={false}
                      upNext={slot.id === upNext?.task.slot.id}
                      showStart
                      onToggle={(target) => planToday.toggleSlot(target)}
                      onRemove={(actionId) => planToday.removeTask(day.dayKey, actionId)}
                    />
                  ))}
                </ul>
                <div className="pt-1">
                  <PlanAddTask
                    session={session}
                    subject={subject}
                    onAddOwnTask={(sessionId, label) => planToday.addOwnTask(day.dayKey, sessionId, label)}
                    onAskJami={planToday.addJamiTask}
                  />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
