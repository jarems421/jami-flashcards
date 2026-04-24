import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import { getWeakPoints, type WeakArea } from "@/lib/study/weak-points";
import { formatStudyDayLabel, getStudyDayKey, getStudyDayStartFromKey, shiftStudyDayKey } from "@/lib/study/day";
import type { DailyStudyActivity } from "@/lib/study/activity";

export type AnalyticsDistributionItem = {
  label: string;
  count: number;
};

export type DueForecastPoint = {
  dayKey: string;
  label: string;
  dueCount: number;
};

export type RecentChangeSummary = {
  last7Reviews: number;
  previous7Reviews: number;
  last7Accuracy: number;
  previous7Accuracy: number;
  last7Minutes: number;
  previous7Minutes: number;
  newCardsLast7Days: number;
};

export type SpacedRepetitionAnalytics = {
  totalCards: number;
  reviewedCards: number;
  retentionSummary: {
    high: number;
    medium: number;
    low: number;
    new: number;
    overdue: number;
    lapseRate: number;
    averageDifficulty: number;
  };
  stateDistribution: AnalyticsDistributionItem[];
  stabilityBands: AnalyticsDistributionItem[];
  difficultyBands: AnalyticsDistributionItem[];
  dueForecast7d: DueForecastPoint[];
  dueForecast30d: DueForecastPoint[];
  dueIn7Days: number;
  dueIn30Days: number;
  overdueCards: number;
  averageOverdueDays: number;
  weakestAreas: WeakArea[];
  recentChanges: RecentChangeSummary;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getActivityWindow(activity: DailyStudyActivity[], startDayKey: string, dayCount: number) {
  const dayKeys = new Set(
    Array.from({ length: dayCount }, (_, index) => shiftStudyDayKey(startDayKey, -index))
  );

  return activity.filter((entry) => dayKeys.has(entry.dayKey));
}

function getAccuracyPercent(entries: DailyStudyActivity[]) {
  const reviewCount = entries.reduce((sum, entry) => sum + entry.reviewCount, 0);
  if (reviewCount === 0) {
    return 0;
  }

  const correctCount = entries.reduce((sum, entry) => sum + entry.correctCount, 0);
  return clampPercentage((correctCount / reviewCount) * 100);
}

function buildDistribution(items: Array<{ label: string; count: number }>) {
  return items.filter((item) => item.count > 0);
}

function buildStateDistribution(cards: Card[]) {
  const buckets = {
    New: 0,
    Learning: 0,
    Review: 0,
    Relearning: 0,
  };

  cards.forEach((card) => {
    const state = card.reps && card.reps > 0 ? card.fsrsState ?? 2 : 0;
    if (state === 1) {
      buckets.Learning += 1;
      return;
    }
    if (state === 3) {
      buckets.Relearning += 1;
      return;
    }
    if (state === 2) {
      buckets.Review += 1;
      return;
    }
    buckets.New += 1;
  });

  return buildDistribution(
    Object.entries(buckets).map(([label, count]) => ({ label, count }))
  );
}

function buildStabilityBands(cards: Card[]) {
  const buckets = {
    Unscheduled: 0,
    "0-1d": 0,
    "2-7d": 0,
    "8-30d": 0,
    "31d+": 0,
  };

  cards.forEach((card) => {
    const scheduledDays = card.scheduledDays ?? 0;
    if (!card.reps || scheduledDays <= 0) {
      buckets.Unscheduled += 1;
      return;
    }
    if (scheduledDays <= 1) {
      buckets["0-1d"] += 1;
      return;
    }
    if (scheduledDays <= 7) {
      buckets["2-7d"] += 1;
      return;
    }
    if (scheduledDays <= 30) {
      buckets["8-30d"] += 1;
      return;
    }
    buckets["31d+"] += 1;
  });

  return buildDistribution(
    Object.entries(buckets).map(([label, count]) => ({ label, count }))
  );
}

function buildDifficultyBands(cards: Card[]) {
  const buckets = {
    New: 0,
    Easy: 0,
    Medium: 0,
    Hard: 0,
  };

  cards.forEach((card) => {
    if (!card.reps || !card.difficulty) {
      buckets.New += 1;
      return;
    }
    if (card.difficulty < 4) {
      buckets.Easy += 1;
      return;
    }
    if (card.difficulty < 7) {
      buckets.Medium += 1;
      return;
    }
    buckets.Hard += 1;
  });

  return buildDistribution(
    Object.entries(buckets).map(([label, count]) => ({ label, count }))
  );
}

function buildDueForecast(cards: Card[], dayCount: number, now = Date.now()) {
  const currentDayKey = getStudyDayKey(now);

  return Array.from({ length: dayCount }, (_, index) => {
    const dayKey = shiftStudyDayKey(currentDayKey, index);
    const start = getStudyDayStartFromKey(dayKey);
    const end = getStudyDayStartFromKey(shiftStudyDayKey(dayKey, 1));
    const dueCount = cards.filter(
      (card) => typeof card.dueDate === "number" && card.dueDate >= start && card.dueDate < end
    ).length;

    return {
      dayKey,
      label: formatStudyDayLabel(dayKey),
      dueCount,
    };
  });
}

export function buildSpacedRepetitionAnalytics(
  cards: Card[],
  activity: DailyStudyActivity[],
  deckNamesById: Record<string, string>,
  now = Date.now()
): SpacedRepetitionAnalytics {
  const reviewedCards = cards.filter((card) => (card.reps ?? 0) > 0);
  const totalLapses = reviewedCards.reduce((sum, card) => sum + (card.lapses ?? 0), 0);
  const totalDifficulty = reviewedCards.reduce((sum, card) => sum + (card.difficulty ?? 0), 0);
  const retentionSummary = {
    high: 0,
    medium: 0,
    low: 0,
    new: 0,
    overdue: 0,
    lapseRate:
      reviewedCards.length > 0
        ? Number((totalLapses / reviewedCards.length).toFixed(1))
        : 0,
    averageDifficulty:
      reviewedCards.length > 0
        ? Number((totalDifficulty / reviewedCards.length).toFixed(1))
        : 0,
  };

  let overdueDaysTotal = 0;

  cards.forEach((card) => {
    const risk = getMemoryRiskInfo(card, now);
    if (risk.label === "New") {
      retentionSummary.new += 1;
    } else {
      retentionSummary[risk.tier] += 1;
    }

    if (typeof card.dueDate === "number" && card.dueDate < now) {
      retentionSummary.overdue += 1;
      overdueDaysTotal += Math.max(1, Math.ceil((now - card.dueDate) / DAY_MS));
    }
  });

  const dueForecast7d = buildDueForecast(cards, 7, now);
  const dueForecast30d = buildDueForecast(cards, 30, now);
  const dueIn7Days = cards.filter(
    (card) => typeof card.dueDate === "number" && card.dueDate <= now + 7 * DAY_MS
  ).length;
  const dueIn30Days = cards.filter(
    (card) => typeof card.dueDate === "number" && card.dueDate <= now + 30 * DAY_MS
  ).length;

  const currentDayKey = getStudyDayKey(now);
  const previous7StartKey = shiftStudyDayKey(currentDayKey, -7);
  const last7Window = getActivityWindow(activity, currentDayKey, 7);
  const previous7Window = getActivityWindow(activity, previous7StartKey, 7);

  const last7Reviews = last7Window.reduce((sum, entry) => sum + entry.reviewCount, 0);
  const previous7Reviews = previous7Window.reduce((sum, entry) => sum + entry.reviewCount, 0);
  const last7Minutes = Math.round(
    last7Window.reduce((sum, entry) => sum + entry.totalDurationMs, 0) / 60_000
  );
  const previous7Minutes = Math.round(
    previous7Window.reduce((sum, entry) => sum + entry.totalDurationMs, 0) / 60_000
  );
  const newCardsLast7Days = cards.filter((card) => card.createdAt >= now - 7 * DAY_MS).length;

  return {
    totalCards: cards.length,
    reviewedCards: reviewedCards.length,
    retentionSummary,
    stateDistribution: buildStateDistribution(cards),
    stabilityBands: buildStabilityBands(cards),
    difficultyBands: buildDifficultyBands(cards),
    dueForecast7d,
    dueForecast30d,
    dueIn7Days,
    dueIn30Days,
    overdueCards: retentionSummary.overdue,
    averageOverdueDays:
      retentionSummary.overdue > 0
        ? Number((overdueDaysTotal / retentionSummary.overdue).toFixed(1))
        : 0,
    weakestAreas: getWeakPoints(cards, deckNamesById, 5),
    recentChanges: {
      last7Reviews,
      previous7Reviews,
      last7Accuracy: getAccuracyPercent(last7Window),
      previous7Accuracy: getAccuracyPercent(previous7Window),
      last7Minutes,
      previous7Minutes,
      newCardsLast7Days,
    },
  };
}
