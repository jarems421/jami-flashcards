// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlanTodayTimeline from "@/components/planning/PlanTodayTimeline";
import PlanWeekRow from "@/components/planning/PlanWeekRow";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import { ownPlanTask, planUpNext } from "@/lib/planning/plan-tasks";
import { buildPlanWeek, resolvePlanWeekDays } from "@/lib/planning/plan-week";
import { resolvePlanDay } from "@/lib/planning/resolve-plan-day";
import type { RevisionPlan, RevisionPlanEntry } from "@/lib/planning/types";

/**
 * The planner's day and week, as a student reads them: each sitting with its
 * time, subject and topic, every task saying who put it there, a way to add
 * their own, and seven days to pick from.
 */

const THURSDAY = "2026-09-24";

function action(id: string, label: string): StudyAction {
  return {
    id,
    reason: "persistent_error",
    action: "practice",
    priority: 0.5,
    target: { kind: "topic", topicKey: `topic:${id}`, source: "student-topic", label },
    evidence: { count: 2, uniqueItems: 2, sources: ["practice"] },
    scope: { folderId: "chem" },
    explanationCode: "persistent_error.practice",
    destination: { kind: "question-practice", href: `/practice?x=${id}`, selection: { topicIds: [`topic:${id}`] } },
  } as StudyAction;
}

const revisionPlan: RevisionPlan = {
  id: "plan-1",
  schemaVersion: 2,
  title: "Mocks in November",
  status: "active",
  origin: "manual",
  startDayKey: "2026-09-21",
  endDayKey: "2026-11-20",
  scopes: [{ folderId: "chem", weight: 1 }],
  sessions: [
    { id: "chem", weekday: 4, minutes: 30, startTime: "16:30", scopeKey: "folder:chem" },
    { id: "sat", weekday: 6, minutes: 45, startTime: "10:00", scopeKey: "folder:chem" },
  ],
  emphasis: [],
  createdAt: 0,
  updatedAt: 0,
};

const actions = new Map([["folder:chem", [action("a", "titrations"), action("b", "moles"), action("c", "bonding")]]]);
const scopeNames = new Map([["folder:chem", "Chemistry"]]);
const scopeColor = () => "var(--color-success)";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderDay(entry: RevisionPlanEntry | null, handlers: Partial<Parameters<typeof PlanTodayTimeline>[0]> = {}) {
  const day = resolvePlanDay({ plan: revisionPlan, dayKey: THURSDAY, entry, actionsByScope: actions });
  const next = planUpNext(day);
  act(() => {
    root.render(
      <PlanTodayTimeline
        day={day}
        title="Today"
        scopeNames={scopeNames}
        scopeColor={scopeColor}
        isToday
        {...(next ? { upNextSlotId: next.task.slot.id } : {})}
        onToggle={() => undefined}
        {...handlers}
      />
    );
  });
  return day;
}

describe("a day in the plan", () => {
  it("shows each sitting's time, subject and topic, and who put each task there", () => {
    renderDay({ dayKey: THURSDAY, pinned: [ownPlanTask("Redo question 3", "chem", "q3")!] });
    const text = container.textContent ?? "";
    expect(text).toContain("16:30");
    expect(text).toContain("Chemistry");
    expect(text).toContain("titrations");
    expect(text).toContain("Stop losing marks: titrations");
    expect(text).toContain("Up next");
    expect(text).toContain("You added");
    expect(text).toContain("Redo question 3");
  });

  it("adds the student's own task to the sitting it was typed into", () => {
    const onAddOwnTask = vi.fn(() => true);
    renderDay(null, { onAddOwnTask });
    const input = container.querySelector<HTMLInputElement>("#add-task-chem")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Read my notes");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onAddOwnTask).toHaveBeenCalledWith("chem", "Read my notes");
  });

  it("lets a task be ticked, and a task the student added be removed", () => {
    const onToggle = vi.fn();
    const onRemoveTask = vi.fn();
    renderDay({ dayKey: THURSDAY, pinned: [ownPlanTask("Redo question 3", "chem", "q3")!] }, { onToggle, onRemoveTask });
    act(() => container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove Redo question 3"]')!.click());
    expect(onRemoveTask).toHaveBeenCalledWith("own:q3");
    // Jami's own suggestions come and go with the evidence; only what the student added has a remove button.
    expect(container.querySelectorAll('[aria-label^="Remove"]')).toHaveLength(1);
  });

  it("says when Jami has nothing more to offer a sitting", () => {
    renderDay(null, { onAskJami: () => "nothing" as const });
    const ask = [...container.querySelectorAll("button")].find((button) => button.textContent === "Ask Jami for one")!;
    act(() => ask.click());
    expect(container.textContent).toContain("Jami has nothing else for Chemistry right now.");
  });
});

describe("the week", () => {
  it("draws seven days, marks today, and picks a day", () => {
    const week = buildPlanWeek({ plan: revisionPlan, entries: [], todayDayKey: THURSDAY });
    const days = resolvePlanWeekDays({ plan: revisionPlan, week, entries: [], actionsByScope: actions });
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <PlanWeekRow week={week} days={days} scopeNames={scopeNames} scopeColor={scopeColor} selectedDayKey={THURSDAY} onSelect={onSelect} />
      );
    });
    const buttons = container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]");
    expect(buttons).toHaveLength(7);
    expect(buttons[3]!.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[3]!.textContent).toContain("Today");
    expect(buttons[0]!.textContent).toContain("Rest");
    act(() => buttons[5]!.click());
    expect(onSelect).toHaveBeenCalledWith("2026-09-26");
  });
});
