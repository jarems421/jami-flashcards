import { describe, expect, it } from "vitest";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  planDaysBetween,
  planItemCount,
  planMinutesOn,
  planScopeSequence,
  planWeekdayOf,
} from "@/lib/planning/plan-schedule";
import { migrateStoredRevisionPlan } from "@/lib/planning/migrate-plan";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import { resolvePlanDay } from "@/lib/planning/resolve-plan-day";
import {
  planScopeKey,
  type RevisionPlan,
  type RevisionPlanEntry,
} from "@/lib/planning/types";

const MONDAY = "2026-09-14";
const TUESDAY = "2026-09-15";
const SUNDAY = "2026-09-20";

function action(overrides: Partial<StudyAction> & { id: string }): StudyAction {
  return {
    reason: "low_mastery",
    action: "practice",
    priority: 0.5,
    target: { kind: "topic", topicKey: `topic:${overrides.id}`, source: "student-topic", label: overrides.id },
    evidence: { count: 4, uniqueItems: 3, sources: ["flashcards"] },
    scope: { folderId: "biology" },
    explanationCode: "low_mastery.practice",
    destination: { kind: "flashcards", href: `/study?x=${overrides.id}` },
    ...overrides,
  } as StudyAction;
}

function plan(overrides: Partial<RevisionPlan> = {}): RevisionPlan {
  return {
    id: "plan-1",
    schemaVersion: 2,
    title: "Summer exams",
    status: "active",
    origin: "manual",
    startDayKey: MONDAY,
    endDayKey: SUNDAY,
    scopes: [{ folderId: "biology", weight: 1 }],
    sessions: [{ id: "w1", weekday: 1, minutes: 45 }],
    emphasis: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const scoped = (actions: StudyAction[], key = "folder:biology") =>
  new Map<string, StudyAction[]>([[key, actions]]);

describe("plan scheduling", () => {
  it("reads a day key as a calendar date, not a moment", () => {
    // Going through a timestamp would make a plan's Monday depend on where the
    // reader is, which is nothing to do with the plan.
    expect(planWeekdayOf(MONDAY)).toBe(1);
    expect(planWeekdayOf(SUNDAY)).toBe(0);
    expect(planDaysBetween(MONDAY, SUNDAY)).toBe(6);
    expect(planDaysBetween(SUNDAY, MONDAY)).toBe(-6);
  });

  it("asks for time only on the days it was given", () => {
    const sessions = [
      { id: "w1", weekday: 1 as const, minutes: 45 },
      { id: "w3", weekday: 3 as const, minutes: 30 },
    ];
    expect(planMinutesOn(sessions, MONDAY)).toBe(45);
    expect(planMinutesOn(sessions, TUESDAY)).toBe(0);
  });

  it("fits more into a longer session, up to a point", () => {
    expect(planItemCount(15)).toBe(1);
    expect(planItemCount(45)).toBe(3);
    // Past a handful a session stops reading as a plan and starts reading as a
    // list, so a three-hour sitting gets longer pieces rather than more of them.
    expect(planItemCount(180)).toBe(4);
  });

  it("spreads a heavier subject through the session rather than blocking it", () => {
    const scopes = [
      { folderId: "chemistry", weight: 2 },
      { folderId: "biology", weight: 1 },
    ];
    expect(planScopeSequence(scopes, 3, planScopeKey)).toEqual([
      "folder:chemistry",
      "folder:biology",
      "folder:chemistry",
    ]);
  });
});

describe("resolving a day", () => {
  it("fills the day from the engine, in its order", () => {
    const day = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      actionsByScope: scoped([action({ id: "a" }), action({ id: "b" }), action({ id: "c" })]),
    });

    expect(day.scheduled).toBe(true);
    expect(day.minutes).toBe(45);
    expect(day.slots).toHaveLength(3);
    expect(day.slots.map((slot) => (slot.item.kind === "action" ? slot.item.action.id : null))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("asks for nothing on a day the plan does not cover", () => {
    const day = resolvePlanDay({ plan: plan(), dayKey: TUESDAY, actionsByScope: scoped([]) });
    expect(day.scheduled).toBe(false);
    expect(day.slots).toEqual([]);
  });

  it("stays inside its own horizon and its own status", () => {
    const outside = resolvePlanDay({
      plan: plan({ endDayKey: MONDAY }),
      dayKey: "2026-09-21",
      actionsByScope: scoped([action({ id: "a" })]),
    });
    expect(outside.scheduled).toBe(false);

    const archived = resolvePlanDay({
      plan: plan({ status: "archived" }),
      dayKey: MONDAY,
      actionsByScope: scoped([action({ id: "a" })]),
    });
    expect(archived.scheduled).toBe(false);
  });

  it("leaves a slot honestly open rather than filling it with a dead end", () => {
    /*
     * An action with no destination is a thing Jami cannot carry out -- a
     * diagnosis on a topic with no cards and no question bank. Shown in a slot
     * it would read as something to do.
     */
    const day = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      actionsByScope: scoped([
        action({ id: "a" }),
        { ...action({ id: "dead" }), destination: undefined } as StudyAction,
      ]),
    });

    expect(day.slots[0]?.item.kind).toBe("action");
    expect(day.slots[1]?.item.kind).toBe("open");
    expect(day.slots[2]?.item.kind).toBe("open");
  });

  it("never proposes the same work twice in a day", () => {
    const repeated = action({ id: "a" });
    const day = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      actionsByScope: scoped([repeated, repeated, repeated]),
    });
    expect(day.slots.filter((slot) => slot.item.kind === "action")).toHaveLength(1);
  });

  it("keeps a pinned item at the front, and keeps it when the engine moves on", () => {
    // A pin is a decision, not a recommendation: the student asked for that
    // thing on that day, so it does not compete for a place and is not dropped.
    const entry: RevisionPlanEntry = {
      dayKey: MONDAY,
      pinned: [{ actionId: "paper-2h", label: "Paper 2H", href: "/practice/2h" }],
    };
    const day = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      entry,
      actionsByScope: scoped([action({ id: "a" })]),
    });

    expect(day.slots[0]?.item).toEqual({ kind: "pinned", pinned: entry.pinned?.[0] });
    expect(day.slots[1]?.item.kind).toBe("action");
  });

  it("ticks a slot off when the work was actually recorded", () => {
    const day = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      actionsByScope: scoped([action({ id: "a" }), action({ id: "b" }), action({ id: "c" })]),
      activityByScope: new Map([["folder:biology", 2]]),
    });

    expect(day.slots.map((slot) => slot.state)).toEqual(["done", "done", "todo"]);
    expect(day.slots[0]?.completedBy).toBe("activity");
    expect(day.doneCount).toBe(2);
  });

  it("lets the student tick work Jami could not see", () => {
    const first = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      actionsByScope: scoped([action({ id: "a" }), action({ id: "b" }), action({ id: "c" })]),
    });
    const target = first.slots[1]?.id as string;

    const day = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      entry: { dayKey: MONDAY, completedSlotIds: [target] },
      actionsByScope: scoped([action({ id: "a" }), action({ id: "b" }), action({ id: "c" })]),
    });

    expect(day.slots[1]?.state).toBe("done");
    expect(day.slots[1]?.completedBy).toBe("manual");
    expect(day.slots[0]?.state).toBe("todo");
  });

  it("does not spend recorded work on a slot that asked for nothing", () => {
    // An open slot has no work to have been done, so the session the student
    // did belongs to the next slot that actually wanted something.
    const day = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      actionsByScope: scoped([]),
      activityByScope: new Map([["folder:biology", 1]]),
    });
    expect(day.slots.every((slot) => slot.state === "todo")).toBe(true);
  });

  it("marks a skipped day skipped rather than undone", () => {
    const day = resolvePlanDay({
      plan: plan(),
      dayKey: MONDAY,
      entry: { dayKey: MONDAY, skipped: true },
      actionsByScope: scoped([action({ id: "a" })]),
    });
    expect(day.slots.every((slot) => slot.state === "skipped")).toBe(true);
    expect(day.skipped).toBe(true);
  });

  it("gives slot ids that survive a refresh", () => {
    const once = resolvePlanDay({ plan: plan(), dayKey: MONDAY, actionsByScope: scoped([action({ id: "a" })]) });
    const again = resolvePlanDay({ plan: plan(), dayKey: MONDAY, actionsByScope: scoped([action({ id: "a" })]) });
    expect(once.slots.map((slot) => slot.id)).toEqual(again.slots.map((slot) => slot.id));
  });
});

describe("a day with more than one sitting", () => {
  const twoSittings = () =>
    plan({
      scopes: [
        { folderId: "biology", weight: 1 },
        { folderId: "chemistry", weight: 1 },
      ],
      sessions: [
        { id: "evening", weekday: 1, minutes: 30, startTime: "18:00" },
        { id: "after-school", weekday: 1, minutes: 45, startTime: "16:30" },
      ],
    });

  it("puts the sittings in time order, whatever order they were written in", () => {
    // A student who added the evening first still means half four to come
    // first, and a timetable that disagreed with the clock would be useless.
    const day = resolvePlanDay({
      plan: twoSittings(),
      dayKey: MONDAY,
      actionsByScope: new Map(),
    });
    expect(day.sessions.map((session) => session.startTime)).toEqual(["16:30", "18:00"]);
    expect(day.sessions.map((session) => session.id)).toEqual(["after-school", "evening"]);
  });

  it("puts an untimed sitting after the timed ones", () => {
    const day = resolvePlanDay({
      plan: plan({
        sessions: [
          { id: "whenever", weekday: 1, minutes: 30 },
          { id: "four-thirty", weekday: 1, minutes: 30, startTime: "16:30" },
        ],
      }),
      dayKey: MONDAY,
      actionsByScope: new Map(),
    });
    expect(day.sessions.map((session) => session.id)).toEqual(["four-thirty", "whenever"]);
  });

  it("sizes each sitting from its own length, not from the day's total", () => {
    /*
     * Forty-five minutes then thirty is three things and two, not five things
     * of fifteen minutes each. Dividing the day's total was the old behaviour
     * and it made a long first sitting look like a short one.
     */
    const day = resolvePlanDay({
      plan: twoSittings(),
      dayKey: MONDAY,
      actionsByScope: new Map(),
    });
    expect(day.sessions[0]?.slots.length).toBe(3);
    expect(day.sessions[1]?.slots.length).toBe(2);
    expect(day.sessions[0]?.slots[0]?.minutes).toBe(15);
    expect(day.sessions[1]?.slots[0]?.minutes).toBe(15);
    expect(day.minutes).toBe(75);
  });

  it("keeps the day's flat slot list in the order it is worked through", () => {
    const day = resolvePlanDay({
      plan: twoSittings(),
      dayKey: MONDAY,
      actionsByScope: new Map(),
    });
    expect(day.slots.map((slot) => slot.position)).toEqual([0, 1, 2, 3, 4]);
    expect(day.slots.length).toBe(
      day.sessions.reduce((total, session) => total + session.slots.length, 0)
    );
  });

  it("gives a pinned sitting entirely to its subject", () => {
    const day = resolvePlanDay({
      plan: plan({
        scopes: [
          { folderId: "biology", weight: 1 },
          { folderId: "chemistry", weight: 1 },
        ],
        sessions: [
          { id: "chem", weekday: 1, minutes: 30, scopeKey: "folder:chemistry" },
          { id: "open", weekday: 1, minutes: 30 },
        ],
      }),
      dayKey: MONDAY,
      actionsByScope: new Map(),
    });

    // The pinned sitting is all Chemistry; the unpinned one is still dealt out
    // by weight across everything the plan covers.
    expect(day.sessions[0]?.slots.every((slot) => slot.scopeKey === "folder:chemistry")).toBe(true);
    expect(day.sessions[1]?.slots.map((slot) => slot.scopeKey)).toEqual([
      "folder:biology",
      "folder:chemistry",
    ]);
  });

  it("caps how much one day may ask for", () => {
    const day = resolvePlanDay({
      plan: plan({
        sessions: [
          { id: "a", weekday: 1, minutes: 240 },
          { id: "b", weekday: 1, minutes: 240 },
          { id: "c", weekday: 1, minutes: 240 },
        ],
      }),
      dayKey: MONDAY,
      actionsByScope: new Map(),
    });
    // Twelve things in one day is a backlog, not a plan. The later sittings are
    // trimmed first, and none of them is emptied.
    expect(day.slots.length).toBe(8);
    expect(day.sessions.every((session) => session.slots.length >= 1)).toBe(true);
  });

  it("works out when a sitting finishes", () => {
    const day = resolvePlanDay({
      plan: twoSittings(),
      dayKey: MONDAY,
      actionsByScope: new Map(),
    });
    expect(day.sessions[0]?.endTime).toBe("17:15");
    expect(day.sessions[1]?.endTime).toBe("18:30");
  });
});

describe("a plan written before sessions existed", () => {
  it("keeps every slot id, so nobody loses yesterday's ticks", () => {
    /*
     * The one thing a schema change must not do here. Slot ids are positional
     * and a migrated day has exactly the sittings it had before, so the ids a
     * version 1 plan produced are the ids it still produces -- which is what
     * keeps `completedSlotIds` pointing at the right things.
     */
    const stored = {
      title: "Summer exams",
      status: "active",
      origin: "manual",
      startDayKey: MONDAY,
      endDayKey: SUNDAY,
      scopes: [{ folderId: "biology", weight: 1 }],
      cadence: [{ weekday: 1, minutes: 45 }],
      emphasis: [],
    };

    const migrated = normalizeRevisionPlanDraft(
      migrateStoredRevisionPlan(stored) as never
    ).draft;
    expect(migrated.sessions).toEqual([{ id: "w1", weekday: 1, minutes: 45 }]);

    const day = resolvePlanDay({
      plan: { ...plan(), ...migrated },
      dayKey: MONDAY,
      actionsByScope: scoped([action({ id: "a" })]),
    });
    expect(day.slots.map((slot) => slot.id)).toEqual([
      "plan-1:2026-09-14:0",
      "plan-1:2026-09-14:1",
      "plan-1:2026-09-14:2",
    ]);
  });

  it("leaves a plan that already has sessions alone", () => {
    const stored = {
      sessions: [{ id: "s0", weekday: 3, minutes: 30 }],
      cadence: [{ weekday: 1, minutes: 45 }],
    };
    expect(migrateStoredRevisionPlan(stored).sessions).toEqual(stored.sessions);
  });
});
