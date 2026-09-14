import type { SpacedRepetitionAnalytics } from "@/lib/study/analytics";
import { getStudyDayStartFromKey, getStudyTimeZone } from "@/lib/study/day";

/**
 * "Thursday" rather than the forecast's "09/18": a weekday is how anybody
 * thinks about the week ahead, and a numeric date reads month-first to some
 * students and day-first to others.
 */
function weekdayName(dayKey: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: getStudyTimeZone(),
  }).format(getStudyDayStartFromKey(dayKey));
}

/**
 * Every card, sorted into how well it is remembered, in words a student would
 * use.
 *
 * Progress used to show a seven-day scheduling forecast: bars of how many
 * reviews the scheduler had booked per day. It answered a question nobody
 * opens Progress with. This answers the one they do -- how much of what I have
 * studied is actually sticking -- from the same memory-risk tiers the rest of
 * the app already uses, with the week ahead kept as a single line.
 *
 * Note the tiers are named by risk: "low" risk is a card remembered well.
 */

export type MemoryGroupKey = "strong" | "settling" | "slipping" | "unstudied";

export type MemoryGroup = {
  key: MemoryGroupKey;
  label: string;
  detail: string;
  count: number;
  /** Share of every card, for drawing the bar. */
  percent: number;
};

export type MemorySummary = {
  totalCards: number;
  studiedCards: number;
  rememberedWell: number;
  groups: MemoryGroup[];
  weekAhead: {
    reviews: number;
    busiestDay: { label: string; count: number; isToday: boolean } | null;
  };
};

export function buildMemorySummary(
  analytics: Pick<SpacedRepetitionAnalytics, "retentionSummary" | "dueForecast7d">
): MemorySummary {
  const { low, medium, high, new: unstudied } = analytics.retentionSummary;
  const totalCards = low + medium + high + unstudied;
  const percentOf = (count: number) => (totalCards > 0 ? (count / totalCards) * 100 : 0);

  const groups: MemoryGroup[] = [
    {
      key: "strong",
      label: "Remembered well",
      detail: "You'll recall these without trouble",
      count: low,
      percent: percentOf(low),
    },
    {
      key: "settling",
      label: "Getting there",
      detail: "Still settling in, or ready for a review",
      count: medium,
      percent: percentOf(medium),
    },
    {
      key: "slipping",
      label: "Slipping",
      detail: "Struggled recently, or keep being forgotten",
      count: high,
      percent: percentOf(high),
    },
    {
      key: "unstudied",
      label: "Not studied yet",
      detail: "Waiting for their first review",
      count: unstudied,
      percent: percentOf(unstudied),
    },
  ];

  let busiestDay: MemorySummary["weekAhead"]["busiestDay"] = null;
  analytics.dueForecast7d.forEach((point, index) => {
    if (point.dueCount > 0 && (!busiestDay || point.dueCount > busiestDay.count)) {
      busiestDay = { label: weekdayName(point.dayKey), count: point.dueCount, isToday: index === 0 };
    }
  });

  return {
    totalCards,
    studiedCards: low + medium + high,
    rememberedWell: low,
    groups,
    weekAhead: {
      reviews: analytics.dueForecast7d.reduce((sum, point) => sum + point.dueCount, 0),
      busiestDay,
    },
  };
}
