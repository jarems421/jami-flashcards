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
import { useUser } from "@/lib/auth/user-context";
import { loadStudyActivity } from "@/services/study/activity";
import { ensureStudyStateSetup } from "@/services/study/daily-review";
import {
  computeStudyStreak,
  computeLongestStreak,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import { formatStudyDayLabel, getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, EmptyState, PageHero, SectionHeader, Skeleton, StatTile } from "@/components/ui";

type TimeRange = "7d" | "30d" | "all";

function formatTooltipNumber(value: unknown, suffix = "") {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}${suffix}`;
  }

  if (typeof value === "string" && value.trim()) {
    return suffix ? `${value}${suffix}` : value;
  }

  return `0${suffix}`;
}

function getDaysAgoKey(daysAgo: number, now = Date.now()) {
  return shiftStudyDayKey(getStudyDayKey(now), -daysAgo);
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
        day: formatStudyDayLabel(entry.dayKey),
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
      day: formatStudyDayLabel(key),
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
        day: formatStudyDayLabel(entry.dayKey),
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
      day: formatStudyDayLabel(key),
      minutes: entry ? Math.round(entry.totalDurationMs / 60_000) : 0,
    });
  }

  return points;
}

function formatStudyTime(totalMs: number) {
  const minutes = Math.round(totalMs / 60_000);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
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
        await ensureStudyStateSetup(user.uid);
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
  const studiedDays = useMemo(
    () => activity.filter((entry) => entry.reviewCount > 0).length,
    [activity]
  );
  const totalStudyTime = useMemo(
    () => activity.reduce((sum, e) => sum + e.totalDurationMs, 0),
    [activity]
  );
  const averageAccuracy = useMemo(() => {
    if (totalReviews === 0) return 0;
    const correctCount = activity.reduce((sum, e) => sum + e.correctCount, 0);
    return Math.round((correctCount / totalReviews) * 100);
  }, [activity, totalReviews]);
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
      contentClassName="space-y-4 sm:space-y-6"
    >
      {loading ? (
        <div className="space-y-4 sm:space-y-6">
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
          <PageHero
            eyebrow="Study stats"
            title={totalReviews > 0 ? "Your study rhythm." : "Stats will grow with you."}
            description={
              totalReviews > 0
                ? "A calm snapshot of consistency, accuracy, and time spent learning."
                : "Complete a few reviews and this page will turn into a useful progress map."
            }
            tone="warm"
            aside={
              <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[20rem]">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
                  <div className="text-lg font-medium tabular-nums text-white sm:text-xl">{averageAccuracy}%</div>
                  <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Accuracy</div>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
                  <div className="text-lg font-medium tabular-nums text-white sm:text-xl">{studiedDays}</div>
                  <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Days</div>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
                  <div className="text-lg font-medium tabular-nums text-white sm:text-xl">{formatStudyTime(totalStudyTime)}</div>
                  <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Time</div>
                </div>
              </div>
            }
          />

          <div className="grid animate-slide-up gap-4 sm:grid-cols-3">
            <StatTile
              tone="warm"
              label="Current streak"
              value={`${currentStreak} day${currentStreak === 1 ? "" : "s"}`}
              detail="Your active study rhythm."
            />
            <StatTile
              tone="warm"
              label="Longest streak"
              value={`${longestStreak} day${longestStreak === 1 ? "" : "s"}`}
              detail="Your best run so far."
            />
            <StatTile
              tone="warm"
              label="Total reviews"
              value={totalReviews.toLocaleString()}
              detail="All completed study answers."
            />
          </div>

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

          <Card padding="lg" className="animate-fade-in">
            <SectionHeader title="Accuracy over time" description="How consistently you are recalling cards across the selected range." />
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
                      formatter={(value: unknown) => [formatTooltipNumber(value, "%"), "Accuracy"]}
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
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    variant="plain"
                    emoji="Stats"
                    eyebrow="No review data"
                    title="No reviews in this range"
                    description="Study a few cards and your accuracy trend will appear here."
                  />
                </div>
              )}
            </div>
          </Card>

          <Card padding="lg" className="animate-fade-in">
            <SectionHeader title="Time spent studying" description="A calm view of how much time your sessions are taking." />
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
                      formatter={(value: unknown) => [formatTooltipNumber(value, " min"), "Time"]}
                    />
                    <Bar
                      dataKey="minutes"
                      fill="url(#timeGradient)"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    variant="plain"
                    emoji="Time"
                    eyebrow="No time data"
                    title="No study time yet"
                    description="Once you complete sessions, this chart will show how much time you spent studying."
                  />
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </AppPage>
  );
}
