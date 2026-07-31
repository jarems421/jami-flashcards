"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type AccuracyPoint = { day: string; accuracy: number };
export type StudyTimePoint = { day: string; minutes: number };

function formatTooltipNumber(value: unknown, suffix: string) {
  return typeof value === "number" ? `${Math.round(value)}${suffix}` : "0";
}

/**
 * Accuracy over the selected range.
 *
 * Charts live here rather than on the page so recharts stays out of the
 * initial bundle: Progress is the only screen that draws one.
 */
export function AccuracyChart({
  data,
  showDots,
}: {
  data: AccuracyPoint[];
  /** Individual points read as noise on longer ranges. */
  showDots: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11 }}
          tickFormatter={(value: number) => `${value}%`}
        />
        <Tooltip
          formatter={(value: unknown) => [
            formatTooltipNumber(value, "%"),
            "Accuracy",
          ]}
        />
        <Line
          type="monotone"
          dataKey="accuracy"
          stroke="var(--color-accent)"
          strokeWidth={2.5}
          dot={showDots}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Minutes spent in completed study sessions. */
export function StudyTimeChart({ data }: { data: StudyTimePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(value: number) => `${value}m`} />
        <Tooltip
          formatter={(value: unknown) => [
            formatTooltipNumber(value, " min"),
            "Time",
          ]}
        />
        <Bar dataKey="minutes" fill="var(--color-accent)" radius={[7, 7, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
