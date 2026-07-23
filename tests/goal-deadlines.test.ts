import { describe, expect, it } from "vitest";
import {
  doesGoalMatchAnswer,
  getGoalStatusAtTime,
  getUpdatedGoalAfterAnswer,
  type Goal,
} from "@/lib/study/goals";
import { formatTimeRemaining, getDeadlineDisplay } from "@/lib/study/time";

const baseGoal: Goal = {
  id: "goal",
  name: "Daily review",
  scope: { type: "all" },
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

  it("only advances scoped goals for matching study", () => {
    const deckGoal: Goal = {
      ...baseGoal,
      scope: { type: "deck", id: "deck-a", label: "Biology" },
    };

    expect(doesGoalMatchAnswer(deckGoal, { deckId: "deck-b" })).toBe(false);
    expect(
      getUpdatedGoalAfterAnswer(deckGoal, true, Date.now(), { deckId: "deck-b" })
    ).toBe(deckGoal);
    expect(
      getUpdatedGoalAfterAnswer(deckGoal, true, Date.now(), { deckId: "deck-a" }).progress
        .cardsCompleted
    ).toBe(1);
  });

  it("matches topic and folder scopes through card context", () => {
    expect(
      doesGoalMatchAnswer(
        { ...baseGoal, scope: { type: "topic", id: "topic-a" } },
        { topicIds: ["topic-a"] }
      )
    ).toBe(true);
    expect(
      doesGoalMatchAnswer(
        { ...baseGoal, scope: { type: "folder", id: "folder-a" } },
        { folderIds: ["folder-a"] }
      )
    ).toBe(true);
  });
});
