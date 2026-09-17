import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  clampPlanMinutes,
  isWithinPlanHorizon,
  planItemCount,
  planMinutesOn,
  planScopeSequence,
} from "@/lib/planning/plan-schedule";
import {
  planScopeKey,
  type PlanDay,
  type PlanSlot,
  type PlanSlotItem,
  type RevisionPlan,
  type RevisionPlanEntry,
} from "@/lib/planning/types";

/**
 * What a plan asks for on one day.
 *
 * The plan holds the shape; the Learning Engine holds the content. This is
 * where they meet, and it runs on every read rather than being written down --
 * so a plan made three weeks ago proposes what the evidence says today, not
 * what it said then.
 *
 * Pure. It is handed the actions it should choose from rather than fetching
 * them, so the same function serves Today, the plan page and the tests, and so
 * nothing about a plan can reach Firestore from inside the calculation.
 */

export type ResolvePlanDayInput = {
  plan: RevisionPlan;
  dayKey: string;
  /** This day's stored exceptions, if the student changed anything about it. */
  entry?: RevisionPlanEntry | null;
  /**
   * Candidate work, already ranked by the engine, grouped by scope key.
   *
   * Grouped rather than flat because a slot belongs to a subject before it
   * belongs to a position: the plan decides that Tuesday's second slot is
   * Chemistry, and only then asks what Chemistry needs.
   */
  actionsByScope: ReadonlyMap<string, readonly StudyAction[]>;
  /**
   * How many separate pieces of work the student is recorded as having done in
   * each scope on this day. Ticks slots in order; see `plan-completion.ts`.
   */
  activityByScope?: ReadonlyMap<string, number>;
};

/** Stable across reads so a manual tick keeps pointing at the same slot. */
export function planSlotId(planId: string, dayKey: string, position: number) {
  return `${planId}:${dayKey}:${position}`;
}

export function resolvePlanDay(input: ResolvePlanDayInput): PlanDay {
  const { plan, dayKey, entry, actionsByScope } = input;
  const base: PlanDay = {
    planId: plan.id,
    dayKey,
    scheduled: false,
    skipped: Boolean(entry?.skipped),
    minutes: 0,
    slots: [],
    doneCount: 0,
  };

  if (plan.status !== "active" || !isWithinPlanHorizon(plan, dayKey)) return base;

  const minutes = planMinutesOn(plan.cadence, dayKey);
  if (minutes <= 0) return base;

  const pinned = entry?.pinned ?? [];
  const count = Math.max(planItemCount(minutes), pinned.length);
  const sequence = planScopeSequence(plan.scopes, count, planScopeKey);
  // A pinned day with no scopes left still has its pinned work to show.
  const slotMinutes = Math.max(1, Math.round(clampPlanMinutes(minutes) / Math.max(1, count)));

  /*
   * Pinned items take the front of the day.
   *
   * They are a decision rather than a suggestion -- the student or Jami put
   * that thing on that date -- so they are not competing with the engine's
   * ranking for a place, and they are not dropped when the engine stops
   * recommending them.
   */
  const slots: PlanSlot[] = [];
  const used = new Set<string>();
  pinned.forEach((item, index) => {
    used.add(item.actionId);
    slots.push({
      id: planSlotId(plan.id, dayKey, index),
      position: index,
      minutes: slotMinutes,
      scopeKey: sequence[index] ?? planScopeKey(plan.scopes[0] ?? {}),
      item: { kind: "pinned", pinned: item },
      state: "todo",
    });
  });

  // Where each scope has got to, so a day never proposes the same work twice.
  const taken = new Map<string, number>();
  for (let position = pinned.length; position < count; position += 1) {
    const scopeKey = sequence[position];
    let item: PlanSlotItem = { kind: "open" };
    if (scopeKey) {
      const candidates = actionsByScope.get(scopeKey) ?? [];
      let cursor = taken.get(scopeKey) ?? 0;
      while (cursor < candidates.length) {
        const candidate = candidates[cursor] as StudyAction;
        cursor += 1;
        // Only work that leads somewhere: a slot the student cannot act on is
        // worse than an honest gap, because it looks like something to do.
        if (!candidate.destination || used.has(candidate.id)) continue;
        used.add(candidate.id);
        item = { kind: "action", action: candidate };
        break;
      }
      taken.set(scopeKey, cursor);
    }
    slots.push({
      id: planSlotId(plan.id, dayKey, position),
      position,
      minutes: slotMinutes,
      scopeKey: scopeKey ?? "none",
      item,
      state: "todo",
    });
  }

  const resolved = applyPlanDayCompletion(slots, {
    skipped: Boolean(entry?.skipped),
    completedSlotIds: entry?.completedSlotIds ?? [],
    activityByScope: input.activityByScope ?? new Map(),
  });

  return {
    ...base,
    scheduled: true,
    minutes,
    slots: resolved,
    doneCount: resolved.filter((slot) => slot.state === "done").length,
  };
}

/**
 * Which of the day's slots are done, and how they came to be.
 *
 * Recorded work comes first and a manual tick second, because a student who
 * actually did the work should never have to also say so. Work is matched to
 * slots by subject and then in order: two recorded sessions of Chemistry tick
 * the day's first two Chemistry slots, whichever they happen to be.
 *
 * Nothing here is evidence about learning. A ticked slot means time was spent,
 * which the profile already knows far more precisely from the work itself.
 */
export function applyPlanDayCompletion(
  slots: readonly PlanSlot[],
  input: {
    skipped: boolean;
    completedSlotIds: readonly string[];
    activityByScope: ReadonlyMap<string, number>;
  }
): PlanSlot[] {
  if (input.skipped) {
    return slots.map((slot) => ({ ...slot, state: "skipped" as const }));
  }

  const remaining = new Map(input.activityByScope);
  const manual = new Set(input.completedSlotIds);

  return slots.map((slot) => {
    const left = remaining.get(slot.scopeKey) ?? 0;
    // An open slot has no work to have been done, so recorded activity is not
    // spent on it -- it belongs to the next slot that actually asked for
    // something.
    if (left > 0 && slot.item.kind !== "open") {
      remaining.set(slot.scopeKey, left - 1);
      return { ...slot, state: "done" as const, completedBy: "activity" as const };
    }
    if (manual.has(slot.id)) {
      return { ...slot, state: "done" as const, completedBy: "manual" as const };
    }
    return slot;
  });
}
