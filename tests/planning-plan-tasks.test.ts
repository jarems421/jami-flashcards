import { describe, expect, it } from "vitest";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import { normalizeRevisionPlanDraft, unusedPlanExamId } from "@/lib/planning/normalize-plan";
import { planCountdown, planWeekOfPlan } from "@/lib/planning/plan-countdown";
import {
  nextPlanSuggestion,
  ownPlanTask,
  pinnedFromAction,
  planSessionFocus,
  planTask,
  planUpNext,
} from "@/lib/planning/plan-tasks";
import { planSlotTickKey, resolvePlanDay } from "@/lib/planning/resolve-plan-day";
import type { PinnedPlanItem, RevisionPlan, RevisionPlanEntry } from "@/lib/planning/types";

/**
 * Tasks in a plan: what Jami suggests, what the student adds, and which one is
 * next. The student's own tasks are decisions, so they go where they were put,
 * their ticks follow them, and nothing but the student ticks them.
 */

const THURSDAY = "2026-09-24";

function action(id: string, overrides: Partial<StudyAction> = {}): StudyAction {
  return {
    id,
    reason: "persistent_error",
    action: "practice",
    priority: 0.5,
    target: { kind: "topic", topicKey: `topic:${id}`, source: "student-topic", label: id },
    evidence: { count: 2, uniqueItems: 2, sources: ["practice"] },
    scope: { folderId: "chemistry" },
    explanationCode: "persistent_error.practice",
    destination: { kind: "question-practice", href: `/practice?x=${id}`, selection: { topicIds: [`topic:${id}`] } },
    ...overrides,
  } as StudyAction;
}

function plan(overrides: Partial<RevisionPlan> = {}): RevisionPlan {
  return {
    id: "plan-1",
    schemaVersion: 2,
    title: "Mocks in November",
    status: "active",
    origin: "manual",
    startDayKey: "2026-09-21",
    endDayKey: "2026-11-20",
    scopes: [{ folderId: "chemistry", weight: 2 }, { folderId: "english", weight: 1 }],
    sessions: [
      { id: "chem", weekday: 4, minutes: 60, startTime: "16:30", scopeKey: "folder:chemistry" },
      { id: "eng", weekday: 4, minutes: 30, startTime: "19:00", scopeKey: "folder:english" },
    ],
    emphasis: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const actions = new Map<string, StudyAction[]>([
  ["folder:chemistry", [action("titrations"), action("moles"), action("bonding"), action("rates"), action("electrolysis")]],
  ["folder:english", [action("language analysis", { scope: { folderId: "english" } })]],
]);

function day(entry?: RevisionPlanEntry, activity = new Map<string, number>()) {
  return resolvePlanDay({ plan: plan(), dayKey: THURSDAY, entry: entry ?? null, actionsByScope: actions, activityByScope: activity });
}

const chemistry = (resolved: ReturnType<typeof day>) => resolved.sessions.find((session) => session.id === "chem")!;

describe("adding a task to a session", () => {
  it("puts the student's task at the end of that session, not the front of the day", () => {
    const own = ownPlanTask("Redo question 3 from Monday's paper", "chem", "q3")!;
    const resolved = day({ dayKey: THURSDAY, pinned: [own] });
    const labels = chemistry(resolved).slots.map((slot) => planTask(slot).label);
    expect(labels.at(-1)).toBe("Redo question 3 from Monday's paper");
    // Jami's work ahead of it keeps its places, and with them its ticks.
    expect(chemistry(day()).slots[0]?.id).toBe(chemistry(resolved).slots[0]?.id);
    expect(planTask(chemistry(resolved).slots[0]!).label).toBe(planTask(chemistry(day()).slots[0]!).label);
  });

  it("keeps a tick on the task itself when another task is added", () => {
    const first = ownPlanTask("Redo question 3", "chem", "one")!;
    const second = ownPlanTask("Read my notes", "chem", "two")!;
    const ticked = day({ dayKey: THURSDAY, pinned: [first], completedSlotIds: ["pin:own:one"] });
    const firstSlot = chemistry(ticked).slots.find((slot) => planTask(slot).label === "Redo question 3")!;
    expect(firstSlot.state).toBe("done");
    expect(planSlotTickKey(firstSlot)).toBe("pin:own:one");

    const both = day({ dayKey: THURSDAY, pinned: [first, second], completedSlotIds: ["pin:own:one"] });
    const states = Object.fromEntries(chemistry(both).slots.map((slot) => [planTask(slot).label, slot.state]));
    expect(states["Redo question 3"]).toBe("done");
    expect(states["Read my notes"]).toBe("todo");
  });

  it("does not put a new task over a suggestion already ticked", () => {
    const before = chemistry(day());
    const last = before.slots.at(-1)!;
    const tickedLabel = planTask(last).label;
    const own = ownPlanTask("Redo question 3", "chem", "q3")!;
    const resolved = chemistry(day({ dayKey: THURSDAY, pinned: [own], completedSlotIds: [last.id] }));
    const states = Object.fromEntries(resolved.slots.map((slot) => [planTask(slot).label, slot.state]));
    // The work already done is still there and still done, where it was; the
    // task went after it, and nothing else in the day moved.
    expect(states[tickedLabel]).toBe("done");
    expect(states["Redo question 3"]).toBe("todo");
    expect(resolved.doneCount).toBe(1);
    expect(planTask(resolved.slots.at(-1)!).label).toBe("Redo question 3");
    expect(resolved.slots.slice(0, -1).map((slot) => slot.id)).toEqual(before.slots.map((slot) => slot.id));
  });

  it("never lets reviewing cards tick a task the student wrote", () => {
    const own = ownPlanTask("Redo question 3", "chem", "q3")!;
    const busy = day({ dayKey: THURSDAY, pinned: [own] }, new Map([["folder:chemistry", 10]]));
    const slot = chemistry(busy).slots.find((candidate) => planTask(candidate).own)!;
    expect(slot.state).toBe("todo");
  });

  it("leaves a pin that names no session exactly where pins always went", () => {
    const legacy: PinnedPlanItem = { actionId: "old", label: "Something pinned last week" };
    const resolved = day({ dayKey: THURSDAY, pinned: [legacy], completedSlotIds: ["plan-1:2026-09-24:0"] });
    expect(resolved.slots[0]?.item).toEqual({ kind: "pinned", pinned: legacy });
    expect(resolved.slots[0]?.state).toBe("done");
  });

  it("grows a session rather than dropping a task the student added to it", () => {
    const tasks = ["a", "b", "c", "d", "e", "f"].map((id) => ownPlanTask(`Task ${id}`, "eng", id)!);
    const english = day({ dayKey: THURSDAY, pinned: tasks }).sessions.find((session) => session.id === "eng")!;
    expect(english.slots.filter((slot) => planTask(slot).own)).toHaveLength(6);
  });

  it("refuses an empty task, and trims a long one", () => {
    expect(ownPlanTask("   ", "chem")).toBeNull();
    expect(ownPlanTask("x".repeat(500), "chem")!.label).toHaveLength(120);
  });
});

describe("what comes next", () => {
  it("is the first thing not yet done, in the order the day runs", () => {
    const resolved = day({ dayKey: THURSDAY, completedSlotIds: ["plan-1:2026-09-24:0"] });
    const next = planUpNext(resolved);
    expect(next?.session.id).toBe("chem");
    expect(next?.task.slot.position).toBe(1);
    expect(next?.task.source).toBe("jami");
  });

  it("is nothing on a day taken off", () => {
    expect(planUpNext(day({ dayKey: THURSDAY, skipped: true }))).toBeNull();
  });

  it("names a session by the student's label, else by the topic Jami chose first", () => {
    expect(planSessionFocus(chemistry(day()))).toBe("titrations");
    const labelled = resolvePlanDay({
      plan: plan({ sessions: [{ id: "eng", weekday: 4, minutes: 30, startTime: "19:00", scopeKey: "folder:english", label: "Paper 1 Q4" }] }),
      dayKey: THURSDAY,
      actionsByScope: actions,
    });
    expect(planSessionFocus(labelled.sessions[0]!)).toBe("Paper 1 Q4");
  });

  it("offers another suggestion for a session that is not already in the day", () => {
    const resolved = day();
    const inDay = new Set(resolved.slots.flatMap((slot) => (slot.item.kind === "action" ? [slot.item.action.id] : [])));
    const suggestion = nextPlanSuggestion(resolved, "folder:chemistry", actions);
    expect(suggestion).not.toBeNull();
    expect(inDay.has(suggestion!.id)).toBe(false);
    expect(pinnedFromAction(suggestion!, "chem")).toMatchObject({ sessionId: "chem", href: suggestion!.destination!.href });
  });
});

describe("counting down", () => {
  it("counts down to each exam, soonest first, with the sessions left before it", () => {
    const countdown = planCountdown(
      plan({
        exams: [
          { id: "maths", label: "Maths Paper 1", dayKey: "2026-11-16" },
          { id: "chem", label: "Chemistry Paper 1", dayKey: "2026-11-12", scopeKey: "folder:chemistry" },
        ],
      }),
      THURSDAY
    );
    expect(countdown.map((item) => [item.label, item.daysLeft])).toEqual([
      ["Chemistry Paper 1", 49],
      ["Maths Paper 1", 53],
    ]);
    // Seven Thursdays from 24 September up to 12 November, two sessions each.
    expect(countdown[0]?.sessionsBefore).toBe(14);
  });

  it("counts down to the plan's end when it has no exams, and drops dates already past", () => {
    expect(planCountdown(plan(), THURSDAY).map((item) => [item.label, item.daysLeft])).toEqual([["Mocks in November", 57]]);
    expect(planCountdown(plan({ exams: [{ id: "old", label: "Old", dayKey: "2026-09-01" }] }), THURSDAY)[0]?.label).toBe("Mocks in November");
  });

  it("says which week of the plan it is", () => {
    expect(planWeekOfPlan(plan(), THURSDAY)).toEqual({ current: 1, total: 9 });
  });
});

describe("keeping exams on a plan", () => {
  it("keeps real exams in date order and drops what cannot be one", () => {
    const { draft } = normalizeRevisionPlanDraft({
      ...plan(),
      exams: [
        { id: "b", label: "Biology Paper 1", dayKey: "2026-11-20", scopeKey: "folder:biology" },
        { id: "a", label: "Chemistry Paper 1", dayKey: "2026-11-12", scopeKey: "folder:chemistry" },
        { id: "c", label: "", dayKey: "2026-11-13" },
        { id: "d", label: "No date", dayKey: "13 November" },
      ],
    });
    expect(draft.exams).toEqual([
      { id: "a", label: "Chemistry Paper 1", dayKey: "2026-11-12", scopeKey: "folder:chemistry" },
      // A subject the plan does not cover is dropped from the exam, not the exam.
      { id: "b", label: "Biology Paper 1", dayKey: "2026-11-20" },
    ]);
  });

  it("never gives two exams the same id", () => {
    // Exam 1 was removed, so the next one numbered from the count would be exam-3 again.
    expect(unusedPlanExamId([{ id: "exam-2" }, { id: "exam-3" }])).toBe("exam-4");
    const { draft } = normalizeRevisionPlanDraft({
      ...plan(),
      exams: [
        { id: "exam-1", label: "Paper 1", dayKey: "2026-11-02" },
        { id: "exam-1", label: "Paper 2", dayKey: "2026-11-05" },
      ],
    });
    expect(new Set(draft.exams?.map((exam) => exam.id)).size).toBe(2);
  });

  it("adds nothing to a plan without exams", () => {
    expect("exams" in normalizeRevisionPlanDraft(plan()).draft).toBe(false);
  });
});
