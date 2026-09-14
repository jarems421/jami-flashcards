import { describe, expect, it } from "vitest";
import { buildMemorySummary } from "@/lib/study/memory-summary";

function analytics(
  counts: { low: number; medium: number; high: number; new: number },
  dueCounts: number[] = [0, 0, 0, 0, 0, 0, 0]
) {
  return {
    retentionSummary: { ...counts, overdue: 0, lapseRate: 0, averageDifficulty: 0 },
    // Study days from Monday 14 September 2026, labelled the way the forecast labels them.
    dueForecast7d: dueCounts.map((dueCount, index) => ({
      dayKey: `2026-09-${String(14 + index).padStart(2, "0")}`,
      label: `09/${String(14 + index).padStart(2, "0")}`,
      dueCount,
    })),
  };
}

describe("how well a student remembers", () => {
  it("reads low memory risk as remembered well, not the other way round", () => {
    const summary = buildMemorySummary(analytics({ low: 60, medium: 25, high: 15, new: 20 }));
    const byKey = Object.fromEntries(summary.groups.map((group) => [group.key, group.count]));

    expect(byKey).toEqual({ strong: 60, settling: 25, slipping: 15, unstudied: 20 });
    expect(summary.rememberedWell).toBe(60);
    expect(summary.studiedCards).toBe(100);
    expect(summary.totalCards).toBe(120);
  });

  it("sizes the bar by every card, so the groups fill it exactly", () => {
    const summary = buildMemorySummary(analytics({ low: 1, medium: 1, high: 1, new: 1 }));
    expect(summary.groups.reduce((total, group) => total + group.percent, 0)).toBeCloseTo(100, 5);
  });

  it("has nothing to divide by before any cards exist", () => {
    const summary = buildMemorySummary(analytics({ low: 0, medium: 0, high: 0, new: 0 }));
    expect(summary.totalCards).toBe(0);
    expect(summary.groups.every((group) => group.percent === 0)).toBe(true);
  });

  it("puts the week ahead in one line: how many reviews, and the busiest day", () => {
    const summary = buildMemorySummary(analytics({ low: 5, medium: 0, high: 0, new: 0 }, [3, 0, 8, 20, 1, 0, 2]));
    expect(summary.weekAhead.reviews).toBe(34);
    // Named as a weekday, not the forecast's month/day label.
    expect(summary.weekAhead.busiestDay).toEqual({ label: "Thursday", count: 20, isToday: false });

    const quiet = buildMemorySummary(analytics({ low: 5, medium: 0, high: 0, new: 0 }));
    expect(quiet.weekAhead).toEqual({ reviews: 0, busiestDay: null });
  });
});
