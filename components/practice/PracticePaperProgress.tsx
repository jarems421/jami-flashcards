"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, ProgressBar, Skeleton } from "@/components/ui";
import type { PracticePaperAttempt } from "@/lib/practice/practice-papers";
import { getRecentPracticePaperAttempts } from "@/services/study/practice-papers";

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

  const summary = useMemo(() => {
    const percentages = attempts.flatMap((attempt) => attempt.result ? [attempt.result.percentage] : []);
    const average = percentages.length > 0
      ? Math.round(percentages.reduce((total, value) => total + value, 0) / percentages.length)
      : 0;
    return {
      average,
      best: percentages.length > 0 ? Math.max(...percentages) : 0,
      change: percentages.length > 1 ? Math.round((percentages[0] - percentages[1]) * 10) / 10 : null,
    };
  }, [attempts]);

  if (loading) return <Skeleton className="h-36 rounded-xl" />;
  if (attempts.length === 0) return null;

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Paper progress</p>
          <h2 className="mt-1 text-xl font-semibold text-text-primary">A calm view across your attempts</h2>
        </div>
        <div className="flex gap-5 text-right">
          <Metric label="Average" value={`${summary.average}%`} />
          <Metric label="Best" value={`${summary.best}%`} />
          {summary.change !== null ? <Metric label="Latest change" value={`${summary.change >= 0 ? "+" : ""}${summary.change}%`} /> : null}
        </div>
      </div>
      <ProgressBar progress={summary.average} />
      <div className="grid gap-2 sm:grid-cols-3">
        {attempts.slice(0, 3).map((attempt) => (
          <div key={attempt.id} className="rounded-xl bg-[var(--color-glass-subtle)] p-3">
            <p className="truncate text-xs text-text-muted">{attempt.paperTitle} · attempt {attempt.attemptNumber}</p>
            <p className="mt-1 text-2xs text-text-muted">{new Date(attempt.markedAt ?? attempt.updatedAt).toLocaleDateString()}</p>
            <p className="mt-1 text-lg font-semibold text-text-primary">{attempt.result?.percentage}%{attempt.result?.gradeLabel ? ` · ${attempt.result.gradeLabel}` : ""}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-text-muted">{label}</p><p className="text-lg font-semibold text-text-primary">{value}</p></div>;
}
