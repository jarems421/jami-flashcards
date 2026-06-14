import type { DailyStudyActivity } from "@/lib/study/activity";
import { formatStudyDayLabel, getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

export type ProgressTimeRange = "7d" | "30d" | "all";

export const PROGRESS_TIME_RANGE_OPTIONS: Array<{
  value: ProgressTimeRange;
  label: string;
}> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

function getDaysAgoKey(daysAgo: number, now = Date.now()) {
  return shiftStudyDayKey(getStudyDayKey(now), -daysAgo);
}

export function filterStudyActivityByRange(
  activity: DailyStudyActivity[],
  range: ProgressTimeRange,
  now = Date.now()
) {
  if (range === "all") {
    return [...activity].sort((left, right) => left.dayKey.localeCompare(right.dayKey));
  }

  const days = range === "7d" ? 7 : 30;
  const cutoff = getDaysAgoKey(days - 1, now);
  return activity
    .filter((entry) => entry.dayKey >= cutoff)
    .sort((left, right) => left.dayKey.localeCompare(right.dayKey));
}

function buildRangeSeries<T>(
  activity: DailyStudyActivity[],
  range: ProgressTimeRange,
  getValue: (entry: DailyStudyActivity) => T,
  emptyValue: T,
  now = Date.now()
) {
  const filtered = filterStudyActivityByRange(activity, range, now);

  if (range === "all") {
    return filtered.map((entry) => ({
      day: formatStudyDayLabel(entry.dayKey),
      value: getValue(entry),
    }));
  }

  const days = range === "7d" ? 7 : 30;
  const activityByDay = new Map(filtered.map((entry) => [entry.dayKey, entry]));

  return Array.from({ length: days }, (_, index) => {
    const dayKey = getDaysAgoKey(days - index - 1, now);
    const entry = activityByDay.get(dayKey);
    return {
      day: formatStudyDayLabel(dayKey),
      value: entry ? getValue(entry) : emptyValue,
    };
  });
}

export function buildAccuracySeries(
  activity: DailyStudyActivity[],
  range: ProgressTimeRange,
  now = Date.now()
) {
  return buildRangeSeries(
    activity,
    range,
    (entry) =>
      entry.reviewCount > 0
        ? Math.round((entry.correctCount / entry.reviewCount) * 100)
        : 0,
    0,
    now
  ).map(({ day, value }) => ({ day, accuracy: value }));
}

export function buildStudyTimeSeries(
  activity: DailyStudyActivity[],
  range: ProgressTimeRange,
  now = Date.now()
) {
  return buildRangeSeries(
    activity,
    range,
    (entry) => Math.round(entry.totalDurationMs / 60_000),
    0,
    now
  ).map(({ day, value }) => ({ day, minutes: value }));
}

export function countStudyActiveDays(activity: DailyStudyActivity[]) {
  return activity.filter((entry) => entry.reviewCount > 0).length;
}

export function getStudyAccuracy(activity: DailyStudyActivity[]) {
  const reviews = activity.reduce((sum, entry) => sum + entry.reviewCount, 0);
  if (reviews === 0) {
    return 0;
  }

  const correct = activity.reduce((sum, entry) => sum + entry.correctCount, 0);
  return Math.round((correct / reviews) * 100);
}

export function getAverageStudySessionMinutes(activity: DailyStudyActivity[]) {
  const activeDays = countStudyActiveDays(activity);
  if (activeDays === 0) {
    return 0;
  }

  const totalMinutes =
    activity.reduce((sum, entry) => sum + entry.totalDurationMs, 0) / 60_000;
  return Math.round(totalMinutes / activeDays);
}

export function getAverageReviewsPerActiveDay(activity: DailyStudyActivity[]) {
  const activeDays = countStudyActiveDays(activity);
  if (activeDays === 0) {
    return 0;
  }

  const reviews = activity.reduce((sum, entry) => sum + entry.reviewCount, 0);
  return Math.round(reviews / activeDays);
}

export function getPercentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

type WorkspaceNotebook = { updatedAt: number };
type WorkspaceDraft = { contentStatus?: string };
type WorkspaceGoal = { status: string };

export function buildWorkspaceActivitySummary(
  {
    notebooks,
    sources,
    drafts,
    goals,
  }: {
    notebooks: WorkspaceNotebook[];
    sources: unknown[];
    drafts: WorkspaceDraft[];
    goals: WorkspaceGoal[];
  },
  now = Date.now()
) {
  const recentCutoff = now - 30 * 86_400_000;

  return {
    notebookCount: notebooks.length,
    recentlyEditedNotebookCount: notebooks.filter(
      (notebook) => notebook.updatedAt >= recentCutoff
    ).length,
    sourceCount: sources.length,
    waitingDraftCount: drafts.filter((draft) => draft.contentStatus === "draft").length,
    activeGoalCount: goals.filter((goal) => goal.status === "active").length,
    completedGoalCount: goals.filter((goal) => goal.status === "completed").length,
  };
}
