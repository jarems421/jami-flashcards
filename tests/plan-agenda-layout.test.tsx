// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PlanDayAgenda from "@/components/planning/PlanDayAgenda";
import { buildPlanWeek } from "@/lib/planning/plan-week";
import { resolvePlanDay } from "@/lib/planning/resolve-plan-day";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import type { RevisionPlan } from "@/lib/planning/types";

/**
 * The agenda renders, and reads as a day rather than as a list.
 *
 * What went wrong before was not a crash -- it was that a plan looked like a
 * reminder: no times, no sense of a week, no structure. So these check the
 * things that make it a timetable, and that an empty day still says something
 * kind rather than rendering nothing at all.
 */

const MONDAY = "2026-09-14";
const TUESDAY = "2026-09-15";
const SUNDAY = "2026-09-20";

function action(id: string, label: string): StudyAction {
  return {
    id,
    reason: "low_mastery",
    action: "practice",
    priority: 0.5,
    target: { kind: "topic", topicKey: `topic:${id}`, source: "student-topic", label },
    evidence: { count: 4, uniqueItems: 3, sources: ["flashcards"] },
    scope: { folderId: "chem" },
    explanationCode: "low_mastery.practice",
    destination: { kind: "flashcards", href: `/study?x=${id}` },
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
    scopes: [{ folderId: "chem", weight: 1 }],
    sessions: [
      { id: "after-school", weekday: 1, minutes: 45, startTime: "16:30" },
      { id: "evening", weekday: 1, minutes: 30, startTime: "18:00" },
    ],
    emphasis: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const scopeNames = new Map([["folder:chem", "Chemistry"]]);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderAgenda(revisionPlan: RevisionPlan, dayKey = MONDAY) {
  const day = resolvePlanDay({
    plan: revisionPlan,
    dayKey,
    actionsByScope: new Map([["folder:chem", [action("a", "Bonding"), action("b", "Moles")]]]),
  });
  const week = buildPlanWeek({ plan: revisionPlan, entries: [], todayDayKey: dayKey });

  act(() => {
    root.render(
      <PlanDayAgenda
        plan={revisionPlan}
        day={day}
        week={week}
        scopeNames={scopeNames}
        planHref="/dashboard/tutor/plan"
      />
    );
  });
  return { day, week };
}

describe("today's agenda", () => {
  it("draws each sitting with its own time, in time order", () => {
    renderAgenda(plan());
    const text = container.textContent ?? "";

    expect(text).toContain("16:30");
    expect(text).toContain("17:15");
    expect(text).toContain("18:00");
    expect(text).toContain("18:30");
    // Half four is above six, whatever order the student wrote them in.
    expect(text.indexOf("16:30")).toBeLessThan(text.indexOf("18:00"));
  });

  it("says which subject a sitting is for, and how much of the day is done", () => {
    renderAgenda(plan());
    const text = container.textContent ?? "";

    expect(text).toContain("Chemistry");
    expect(text).toContain("Summer exams");
    expect(text).toContain("0 of 5");
    expect(text).toContain("75 min set aside");
  });

  it("numbers a sitting when there is no clock on it", () => {
    renderAgenda(
      plan({
        sessions: [
          { id: "one", weekday: 1, minutes: 30 },
          { id: "two", weekday: 1, minutes: 30 },
        ],
      })
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Session 1");
    expect(text).toContain("Session 2");
  });

  it("gives every slot a tick that can be operated", () => {
    const { day } = renderAgenda(plan());
    const ticks = container.querySelectorAll('[role="checkbox"]');
    expect(ticks).toHaveLength(day.slots.length);
    expect([...ticks].every((tick) => tick.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("draws a whole week above the day", () => {
    renderAgenda(plan());
    // Seven cells, each named for its weekday so the strip is readable without
    // seeing it.
    expect(container.textContent).toContain("Monday:");
    expect(container.textContent).toContain("Sunday:");
    expect(container.textContent).toContain("This week");
  });

  it("says something kind on a day the plan asks nothing of", () => {
    // A plan that runs past this week, so there genuinely is a next Monday to
    // point at -- a plan ending on the Sunday has nothing ahead of it, and
    // saying so is the honest answer rather than a bug.
    renderAgenda(plan({ endDayKey: "2026-10-12" }), TUESDAY);
    const text = container.textContent ?? "";
    expect(text).toContain("Nothing scheduled today");
    expect(text).toContain("Rest counts");
    // And still points at what is coming, so an empty day is not a dead end.
    expect(text).toContain("Next");
    expect(text).toContain("Monday");
  });

  it("says nothing is ahead rather than inventing a day", () => {
    renderAgenda(plan({ endDayKey: SUNDAY }), TUESDAY);
    expect(container.textContent).not.toContain("Next ·");
  });
});
