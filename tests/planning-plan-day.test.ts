import { describe, expect, it } from "vitest";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  planDaysBetween,
  planItemCount,
  planMinutesOn,
  planScopeSequence,
  planWeekdayOf,
} from "@/lib/planning/plan-schedule";
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
    schemaVersion: 1,
    title: "Summer exams",
    status: "active",
    origin: "manual",
    startDayKey: MONDAY,
    endDayKey: SUNDAY,
    scopes: [{ folderId: "biology", weight: 1 }],
    cadence: [{ weekday: 1, minutes: 45 }],
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
    const cadence = [
      { weekday: 1 as const, minutes: 45 },
      { weekday: 3 as const, minutes: 30 },
    ];
    expect(planMinutesOn(cadence, MONDAY)).toBe(45);
    expect(planMinutesOn(cadence, TUESDAY)).toBe(0);
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
