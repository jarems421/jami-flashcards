import { describe, expect, it } from "vitest";
import { getGoalStatusAtTime, type Goal } from "@/lib/study/goals";
import { formatTimeRemaining, getDeadlineDisplay } from "@/lib/study/time";

const baseGoal: Goal = {
  id: "goal",
  targetCards: 10,
  targetAccuracy: 0.8,
  deadline: 0,
  progress: {
    cardsCompleted: 0,
    correctAnswers: 0,
    totalAnswers: 0,
  },
  status: "active",
  createdAt: 1,
};

describe("optional goal deadlines", () => {
  it("keeps a no-deadline goal active", () => {
    expect(getGoalStatusAtTime(baseGoal, Date.now())).toBe("active");
    expect(formatTimeRemaining(0)).toBe("No deadline");
    expect(getDeadlineDisplay(0)).toEqual({
      label: "No deadline",
      tone: "neutral",
    });
  });

  it("preserves cancelled goals as historical", () => {
    expect(
      getGoalStatusAtTime({ ...baseGoal, status: "cancelled" }, Date.now())
    ).toBe("cancelled");
  });

  it("labels overdue and near-term deadlines clearly", () => {
    const now = new Date(2026, 5, 6, 12).getTime();
    expect(getDeadlineDisplay(now - 1, now).label).toBe("Overdue");
    expect(getDeadlineDisplay(now + 60 * 60 * 1000, now).label).toBe(
      "Due today"
    );
    expect(getDeadlineDisplay(now + 24 * 60 * 60 * 1000, now).label).toBe(
      "Due tomorrow"
    );
  });
});
