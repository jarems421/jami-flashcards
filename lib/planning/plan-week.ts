import {
  clampPlanMinutes,
  isWithinPlanHorizon,
  planDaysBetween,
  planSessionsOn,
  planSlotCounts,
  planWeekdayOf,
  planWeekStartDayKey,
} from "@/lib/planning/plan-schedule";
import type { PlanWeekday, RevisionPlan, RevisionPlanEntry } from "@/lib/planning/types";
import { shiftStudyDayKey } from "@/lib/study/day";

/**
 * A week of the plan at a glance.
 *
 * Deliberately cheap, and deliberately ignorant. It reads the plan's shape and
 * whatever the student changed about each day, and it never asks the Learning
 * Engine what is in a slot -- the engine is consulted for the one day actually
 * being worked, because asking it for seven would mean seven profile reads to
 * draw seven dots.
 *
 * That has a consequence worth being honest about: `doneCount` on a past day
 * counts only what the student ticked by hand. Work Jami recorded ticks slots
 * live in `resolvePlanDay`, and reconstructing that for last Tuesday would mean
 * replaying the engine as it was then, which it cannot do. So a past day here
 * says how much the student marked off, and today -- the day that matters -- is
 * shown fully resolved by the caller.
 */

export type PlanWeekDay = {
  dayKey: string;
  weekday: PlanWeekday;
  isToday: boolean;
  isPast: boolean;
  /** Whether the plan asks for anything on this day at all. */
  scheduled: boolean;
  /** Whether the day falls inside the plan's dates. */
  withinPlan: boolean;
  skipped: boolean;
  minutes: number;
  sessionCount: number;
  /** How many slots the day asks for, before the engine fills them. */
  expectedCount: number;
  /** How many of them are known to be done. See the note above. */
  doneCount: number;
};

export type PlanWeek = {
  startDayKey: string;
  endDayKey: string;
  days: PlanWeekDay[];
  /** Total minutes the plan asks for across the week. */
  minutes: number;
};

export const PLAN_WEEK_LENGTH = 7;

export function buildPlanWeek(input: {
  plan: RevisionPlan;
  entries: readonly RevisionPlanEntry[];
  todayDayKey: string;
  /** Defaults to the Monday of the week containing today. */
  weekStartDayKey?: string;
}): PlanWeek {
  const startDayKey = input.weekStartDayKey ?? planWeekStartDayKey(input.todayDayKey);
  const byDayKey = new Map(input.entries.map((entry) => [entry.dayKey, entry]));

  const days: PlanWeekDay[] = [];
  for (let offset = 0; offset < PLAN_WEEK_LENGTH; offset += 1) {
    const dayKey = shiftStudyDayKey(startDayKey, offset);
    const entry = byDayKey.get(dayKey);
    const withinPlan = input.plan.status === "active" && isWithinPlanHorizon(input.plan, dayKey);
    const sessions = withinPlan ? planSessionsOn(input.plan.sessions, dayKey) : [];
    const pinnedCount = entry?.pinned?.length ?? 0;
    const counts = sessions.length > 0 ? planSlotCounts(sessions, pinnedCount) : [];
    const expectedCount = counts.reduce((total, count) => total + count, 0);
    const distance = planDaysBetween(input.todayDayKey, dayKey);

    days.push({
      dayKey,
      weekday: planWeekdayOf(dayKey),
      isToday: distance === 0,
      isPast: distance < 0,
      scheduled: sessions.length > 0,
      withinPlan,
      skipped: Boolean(entry?.skipped),
      minutes: sessions.reduce((total, session) => total + clampPlanMinutes(session.minutes), 0),
      sessionCount: sessions.length,
      expectedCount,
      // Bounded by what the day actually asks for: a tick left behind by an
      // edit that shortened the day should not make it look overachieved.
      doneCount: Math.min(expectedCount, entry?.completedSlotIds?.length ?? 0),
    });
  }

  return {
    startDayKey,
    endDayKey: shiftStudyDayKey(startDayKey, PLAN_WEEK_LENGTH - 1),
    days,
    minutes: days.reduce((total, day) => total + day.minutes, 0),
  };
}

/**
 * The next day the plan asks for anything, after this one.
 *
 * Used for the single line of look-ahead under today's agenda. Bounded at a
 * fortnight: if a plan has nothing in the next two weeks, "nothing coming up"
 * is the honest answer rather than a date far enough away to be noise.
 */
export const PLAN_LOOKAHEAD_DAYS = 14;

export function nextScheduledPlanDay(plan: RevisionPlan, fromDayKey: string) {
  for (let offset = 1; offset <= PLAN_LOOKAHEAD_DAYS; offset += 1) {
    const dayKey = shiftStudyDayKey(fromDayKey, offset);
    if (!isWithinPlanHorizon(plan, dayKey)) break;
    const sessions = planSessionsOn(plan.sessions, dayKey);
    if (sessions.length > 0) {
      return {
        dayKey,
        weekday: planWeekdayOf(dayKey),
        minutes: sessions.reduce((total, session) => total + clampPlanMinutes(session.minutes), 0),
        sessions,
      };
    }
  }
  return null;
}
