import { describe, expect, it } from "vitest";
import {
  computeStudyStreak,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function activityFor(dayKey: string): DailyStudyActivity {
  return {
    id: dayKey,
    dayKey,
    reviewCount: 1,
    correctCount: 1,
    dailyReviewCount: 1,
    dailyCorrectCount: 1,
    customReviewCount: 0,
    customCorrectCount: 0,
    totalDurationMs: 60_000,
    updatedAt: NOW,
  };
}

describe("computeStudyStreak", () => {
  it("preserves a streak longer than one calendar year", () => {
    const todayKey = getStudyDayKey(NOW);
    const activity = Array.from({ length: 500 }, (_, index) =>
      activityFor(shiftStudyDayKey(todayKey, -index))
    );

    expect(computeStudyStreak(activity, NOW)).toBe(500);
  });

  it("allows today to be empty but stops at the first earlier missing day", () => {
    const todayKey = getStudyDayKey(NOW);
    const activity = [
      activityFor(shiftStudyDayKey(todayKey, -1)),
      activityFor(shiftStudyDayKey(todayKey, -2)),
      activityFor(shiftStudyDayKey(todayKey, -4)),
    ];

    expect(computeStudyStreak(activity, NOW)).toBe(2);
  });
});
