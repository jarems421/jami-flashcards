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
  isOwnPlanTask,
  planScopeKey,
  type PinnedPlanItem,
  type PlanDay,
  type PlanDaySession,
  type PlanSlot,
  type PlanSlotItem,
  type RevisionPlan,
  type RevisionPlanEntry,
  type RevisionPlanSession,
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

/**
 * How many pieces of work each sitting holds, given what was pinned to the day.
 *
 * A sitting holds at least what the student added to it: a task written into
 * Thursday's Chemistry is not bumped into the English session because
 * Chemistry's time was already spoken for.
 */
export function planDaySlotCounts(
  sessions: readonly RevisionPlanSession[],
  pinned: readonly PinnedPlanItem[]
): number[] {
  const counts = planSlotCounts(sessions, pinned.length);
  return counts.map((count, index) =>
    Math.max(count, pinned.filter((item) => item.sessionId === sessions[index]?.id).length)
  );
}

/**
 * Which pinned item sits in each position of the day, or nothing.
 *
 * Pins that name no sitting take the day's first places, as they always have.
 * Pins added to a sitting take the end of it, in the order they were added,
 * so the engine's work ahead of them keeps its positions -- and with them the
 * ticks already stored against those positions.
 *
 * Except behind a place already ticked. That suggestion is work the student
 * did, and a new task put on top of it hid it and left its tick counted against
 * something no longer there; put before it, the task moved the engine's later
 * work along and the tick landed on different work. So a task takes only the
 * sitting's free places after its last tick, and a sitting with none left gets
 * a new place for it -- added after the whole day, so nothing already in the
 * day moves, and shown at the end of its own sitting.
 */
function placePinned(
  sessions: readonly RevisionPlanSession[],
  layout: readonly { sessionIndex: number }[],
  pinned: readonly PinnedPlanItem[],
  isTicked: (position: number) => boolean
) {
  const assigned: (PinnedPlanItem | undefined)[] = layout.map(() => undefined);
  const appended: { sessionIndex: number; item: PinnedPlanItem }[] = [];
  const bySession = new Map<number, PinnedPlanItem[]>();
  const loose: PinnedPlanItem[] = [];
  for (const item of pinned) {
    const sessionIndex = item.sessionId ? sessions.findIndex((session) => session.id === item.sessionId) : -1;
    if (sessionIndex < 0) loose.push(item);
    else bySession.set(sessionIndex, [...(bySession.get(sessionIndex) ?? []), item]);
  }
  let cursor = 0;
  for (const item of loose) {
    while (cursor < assigned.length && assigned[cursor]) cursor += 1;
    if (cursor >= assigned.length) break;
    assigned[cursor] = item;
  }
  for (const [sessionIndex, items] of bySession) {
    const positions = layout
      .map((slot, index) => (slot.sessionIndex === sessionIndex ? index : -1))
      .filter((index) => index >= 0);
    const lastTicked = Math.max(-1, ...positions.filter(isTicked));
    const free = positions.filter((index) => index > lastTicked && !assigned[index]);
    const places = free.slice(Math.max(0, free.length - items.length));
    // Never dropped: what does not fit gets a place of its own.
    const unplaced = items.length - places.length;
    items.forEach((item, index) => {
      if (index < unplaced) appended.push({ sessionIndex, item });
      else assigned[places[index - unplaced] as number] = item;
    });
  }
  return { assigned, appended };
}

/**
 * What a tick is stored against.
 *
 * A slot's position, for the engine's work: the engine may put different work
 * in the same place as the day goes on, and a tick says that place was done.
 * A pin added to a sitting is the student's own decision about one thing, so
 * its tick follows that thing wherever it sits -- adding a second task must not
 * move the first one's tick onto it.
 */
export function planSlotTickKey(slot: PlanSlot) {
  return slot.item.kind === "pinned" && slot.item.pinned.sessionId
    ? `pin:${slot.item.pinned.actionId}`
    : slot.id;
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
  const counts = planDaySlotCounts(sessions, pinned);

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
   * Pinned items take the front of their sitting, or of the day.
   *
   * They are a decision rather than a suggestion -- the student or Jami put
   * that thing on that date -- so they are not competing with the engine's
   * ranking for a place, and they are not dropped when the engine stops
   * recommending them. One added to a particular sitting goes there; the rest
   * fill the day's first free places, which is where every pin went before a
   * pin could name its sitting, so no earlier day's ticks move.
   */
  const completed = new Set(entry?.completedSlotIds ?? []);
  const { assigned, appended } = placePinned(sessions, layout, pinned, (position) =>
    completed.has(planSlotId(plan.id, dayKey, position))
  );
  for (const extra of appended) {
    const sitting = layout.filter((slot) => slot.sessionIndex === extra.sessionIndex).at(-1);
    const session = sessions[extra.sessionIndex] as RevisionPlanSession;
    layout.push({
      sessionIndex: extra.sessionIndex,
      scopeKey: sitting?.scopeKey ?? session.scopeKey ?? fallbackScopeKey,
      minutes: sitting?.minutes ?? clampPlanMinutes(session.minutes),
    });
    assigned.push(extra.item);
  }
  const slots: PlanSlot[] = [];
  const used = new Set<string>();
  // Where each scope has got to, so a day never proposes the same work twice.
  const taken = new Map<string, number>();

  layout.forEach((entryPlan, position) => {
    const pinnedItem = assigned[position];
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
    // something. Nor is a task the student wrote: reviewing Chemistry cards is
    // not "redo question 3 from Monday's paper", and only they can say it is done.
    const ownTask = slot.item.kind === "pinned" && isOwnPlanTask(slot.item.pinned);
    if (left > 0 && slot.item.kind !== "open" && !ownTask) {
      remaining.set(slot.scopeKey, left - 1);
      return { ...slot, state: "done" as const, completedBy: "activity" as const };
    }
    if (manual.has(planSlotTickKey(slot))) {
      return { ...slot, state: "done" as const, completedBy: "manual" as const };
    }
    return slot;
  });
}
