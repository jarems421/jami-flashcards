import { isWithinPlanHorizon, planDaysBetween, planSessionsOn } from "@/lib/planning/plan-schedule";
import type { RevisionPlan } from "@/lib/planning/types";
import { shiftStudyDayKey } from "@/lib/study/day";

/**
 * What a plan is counting down to, from today.
 *
 * Its exams where the student gave them, soonest first; otherwise the plan's
 * own finish, under the plan's name -- "Mocks in November" -- because that is
 * what a plan without exams was made for. Past dates are gone rather than shown
 * as negative days.
 */

export type PlanCountdownItem = {
  id: string;
  label: string;
  dayKey: string;
  daysLeft: number;
  scopeKey?: string;
  /** Planned sittings from today until the day before it. */
  sessionsBefore: number;
};

function sessionsBetween(plan: RevisionPlan, fromDayKey: string, beforeDayKey: string) {
  const span = Math.min(planDaysBetween(fromDayKey, beforeDayKey), 400);
  let count = 0;
  for (let offset = 0; offset < span; offset += 1) {
    const dayKey = shiftStudyDayKey(fromDayKey, offset);
    if (isWithinPlanHorizon(plan, dayKey)) count += planSessionsOn(plan.sessions, dayKey).length;
  }
  return count;
}

export function planCountdown(plan: RevisionPlan, todayDayKey: string, limit = 4): PlanCountdownItem[] {
  // Sorted here as well as on save: a plan edited in the console still counts down in order.
  const upcoming = (plan.exams ?? [])
    .filter((exam) => planDaysBetween(todayDayKey, exam.dayKey) >= 0)
    .sort((left, right) => left.dayKey.localeCompare(right.dayKey));
  const targets =
    upcoming.length > 0
      ? upcoming
      : planDaysBetween(todayDayKey, plan.endDayKey) >= 0
        ? [{ id: "plan-end", label: plan.title, dayKey: plan.endDayKey }]
        : [];
  return targets.slice(0, limit).map((target) => ({
    id: target.id,
    label: target.label,
    dayKey: target.dayKey,
    daysLeft: planDaysBetween(todayDayKey, target.dayKey),
    ...("scopeKey" in target && target.scopeKey ? { scopeKey: target.scopeKey } : {}),
    sessionsBefore: sessionsBetween(plan, todayDayKey, target.dayKey),
  }));
}

/** "Week 1 of 7": which week of the plan today falls in, and how many it has. */
export function planWeekOfPlan(plan: RevisionPlan, todayDayKey: string) {
  const total = Math.max(1, Math.ceil((planDaysBetween(plan.startDayKey, plan.endDayKey) + 1) / 7));
  const current = Math.min(total, Math.max(1, Math.floor(planDaysBetween(plan.startDayKey, todayDayKey) / 7) + 1));
  return { current, total };
}
