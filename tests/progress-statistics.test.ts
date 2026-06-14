import { describe, expect, it } from "vitest";
import type { DailyStudyActivity } from "@/lib/study/activity";
import {
  buildAccuracySeries,
  buildStudyTimeSeries,
  buildWorkspaceActivitySummary,
  countStudyActiveDays,
  filterStudyActivityByRange,
  getAverageStudySessionMinutes,
  getStudyAccuracy,
} from "@/lib/study/progress-statistics";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

const NOW = Date.UTC(2026, 5, 14, 12);

function activity(
  daysAgo: number,
  reviews: number,
  correct: number,
  minutes: number
): DailyStudyActivity {
  const dayKey = shiftStudyDayKey(getStudyDayKey(NOW), -daysAgo);
  return {
    id: dayKey,
    dayKey,
    reviewCount: reviews,
    correctCount: correct,
    dailyReviewCount: reviews,
    dailyCorrectCount: correct,
    customReviewCount: 0,
    customCorrectCount: 0,
    totalDurationMs: minutes * 60_000,
    updatedAt: NOW,
  };
}

describe("progress statistics", () => {
  const entries = [
    activity(31, 3, 2, 5),
    activity(8, 4, 3, 8),
    activity(6, 5, 4, 10),
    activity(0, 10, 9, 20),
  ];

  it("filters 7-day, 30-day, and all-time activity", () => {
    expect(filterStudyActivityByRange(entries, "7d", NOW)).toHaveLength(2);
    expect(filterStudyActivityByRange(entries, "30d", NOW)).toHaveLength(3);
    expect(filterStudyActivityByRange(entries, "all", NOW)).toHaveLength(4);
  });

  it("builds fixed-length accuracy and time series", () => {
    const accuracy = buildAccuracySeries(entries, "7d", NOW);
    const time = buildStudyTimeSeries(entries, "30d", NOW);

    expect(accuracy).toHaveLength(7);
    expect(accuracy.at(-1)?.accuracy).toBe(90);
    expect(time).toHaveLength(30);
    expect(time.at(-1)?.minutes).toBe(20);
  });

  it("handles empty activity and calculates active-day summaries", () => {
    expect(buildAccuracySeries([], "7d", NOW)).toHaveLength(7);
    expect(countStudyActiveDays([])).toBe(0);
    expect(getStudyAccuracy([])).toBe(0);
    expect(getAverageStudySessionMinutes([])).toBe(0);
    expect(countStudyActiveDays(entries)).toBe(4);
    expect(getStudyAccuracy([activity(0, 10, 8, 20)])).toBe(80);
    expect(getAverageStudySessionMinutes([activity(0, 10, 8, 20)])).toBe(20);
  });

  it("builds aggregate-only workspace metrics", () => {
    expect(
      buildWorkspaceActivitySummary(
        {
          notebooks: [
            { updatedAt: NOW },
            { updatedAt: NOW - 40 * 86_400_000 },
          ],
          sources: [{}, {}, {}],
          drafts: [{ contentStatus: "draft" }, { contentStatus: "approved" }],
          goals: [
            { status: "active" },
            { status: "completed" },
            { status: "failed" },
          ],
        },
        NOW
      )
    ).toEqual({
      notebookCount: 2,
      recentlyEditedNotebookCount: 1,
      sourceCount: 3,
      waitingDraftCount: 1,
      activeGoalCount: 1,
      completedGoalCount: 1,
    });
  });
});
