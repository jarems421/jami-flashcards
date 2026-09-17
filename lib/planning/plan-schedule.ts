import {
  PLAN_MAX_HORIZON_DAYS,
  PLAN_MAX_ITEMS_PER_DAY,
  PLAN_MINUTES_MAX,
  PLAN_MINUTES_MIN,
  PLAN_MINUTES_PER_ITEM,
  type PlanWeekday,
  type RevisionPlan,
  type RevisionPlanCadence,
  type RevisionPlanScope,
} from "@/lib/planning/types";
import { shiftStudyDayKey } from "@/lib/study/day";

/**
 * Which days a plan asks for, and how the time on one is divided.
 *
 * All calendar arithmetic here treats a day key as the plain date it prints,
 * never as a moment: a plan that says Monday means the student's Monday
 * wherever they are, and converting through a timestamp to find out which
 * weekday that is would make it depend on a timezone it has nothing to do with.
 */

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isPlanDayKey(value: unknown): value is string {
  return typeof value === "string" && DAY_KEY_PATTERN.test(value);
}

/**
 * The weekday a day key falls on, 0 for Sunday.
 *
 * Read through `Date.UTC` rather than the local constructor, so the answer is
 * the calendar's and not the reader's.
 */
export function planWeekdayOf(dayKey: string): PlanWeekday {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay() as PlanWeekday;
}

/** Whole days from one key to another, negative if the second is earlier. */
export function planDaysBetween(fromDayKey: string, toDayKey: string) {
  const at = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((at(toDayKey) - at(fromDayKey)) / (24 * 60 * 60 * 1000));
}

/** Every day key from start to end inclusive, bounded so a typo cannot run away. */
export function planDayKeys(startDayKey: string, endDayKey: string) {
  const span = planDaysBetween(startDayKey, endDayKey);
  if (span < 0) return [];
  const keys: string[] = [];
  for (let offset = 0; offset <= Math.min(span, PLAN_MAX_HORIZON_DAYS - 1); offset += 1) {
    keys.push(shiftStudyDayKey(startDayKey, offset));
  }
  return keys;
}

export function isWithinPlanHorizon(plan: Pick<RevisionPlan, "startDayKey" | "endDayKey">, dayKey: string) {
  return (
    planDaysBetween(plan.startDayKey, dayKey) >= 0 &&
    planDaysBetween(dayKey, plan.endDayKey) >= 0
  );
}

/** How long the plan asks for on this day, or 0 if it asks for nothing. */
export function planMinutesOn(cadence: readonly RevisionPlanCadence[], dayKey: string) {
  const weekday = planWeekdayOf(dayKey);
  return cadence
    .filter((entry) => entry.weekday === weekday)
    .reduce((total, entry) => total + clampPlanMinutes(entry.minutes), 0);
}

export function clampPlanMinutes(minutes: number) {
  if (!Number.isFinite(minutes)) return PLAN_MINUTES_MIN;
  return Math.round(Math.min(PLAN_MINUTES_MAX, Math.max(PLAN_MINUTES_MIN, minutes)));
}

/**
 * How many things to put in a session of this length.
 *
 * Time divided by roughly how long one thing takes, then capped -- because past
 * a handful, a session stops reading as a plan and starts reading as a list,
 * and the point of the cap is the feeling rather than the arithmetic. A long
 * session gets fewer, longer pieces of work rather than more of them.
 */
export function planItemCount(minutes: number) {
  const fits = Math.round(clampPlanMinutes(minutes) / PLAN_MINUTES_PER_ITEM);
  return Math.max(1, Math.min(PLAN_MAX_ITEMS_PER_DAY, fits));
}

/**
 * Which subject each slot of the day belongs to.
 *
 * Highest averages (Sainte-Lague): each slot goes to whichever scope has the
 * best weight-per-slot-already-taken. Two subjects weighted 2 and 1 over three
 * slots come out A, B, A rather than A, A, B -- the same share, spread through
 * the session instead of blocked at the front, which is both better revision
 * and what anyone would have written by hand.
 *
 * Deterministic: the same plan and the same day always give the same order, so
 * a slot id means the same thing from one read to the next.
 */
export function planScopeSequence(
  scopes: readonly RevisionPlanScope[],
  slots: number,
  scopeKeyOf: (scope: RevisionPlanScope) => string
) {
  const usable = scopes.filter((scope) => clampPlanWeight(scope.weight) > 0);
  if (usable.length === 0 || slots <= 0) return [];

  const taken = usable.map(() => 0);
  const sequence: string[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    let best = 0;
    let bestScore = -Infinity;
    usable.forEach((scope, index) => {
      const score = clampPlanWeight(scope.weight) / (2 * (taken[index] ?? 0) + 1);
      // Ties go to the earlier scope, which is the order the student set.
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    taken[best] = (taken[best] ?? 0) + 1;
    sequence.push(scopeKeyOf(usable[best] as RevisionPlanScope));
  }
  return sequence;
}

export function clampPlanWeight(weight: number) {
  if (!Number.isFinite(weight)) return 1;
  return Math.round(Math.min(3, Math.max(1, weight)));
}
