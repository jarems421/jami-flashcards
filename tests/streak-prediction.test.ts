import { describe, expect, it } from "vitest";
import { predictStudyStreak } from "@/lib/study/streak-prediction";
import type { Card } from "@/lib/study/cards";
import type { DailyStudyActivity } from "@/lib/study/activity";

const now = Date.UTC(2026, 3, 24, 18);

function createCard(overrides: Partial<Card>): Card {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    deckId: overrides.deckId ?? "deck-1",
    userId: "user-1",
    front: overrides.front ?? "Front",
    back: overrides.back ?? "Back",
    createdAt: overrides.createdAt ?? now - 4 * 24 * 60 * 60 * 1000,
    tags: overrides.tags ?? [],
    ...overrides,
  };
}

function createActivity(dayKey: string, reviewCount: number, correctCount = reviewCount): DailyStudyActivity {
  return {
    id: dayKey,
    dayKey,
    reviewCount,
    correctCount,
    dailyReviewCount: reviewCount,
    dailyCorrectCount: correctCount,
    customReviewCount: 0,
    customCorrectCount: 0,
    totalDurationMs: reviewCount * 60_000,
    updatedAt: now,
  };
}

describe("predictStudyStreak", () => {
  it("returns a low-risk prediction for a stable active streak", () => {
    const prediction = predictStudyStreak(
      [createCard({ id: "due-1", dueDate: now + 24 * 60 * 60 * 1000, reps: 3, difficulty: 4 })],
      [
        createActivity("2026-04-24", 20, 17),
        createActivity("2026-04-23", 15, 13),
        createActivity("2026-04-22", 12, 10),
        createActivity("2026-04-21", 18, 15),
      ],
      now
    );

    expect(prediction.studiedToday).toBe(true);
    expect(prediction.riskTier).toBe("low");
    expect(prediction.probabilityPercent).toBeGreaterThanOrEqual(90);
  });

  it("keeps an unstudiied-but-salvageable streak in medium or low risk", () => {
    const prediction = predictStudyStreak(
      [
        createCard({ id: "due-1", dueDate: now - 60_000, reps: 3, difficulty: 4 }),
        createCard({ id: "due-2", dueDate: now + 24 * 60 * 60 * 1000, reps: 3, difficulty: 4 }),
      ],
      [
        createActivity("2026-04-23", 18, 15),
        createActivity("2026-04-22", 15, 13),
        createActivity("2026-04-21", 14, 12),
        createActivity("2026-04-20", 11, 9),
      ],
      now
    );

    expect(prediction.studiedToday).toBe(false);
    expect(prediction.currentStreak).toBeGreaterThan(0);
    expect(prediction.probabilityPercent).toBeGreaterThan(50);
    expect(prediction.rescueCards).toBeGreaterThan(0);
  });

  it("treats a broken streak as a fresh-start case", () => {
    const prediction = predictStudyStreak(
      [createCard({ id: "due-1", dueDate: now - 60_000 })],
      [createActivity("2026-04-20", 8, 6)],
      now
    );

    expect(prediction.currentStreak).toBe(0);
    expect(prediction.headline).toMatch(/fresh streak/i);
  });

  it("raises risk when the overdue backlog is heavy", () => {
    const prediction = predictStudyStreak(
      Array.from({ length: 20 }, (_, index) =>
        createCard({
          id: `overdue-${index}`,
          dueDate: now - 3 * 24 * 60 * 60 * 1000,
          reps: 4,
          difficulty: 7,
          scheduledDays: 1,
        })
      ),
      [
        createActivity("2026-04-23", 6, 4),
        createActivity("2026-04-22", 4, 3),
      ],
      now
    );

    expect(prediction.overdueBacklog).toBe(20);
    expect(prediction.riskTier).toBe("high");
  });

  it("handles brand-new users without activity", () => {
    const prediction = predictStudyStreak([], [], now);
    expect(prediction.currentStreak).toBe(0);
    expect(prediction.probabilityPercent).toBeGreaterThan(0);
    expect(prediction.actionLabel).toMatch(/streak/i);
  });
});
