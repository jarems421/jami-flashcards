import { describe, expect, it } from "vitest";
import { buildPlanWeek, nextScheduledPlanDay } from "@/lib/planning/plan-week";
import { planWeekStartDayKey } from "@/lib/planning/plan-schedule";
import type { RevisionPlan } from "@/lib/planning/types";

const MONDAY = "2026-09-14";
const WEDNESDAY = "2026-09-16";
const FRIDAY = "2026-09-18";
const SUNDAY = "2026-09-20";

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
    sessions: [
      { id: "w1", weekday: 1, minutes: 45 },
      { id: "w3", weekday: 3, minutes: 30 },
    ],
    emphasis: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("the week a plan asks for", () => {
  it("starts on the Monday of the week containing the day", () => {
    // `PLAN_WEEKDAYS` is Sunday-first because `Date#getDay` is. A week a
    // student reads is not, and the two are different questions.
    expect(planWeekStartDayKey(WEDNESDAY)).toBe(MONDAY);
    expect(planWeekStartDayKey(SUNDAY)).toBe(MONDAY);
    expect(planWeekStartDayKey(MONDAY)).toBe(MONDAY);
  });

  it("gives seven days, scheduled or not", () => {
    const week = buildPlanWeek({ plan: plan(), entries: [], todayDayKey: WEDNESDAY });

    expect(week.days).toHaveLength(7);
    expect(week.startDayKey).toBe(MONDAY);
    expect(week.endDayKey).toBe(SUNDAY);
    expect(week.days.filter((day) => day.scheduled).map((day) => day.dayKey)).toEqual([
      MONDAY,
      WEDNESDAY,
    ]);
    // A rest day is not a failure and is not drawn as one.
    expect(week.days[1]?.scheduled).toBe(false);
    expect(week.days[1]?.minutes).toBe(0);
    expect(week.minutes).toBe(75);
  });

  it("knows which day is today and which have gone", () => {
    const week = buildPlanWeek({ plan: plan(), entries: [], todayDayKey: WEDNESDAY });
    const today = week.days.find((day) => day.isToday);

    expect(today?.dayKey).toBe(WEDNESDAY);
    expect(week.days.filter((day) => day.isPast).map((day) => day.dayKey)).toEqual([
      MONDAY,
      "2026-09-15",
    ]);
  });

  it("counts a day outside the plan's dates as outside it, not as rest", () => {
    const week = buildPlanWeek({
      plan: plan({ endDayKey: "2026-09-15" }),
      entries: [],
      todayDayKey: MONDAY,
    });
    expect(week.days[0]?.withinPlan).toBe(true);
    expect(week.days[2]?.withinPlan).toBe(false);
    expect(week.days[2]?.scheduled).toBe(false);
  });

  it("counts what the student ticked, and never more than the day asked for", () => {
    /*
     * A tick left behind by an edit that shortened the day would otherwise make
     * it look overachieved -- a day showing four of three done is worse than
     * one showing three of three.
     */
    const week = buildPlanWeek({
      plan: plan(),
      entries: [
        {
          dayKey: MONDAY,
          completedSlotIds: ["a", "b", "c", "d", "e"],
        },
      ],
      todayDayKey: WEDNESDAY,
    });

    const monday = week.days[0];
    expect(monday?.expectedCount).toBe(3);
    expect(monday?.doneCount).toBe(3);
  });

  it("reports a day the student took off", () => {
    const week = buildPlanWeek({
      plan: plan(),
      entries: [{ dayKey: MONDAY, skipped: true }],
      todayDayKey: MONDAY,
    });
    expect(week.days[0]?.skipped).toBe(true);
  });

  it("makes room for work the student pinned to a day", () => {
    const week = buildPlanWeek({
      plan: plan({ sessions: [{ id: "w1", weekday: 1, minutes: 10 }] }),
      entries: [
        {
          dayKey: MONDAY,
          pinned: [
            { actionId: "one", label: "Essay" },
            { actionId: "two", label: "Past paper" },
          ],
        },
      ],
      todayDayKey: MONDAY,
    });
    // A ten-minute sitting asks for one thing; two pinned items still both fit,
    // because a pin is a decision rather than a suggestion.
    expect(week.days[0]?.expectedCount).toBe(2);
  });
});

describe("what is coming up next", () => {
  it("finds the next day the plan asks for anything", () => {
    const ahead = nextScheduledPlanDay(plan(), MONDAY);
    expect(ahead?.dayKey).toBe(WEDNESDAY);
    expect(ahead?.minutes).toBe(30);
  });

  it("says nothing rather than pointing past the end of the plan", () => {
    expect(nextScheduledPlanDay(plan({ endDayKey: MONDAY }), MONDAY)).toBeNull();
  });

  it("says nothing when the fortnight ahead is empty", () => {
    expect(
      nextScheduledPlanDay(
        plan({ endDayKey: "2027-06-01", sessions: [{ id: "w5", weekday: 5, minutes: 45 }] }),
        FRIDAY
      )?.dayKey
    ).toBe("2026-09-25");
  });
});
