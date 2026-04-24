import { describe, expect, it } from "vitest";
import { buildSpacedRepetitionAnalytics } from "@/lib/study/analytics";
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
    createdAt: overrides.createdAt ?? now - 10 * 24 * 60 * 60 * 1000,
    tags: overrides.tags ?? [],
    ...overrides,
  };
}

function createActivity(overrides: Partial<DailyStudyActivity>): DailyStudyActivity {
  return {
    id: overrides.id ?? "2026-04-24",
    dayKey: overrides.dayKey ?? "2026-04-24",
    reviewCount: overrides.reviewCount ?? 0,
    correctCount: overrides.correctCount ?? 0,
    dailyReviewCount: overrides.dailyReviewCount ?? 0,
    dailyCorrectCount: overrides.dailyCorrectCount ?? 0,
    customReviewCount: overrides.customReviewCount ?? 0,
    customCorrectCount: overrides.customCorrectCount ?? 0,
    totalDurationMs: overrides.totalDurationMs ?? 0,
    updatedAt: overrides.updatedAt ?? now,
  };
}

describe("buildSpacedRepetitionAnalytics", () => {
  it("derives retention, FSRS buckets, and due forecasts", () => {
    const cards = [
      createCard({
        id: "high-risk",
        deckId: "biology",
        tags: ["cells"],
        difficulty: 8,
        reps: 5,
        lapses: 3,
        dueDate: now - 2 * 24 * 60 * 60 * 1000,
        scheduledDays: 1,
        fsrsState: 3,
      }),
      createCard({
        id: "stable",
        deckId: "biology",
        tags: ["cells"],
        difficulty: 2,
        reps: 7,
        lapses: 0,
        dueDate: now + 9 * 24 * 60 * 60 * 1000,
        scheduledDays: 14,
        fsrsState: 2,
      }),
      createCard({
        id: "medium",
        deckId: "maths",
        tags: ["matrices"],
        difficulty: 5,
        reps: 4,
        lapses: 1,
        dueDate: now + 2 * 24 * 60 * 60 * 1000,
        scheduledDays: 5,
        fsrsState: 2,
      }),
      createCard({
        id: "new",
        deckId: "maths",
        tags: ["definitions"],
      }),
    ];

    const activity = [
      createActivity({
        id: "2026-04-24",
        dayKey: "2026-04-24",
        reviewCount: 30,
        correctCount: 24,
        totalDurationMs: 25 * 60_000,
      }),
      createActivity({
        id: "2026-04-20",
        dayKey: "2026-04-20",
        reviewCount: 12,
        correctCount: 9,
        totalDurationMs: 12 * 60_000,
      }),
      createActivity({
        id: "2026-04-15",
        dayKey: "2026-04-15",
        reviewCount: 18,
        correctCount: 12,
        totalDurationMs: 16 * 60_000,
      }),
    ];

    const analytics = buildSpacedRepetitionAnalytics(
      cards,
      activity,
      {
        biology: "Biology",
        maths: "Maths",
      },
      now
    );

    expect(analytics.retentionSummary.high).toBe(1);
    expect(analytics.retentionSummary.medium).toBe(1);
    expect(analytics.retentionSummary.new).toBe(1);
    expect(analytics.retentionSummary.overdue).toBe(1);
    expect(analytics.stateDistribution.find((item) => item.label === "Review")?.count).toBe(2);
    expect(analytics.stateDistribution.find((item) => item.label === "Relearning")?.count).toBe(1);
    expect(analytics.dueIn7Days).toBe(2);
    expect(analytics.dueIn30Days).toBe(3);
    expect(analytics.dueForecast7d.some((point) => point.dueCount > 0)).toBe(true);
    expect(analytics.weakestAreas[0]?.name).toBe("Biology");
  });

  it("builds recent change summaries from the last 7 days vs previous 7 days", () => {
    const analytics = buildSpacedRepetitionAnalytics(
      [createCard({ id: "card-1", reps: 1, difficulty: 4, dueDate: now + 24 * 60 * 60 * 1000 })],
      [
        createActivity({
          id: "2026-04-24",
          dayKey: "2026-04-24",
          reviewCount: 20,
          correctCount: 18,
          totalDurationMs: 22 * 60_000,
        }),
        createActivity({
          id: "2026-04-23",
          dayKey: "2026-04-23",
          reviewCount: 10,
          correctCount: 8,
          totalDurationMs: 12 * 60_000,
        }),
        createActivity({
          id: "2026-04-16",
          dayKey: "2026-04-16",
          reviewCount: 6,
          correctCount: 3,
          totalDurationMs: 8 * 60_000,
        }),
      ],
      { "deck-1": "Deck" },
      now
    );

    expect(analytics.recentChanges.last7Reviews).toBe(30);
    expect(analytics.recentChanges.previous7Reviews).toBe(6);
    expect(analytics.recentChanges.last7Accuracy).toBe(87);
    expect(analytics.recentChanges.previous7Accuracy).toBe(50);
  });
});
