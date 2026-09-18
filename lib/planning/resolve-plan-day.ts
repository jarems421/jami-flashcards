import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  clampPlanMinutes,
  isWithinPlanHorizon,
  planSessionEndTime,
  planSessionsOn,
  planScopeSequence,
  planSlotCounts,
} from "@/lib/planning/plan-schedule";
import {
  planScopeKey,
  type PlanDay,
  type PlanDaySession,
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

/**
 * Stable across reads so a manual tick keeps pointing at the same slot.
 *
 * Deliberately positional rather than keyed on a session id. A day's slots are
 * numbered in the order they are worked through, whichever sitting they fall
 * in, which means a plan migrated from version 1 -- one sitting a day -- keeps
 * every id it had, and nobody loses yesterday's ticks to a schema change.
 */
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
    sessions: [],
    slots: [],
    doneCount: 0,
  };

  if (plan.status !== "active" || !isWithinPlanHorizon(plan, dayKey)) return base;

  const sessions = planSessionsOn(plan.sessions, dayKey);
  if (sessions.length === 0) return base;

  const pinned = entry?.pinned ?? [];
  const counts = planSlotCounts(sessions, pinned.length);

  /*
   * Which subject each slot is for, decided before any work is chosen.
   *
   * A sitting the student pinned to a subject fills every one of its slots with
   * that subject. The rest are dealt out by weight across the whole plan, in
   * the order they will be worked through. The weighting does not subtract what
   * the pinned sittings already took -- a student who says "Monday is
   * Chemistry" has said what Monday is for, not that Chemistry should now get
   * less of Tuesday.
   */
  const unscopedCount = sessions.reduce(
    (total, session, index) => total + (session.scopeKey ? 0 : (counts[index] as number)),
    0
  );
  const weighted = planScopeSequence(plan.scopes, unscopedCount, planScopeKey);
  const fallbackScopeKey = planScopeKey(plan.scopes[0] ?? {});
  let weightedCursor = 0;

  type SlotPlan = { sessionIndex: number; scopeKey: string; minutes: number };
  const layout: SlotPlan[] = [];
  sessions.forEach((session, sessionIndex) => {
    const count = counts[sessionIndex] as number;
    const slotMinutes = Math.max(1, Math.round(clampPlanMinutes(session.minutes) / Math.max(1, count)));
    for (let index = 0; index < count; index += 1) {
      const scopeKey = session.scopeKey
        ? session.scopeKey
        : weighted[weightedCursor++] ?? fallbackScopeKey;
      layout.push({ sessionIndex, scopeKey, minutes: slotMinutes });
    }
  });

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
  // Where each scope has got to, so a day never proposes the same work twice.
  const taken = new Map<string, number>();

  layout.forEach((entryPlan, position) => {
    const pinnedItem = pinned[position];
    if (pinnedItem) {
      used.add(pinnedItem.actionId);
      slots.push({
        id: planSlotId(plan.id, dayKey, position),
        position,
        minutes: entryPlan.minutes,
        scopeKey: entryPlan.scopeKey,
        item: { kind: "pinned", pinned: pinnedItem },
        state: "todo",
      });
      return;
    }

    const scopeKey = entryPlan.scopeKey;
    let item: PlanSlotItem = { kind: "open" };
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

    slots.push({
      id: planSlotId(plan.id, dayKey, position),
      position,
      minutes: entryPlan.minutes,
      scopeKey,
      item,
      state: "todo",
    });
  });

  const resolved = applyPlanDayCompletion(slots, {
    skipped: Boolean(entry?.skipped),
    completedSlotIds: entry?.completedSlotIds ?? [],
    activityByScope: input.activityByScope ?? new Map(),
  });

  const daySessions: PlanDaySession[] = sessions.map((session, sessionIndex) => {
    const sessionSlots = resolved.filter(
      (_, position) => (layout[position] as SlotPlan).sessionIndex === sessionIndex
    );
    return {
      id: session.id,
      index: sessionIndex,
      minutes: clampPlanMinutes(session.minutes),
      ...(session.startTime ? { startTime: session.startTime } : {}),
      ...(session.startTime
        ? { endTime: planSessionEndTime(session.startTime, session.minutes) }
        : {}),
      ...(session.label ? { label: session.label } : {}),
      scopeKey: sessionSlots[0]?.scopeKey ?? session.scopeKey ?? fallbackScopeKey,
      slots: sessionSlots,
      doneCount: sessionSlots.filter((slot) => slot.state === "done").length,
    };
  });

  return {
    ...base,
    scheduled: true,
    minutes: sessions.reduce((total, session) => total + clampPlanMinutes(session.minutes), 0),
    sessions: daySessions,
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
