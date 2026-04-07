export type DailyStudyActivity = {
  id: string;
  dayKey: string;
  reviewCount: number;
  correctCount: number;
  totalDurationMs: number;
  updatedAt: number;
};

function padDayPart(value: number) {
  return String(value).padStart(2, "0");
}

export function getLocalDayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${padDayPart(date.getMonth() + 1)}-${padDayPart(
    date.getDate()
  )}`;
}

export function normalizeDailyStudyActivity(
  id: string,
  data: Record<string, unknown>
): DailyStudyActivity {
  return {
    id,
    dayKey: typeof data.dayKey === "string" && data.dayKey.trim() ? data.dayKey : id,
    reviewCount:
      typeof data.reviewCount === "number" && data.reviewCount >= 0
        ? data.reviewCount
        : 0,
    correctCount:
      typeof data.correctCount === "number" && data.correctCount >= 0
        ? data.correctCount
        : 0,
    totalDurationMs:
      typeof data.totalDurationMs === "number" && data.totalDurationMs >= 0
        ? data.totalDurationMs
        : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function countTodayReviews(
  activity: DailyStudyActivity[],
  timestamp = Date.now()
) {
  const todayKey = getLocalDayKey(timestamp);
  return (
    activity.find((entry) => entry.dayKey === todayKey)?.reviewCount ?? 0
  );
}

export function computeStudyStreak(
  activity: DailyStudyActivity[],
  timestamp = Date.now()
) {
  if (activity.length === 0) {
    return 0;
  }

  const reviewDays = new Set(
    activity
      .filter((entry) => entry.reviewCount > 0)
      .map((entry) => entry.dayKey)
  );
  if (reviewDays.size === 0) {
    return 0;
  }

  const now = new Date(timestamp);
  let streak = 0;

  for (let index = 0; index < 365; index += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    const dayKey = getLocalDayKey(date.getTime());

    if (reviewDays.has(dayKey)) {
      streak += 1;
      continue;
    }

    if (index === 0) {
      continue;
    }

    break;
  }

  return streak;
}

export function computeLongestStreak(activity: DailyStudyActivity[]) {
  const reviewDays = new Set(
    activity
      .filter((entry) => entry.reviewCount > 0)
      .map((entry) => entry.dayKey)
  );
  if (reviewDays.size === 0) {
    return 0;
  }

  const sortedDays = Array.from(reviewDays).sort();
  let longest = 1;
  let current = 1;

  for (let i = 1; i < sortedDays.length; i += 1) {
    const prev = new Date(sortedDays[i - 1] + "T00:00:00");
    const curr = new Date(sortedDays[i] + "T00:00:00");
    const diffDays = (curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);

    if (diffDays === 1) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
}
