"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, SectionHeader, Skeleton, StatTile } from "@/components/ui";
import type { PracticePaperAttempt } from "@/lib/practice/practice-papers";
import { getRecentPracticePaperAttempts } from "@/services/study/practice-papers";
import { scoreBand } from "./ScoreBand";

export default function PracticePaperProgress({ userId }: { userId: string }) {
  const [attempts, setAttempts] = useState<PracticePaperAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getRecentPracticePaperAttempts(userId, 12)
      .then((items) => { if (active) setAttempts(items); })
      .catch(() => { if (active) setAttempts([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  /*
   * Only marked attempts. The recent list used to map straight over everything
   * returned and print `{attempt.result?.percentage}%`, so an attempt still
   * being marked rendered the string "undefined%" into the card.
   */
  const marked = useMemo(
    () => attempts.filter((attempt) => attempt.result),
    [attempts]
  );

  const summary = useMemo(() => {
    const percentages = marked.map((attempt) => attempt.result!.percentage);
    const average = percentages.length > 0
      ? Math.round(percentages.reduce((total, value) => total + value, 0) / percentages.length)
      : 0;
    return {
      average,
      best: percentages.length > 0 ? Math.max(...percentages) : 0,
      change: percentages.length > 1 ? Math.round((percentages[0] - percentages[1]) * 10) / 10 : null,
    };
  }, [marked]);

  if (loading) return <Skeleton className="h-36 rounded-xl" />;
  if (marked.length === 0) return null;

  return (
    <Card padding="lg" className="space-y-5">
      {/*
       * The heading used to read "A calm view across your attempts", which
       * describes the mood of the card rather than telling anyone what is in
       * it. The numbers below say the calm part on their own.
       */}
      <SectionHeader
        eyebrow="Paper progress"
        title={`Across your last ${marked.length} marked paper${marked.length === 1 ? "" : "s"}`}
      />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <StatTile label="Average" value={`${summary.average}%`} compact />
        <StatTile label="Best" value={`${summary.best}%`} compact />
        {summary.change !== null ? (
          <StatTile
            label="Since last paper"
            value={
              <span
                className={
                  summary.change > 0
                    ? "text-[var(--color-success-text)]"
                    : summary.change < 0
                      ? "text-[var(--color-warning-text)]"
                      : ""
                }
              >
                {summary.change > 0 ? "+" : ""}
                {summary.change}%
              </span>
            }
            compact
          />
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {marked.slice(0, 3).map((attempt) => {
          const result = attempt.result!;
          const tone = scoreBand({
            awardedMarks: result.awardedMarks,
            maxMarks: result.totalMarks,
          });
          return (
            <li
              key={attempt.id}
              className="flex items-center gap-3 rounded-xl bg-[var(--color-glass-subtle)] px-3.5 py-2.5"
            >
              <span
                aria-hidden="true"
                className={`h-6 w-1 shrink-0 rounded-full ${tone.mark}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {attempt.paperTitle}
                </span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  Attempt {attempt.attemptNumber} ·{" "}
                  {new Date(attempt.markedAt ?? attempt.updatedAt).toLocaleDateString()}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-text-primary">
                  {result.percentage}%
                </span>
                {result.gradeLabel ? (
                  <span className="block text-xs text-text-muted">
                    {result.gradeLabel}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
