import type { Card } from "@/lib/study/cards";
import type { DailyStudyActivity } from "@/lib/study/activity";
import { computeStudyStreak } from "@/lib/study/activity";
import { buildDailyReviewQueues } from "@/lib/study/daily-review";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

export type StreakPrediction = {
  currentStreak: number;
  studiedToday: boolean;
  lastStudyDayKey: string | null;
  trailing7ActiveDays: number;
  probabilityPercent: number;
  rescueCards: number;
  rescueMinutes: number;
  dueBacklog: number;
  overdueBacklog: number;
  riskTier: "low" | "medium" | "high";
  headline: string;
  explanation: string;
  actionLabel: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getLastStudyDayKey(activity: DailyStudyActivity[]) {
  const reviewedEntries = activity
    .filter((entry) => entry.reviewCount > 0)
    .sort((left, right) => left.dayKey.localeCompare(right.dayKey));

  return reviewedEntries.at(-1)?.dayKey ?? null;
}

function getStudyGapDays(currentDayKey: string, lastStudyDayKey: string | null) {
  if (!lastStudyDayKey) {
    return Number.POSITIVE_INFINITY;
  }

  for (let offset = 0; offset < 365; offset += 1) {
    if (shiftStudyDayKey(currentDayKey, -offset) === lastStudyDayKey) {
      return offset;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function getWindowMetrics(activity: DailyStudyActivity[], endDayKey: string, days: number) {
  const dayKeys = new Set(
    Array.from({ length: days }, (_, index) => shiftStudyDayKey(endDayKey, -index))
  );
  const entries = activity.filter((entry) => dayKeys.has(entry.dayKey));
  const activeDays = entries.filter((entry) => entry.reviewCount > 0).length;
  const reviews = entries.reduce((sum, entry) => sum + entry.reviewCount, 0);
  const minutes = Math.round(entries.reduce((sum, entry) => sum + entry.totalDurationMs, 0) / 60_000);

  return {
    activeDays,
    reviews,
    minutes,
  };
}

export function predictStudyStreak(
  cards: Card[],
  activity: DailyStudyActivity[],
  now = Date.now()
): StreakPrediction {
  const currentDayKey = getStudyDayKey(now);
  const lastStudyDayKey = getLastStudyDayKey(activity);
  const studiedToday = lastStudyDayKey === currentDayKey;
  const currentStreak = computeStudyStreak(activity, now);
  const trailing7 = getWindowMetrics(activity, currentDayKey, 7);
  const dueQueues = buildDailyReviewQueues(cards, now);
  const dueBacklog = dueQueues.requiredCards.length + dueQueues.optionalCards.length;
  const overdueBacklog = cards.filter(
    (card) => typeof card.dueDate === "number" && card.dueDate < now
  ).length;
  const gapDays = getStudyGapDays(currentDayKey, lastStudyDayKey);
  const averageActiveReviews =
    trailing7.activeDays > 0 ? trailing7.reviews / trailing7.activeDays : 0;
  const averageActiveMinutes =
    trailing7.activeDays > 0 ? trailing7.minutes / trailing7.activeDays : 0;

  let probability = 0.2;

  if (activity.length === 0) {
    probability = dueBacklog > 0 ? 0.34 : 0.42;
  } else if (studiedToday) {
    probability = 0.97;
  } else {
    probability += (trailing7.activeDays / 7) * 0.34;
    probability += Math.min(0.18, trailing7.reviews / 180);
    probability += Math.min(0.12, trailing7.minutes / 150);
    probability += currentStreak >= 3 ? 0.08 : currentStreak > 0 ? 0.04 : 0;
    probability -= Math.min(0.18, dueBacklog / 70);
    probability -= Math.min(0.14, overdueBacklog / 40);

    if (gapDays === 1) {
      probability += 0.12;
    } else if (gapDays === 2) {
      probability -= 0.12;
    } else if (gapDays > 2) {
      probability -= 0.24;
    }
  }

  probability = clamp(probability, 0.08, 0.98);

  const probabilityPercent = Math.round(probability * 100);
  const rescueCards = studiedToday
    ? 0
    : Math.round(
        clamp(
          Math.max(
            6,
            dueQueues.requiredCards.length * 0.7,
            averageActiveReviews * 0.45,
            currentStreak >= 7 ? 10 : 0
          ),
          6,
          28
        )
      );
  const rescueMinutes = studiedToday
    ? 0
    : Math.round(
        clamp(
          Math.max(8, rescueCards * 0.8, averageActiveMinutes * 0.55),
          8,
          36
        )
      );

  const riskTier =
    probabilityPercent >= 80 ? "low" : probabilityPercent >= 55 ? "medium" : "high";

  if (studiedToday) {
    return {
      currentStreak,
      studiedToday,
      lastStudyDayKey,
      trailing7ActiveDays: trailing7.activeDays,
      probabilityPercent,
      rescueCards,
      rescueMinutes,
      dueBacklog,
      overdueBacklog,
      riskTier,
      headline: "Today's streak is already protected.",
      explanation:
        `You already logged study activity today, and you've studied ${trailing7.activeDays} of the last 7 days. The remaining backlog is ${dueBacklog} card${dueBacklog === 1 ? "" : "s"}.`,
      actionLabel: "Keep going only if you want extra practice.",
    };
  }

  if (currentStreak === 0) {
    return {
      currentStreak,
      studiedToday,
      lastStudyDayKey,
      trailing7ActiveDays: trailing7.activeDays,
      probabilityPercent,
      rescueCards,
      rescueMinutes,
      dueBacklog,
      overdueBacklog,
      riskTier,
      headline: "A fresh streak is within reach.",
      explanation:
        lastStudyDayKey
          ? `The previous streak is already broken, but you've still studied ${trailing7.activeDays} of the last 7 days. There are ${dueBacklog} due card${dueBacklog === 1 ? "" : "s"} ready for a reset session.`
          : `No streak is active yet. A short session on the ${dueBacklog} available card${dueBacklog === 1 ? "" : "s"} is enough to start one.`,
      actionLabel: `Study ${rescueCards} cards for about ${rescueMinutes} min to start a new streak.`,
    };
  }

  return {
    currentStreak,
    studiedToday,
    lastStudyDayKey,
    trailing7ActiveDays: trailing7.activeDays,
    probabilityPercent,
    rescueCards,
    rescueMinutes,
    dueBacklog,
    overdueBacklog,
    riskTier,
    headline:
      probabilityPercent >= 75
        ? `${currentStreak}-day streak looks salvageable today.`
        : `${currentStreak}-day streak is under pressure today.`,
    explanation:
      `You've studied ${trailing7.activeDays} of the last 7 days, with ${dueBacklog} due card${dueBacklog === 1 ? "" : "s"} and ${overdueBacklog} overdue. A focused catch-up session should be enough before the next study boundary.`,
    actionLabel: `Study ${rescueCards} cards for about ${rescueMinutes} min to likely keep the streak alive.`,
  };
}
