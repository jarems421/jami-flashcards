"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { useUser } from "@/lib/auth/user-context";
import { loadStudyActivity } from "@/services/study/activity";
import {
  computeStudyStreak,
  computeLongestStreak,
  getLocalDayKey,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, Skeleton } from "@/components/ui";

type TimeRange = "7d" | "30d" | "all";

function getDaysAgoKey(daysAgo: number, now = Date.now()) {
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  return getLocalDayKey(date.getTime());
}

function formatDayLabel(dayKey: string) {
  const [, month, day] = dayKey.split("-");
  return `${month}/${day}`;
}

function filterByRange(
  activity: DailyStudyActivity[],
  range: TimeRange,
  now = Date.now()
) {
  if (range === "all") return activity;
  const days = range === "7d" ? 7 : 30;
  const cutoff = getDaysAgoKey(days - 1, now);
  return activity.filter((entry) => entry.dayKey >= cutoff);
}

function buildAccuracyData(
  activity: DailyStudyActivity[],
  range: TimeRange,
  now = Date.now()
) {
  const filtered = filterByRange(activity, range, now);
  if (range === "all") {
    return filtered
      .filter((entry) => entry.reviewCount > 0)
      .map((entry) => ({
        day: formatDayLabel(entry.dayKey),
        accuracy:
          entry.reviewCount > 0
            ? Math.round((entry.correctCount / entry.reviewCount) * 100)
            : 0,
      }));
  }

  const days = range === "7d" ? 7 : 30;
  const activityMap = new Map(filtered.map((e) => [e.dayKey, e]));
  const points: { day: string; accuracy: number }[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const key = getDaysAgoKey(i, now);
    const entry = activityMap.get(key);
    points.push({
      day: formatDayLabel(key),
      accuracy:
        entry && entry.reviewCount > 0
          ? Math.round((entry.correctCount / entry.reviewCount) * 100)
          : 0,
    });
  }

  return points;
}

function buildTimeData(
  activity: DailyStudyActivity[],
  range: TimeRange,
  now = Date.now()
) {
  const filtered = filterByRange(activity, range, now);
  if (range === "all") {
    return filtered
      .filter((entry) => entry.totalDurationMs > 0)
      .map((entry) => ({
        day: formatDayLabel(entry.dayKey),
        minutes: Math.round(entry.totalDurationMs / 60_000),
      }));
  }

  const days = range === "7d" ? 7 : 30;
  const activityMap = new Map(filtered.map((e) => [e.dayKey, e]));
  const points: { day: string; minutes: number }[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const key = getDaysAgoKey(i, now);
    const entry = activityMap.get(key);
    points.push({
      day: formatDayLabel(key),
      minutes: entry ? Math.round(entry.totalDurationMs / 60_000) : 0,
    });
  }

  return points;
}

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

export default function StatsPage() {
  const { user } = useUser();
  const [activity, setActivity] = useState<DailyStudyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>("30d");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await loadStudyActivity(user.uid);
        if (!cancelled) setActivity(data);
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  const currentStreak = useMemo(() => computeStudyStreak(activity), [activity]);
  const longestStreak = useMemo(() => computeLongestStreak(activity), [activity]);
  const totalReviews = useMemo(
    () => activity.reduce((sum, e) => sum + e.reviewCount, 0),
    [activity]
  );
  const accuracyData = useMemo(
    () => buildAccuracyData(activity, range),
    [activity, range]
  );
  const timeData = useMemo(
    () => buildTimeData(activity, range),
    [activity, range]
  );

  return (
    <AppPage
      title="Statistics"
      backHref="/dashboard"
      backLabel="Home"
      width="2xl"
      contentClassName="space-y-6"
    >
      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid animate-slide-up gap-4 sm:grid-cols-3">
            <Card tone="warm" padding="md">
              <div className="flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-[#ff9b5c]">
                  <path d="M12 2c.5 3.5 4.8 6 4.8 10a5 5 0 01-9.6 0C7.2 8 11.5 5.5 12 2z" fill="currentColor" />
                </svg>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Current streak
                </div>
              </div>
              <div className="mt-3 text-4xl font-bold">
                {currentStreak} <span className="text-base font-normal text-text-secondary">day{currentStreak === 1 ? "" : "s"}</span>
              </div>
            </Card>
            <Card tone="warm" padding="md">
              <div className="flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-[#ffd36b]">
                  <path d="M11.049 2.927a1 1 0 011.902 0l1.718 4.134 4.456.357a1 1 0 01.617 1.732l-3.392 2.908 1.036 4.345a1 1 0 01-1.525 1.084L12 15.347l-3.861 2.14a1 1 0 01-1.525-1.084l1.036-4.345-3.392-2.908a1 1 0 01.617-1.732l4.456-.357 1.718-4.134z" fill="currentColor" />
                </svg>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Longest streak
                </div>
              </div>
              <div className="mt-3 text-4xl font-bold">
                {longestStreak} <span className="text-base font-normal text-text-secondary">day{longestStreak === 1 ? "" : "s"}</span>
              </div>
            </Card>
            <Card tone="warm" padding="md">
              <div className="flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-[#b77cff]">
                  <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Total reviews
                </div>
              </div>
              <div className="mt-3 text-4xl font-bold">
                {totalReviews.toLocaleString()}
              </div>
            </Card>
          </div>

          {/* Range selector */}
          <div className="flex flex-wrap gap-2">
            {TIME_RANGE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={range === option.value ? "primary" : "secondary"}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {/* Accuracy chart */}
          <Card padding="lg" className="animate-fade-in">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Accuracy over time
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              Percentage of correct answers per day
            </p>
            <div className="mt-4 h-64 w-full">
              {accuracyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={accuracyData}>
                    <defs>
                      <linearGradient id="accuracyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#b77cff" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#b77cff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="day"
                      stroke="rgba(255,255,255,0.3)"
                      tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="rgba(255,255,255,0.3)"
                      tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(18,11,34,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "1rem",
                        color: "#fff",
                        fontSize: 13,
                      }}
                      formatter={(value?: ValueType) => [`${value ?? 0}%`, "Accuracy"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="accuracy"
                      stroke="#b77cff"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#b77cff", strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: "#b77cff", stroke: "#fff", strokeWidth: 2 }}
                      fillOpacity={1}
                      fill="url(#accuracyGradient)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-sm text-text-muted">
                  No review data for this period yet.
                </p>
              )}
            </div>
          </Card>

          {/* Time chart */}
          <Card padding="lg" className="animate-fade-in">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Time spent studying
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              Minutes studied per day
            </p>
            <div className="mt-4 h-64 w-full">
              {timeData.some((d) => d.minutes > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timeData}>
                    <defs>
                      <linearGradient id="timeGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ffc7ea" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#b77cff" stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="day"
                      stroke="rgba(255,255,255,0.3)"
                      tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      stroke="rgba(255,255,255,0.3)"
                      tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }}
                      tickFormatter={(v: number) => `${v}m`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(18,11,34,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "1rem",
                        color: "#fff",
                        fontSize: 13,
                      }}
                      formatter={(value?: ValueType) => [`${value ?? 0} min`, "Time"]}
                    />
                    <Bar
                      dataKey="minutes"
                      fill="url(#timeGradient)"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-sm text-text-muted">
                  No time tracking data yet. Study some cards to start tracking.
                </p>
              )}
            </div>
          </Card>
        </>
      )}
    </AppPage>
  );
}
