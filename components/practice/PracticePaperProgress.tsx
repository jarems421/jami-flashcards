"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, ProgressBar, SectionHeader, StatTile } from "@/components/ui";
import type {
  PracticePaperAttempt,
  PracticePaperJob,
} from "@/lib/practice/practice-papers";
import {
  PRACTICE_PAPER_JOB_STAGE_LABELS,
  getPaperBuilderJobs,
  isPracticePaperJobBuilding,
} from "@/lib/practice/practice-paper-jobs";
import {
  acknowledgePracticePaperJob,
  getRecentPracticePaperJobs,
  retryPracticePaperJob,
} from "@/services/ai/practice-papers";
import { getRecentPracticePaperAttempts } from "@/services/study/practice-papers";
import { scoreBand } from "./ScoreBand";

const JOB_POLL_MS = 5_000;

function jobDetail(job: PracticePaperJob) {
  switch (job.status) {
    case "needs_confirmation":
      return "Confirm the exam format so Jami can carry on";
    case "needs_clarification":
      return "Jami needs one more detail from you";
    case "failed":
      return job.failureMessage ?? "This paper could not be built.";
    default:
      return PRACTICE_PAPER_JOB_STAGE_LABELS[job.stage];
  }
}

function BuilderJobRow({
  job,
  busy,
  error,
  onRetry,
  onDismiss,
}: {
  job: PracticePaperJob;
  busy: boolean;
  error?: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const failed = job.status === "failed";
  const building = isPracticePaperJobBuilding(job.status);

  return (
    <li
      className={`rounded-xl border p-1.5 ${
        failed
          ? "border-[color-mix(in_srgb,var(--color-warning-text)_32%,transparent)] bg-[color-mix(in_srgb,var(--color-warning-text)_6%,transparent)]"
          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)]"
      }`}
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        {/*
         * The whole row opens the paper's own page: live progress while it
         * builds, the question Jami is waiting on, or the failure with its
         * retry. The actions sit beside the link rather than inside it.
         */}
        <Link
          href={`/dashboard/practice/new?job=${encodeURIComponent(job.id)}`}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2 transition duration-fast hover:bg-[var(--nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              failed
                ? "bg-[var(--color-warning-text)]"
                : building
                  ? "bg-accent motion-safe:animate-pulse"
                  : "bg-accent"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-text-primary">
              {job.title}
            </span>
            <span
              className={`mt-0.5 block text-xs leading-5 ${
                failed ? "text-[var(--color-warning-text)]" : "text-text-muted"
              }`}
            >
              {jobDetail(job)}
            </span>
            {building ? (
              <ProgressBar progress={job.progress} size="sm" className="mt-2" />
            ) : null}
          </span>
          {building ? (
            <span className="shrink-0 text-xs font-semibold tabular-nums text-text-secondary">
              {job.progress}%
            </span>
          ) : null}
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-text-muted transition duration-fast group-hover:translate-x-0.5 group-hover:text-text-primary"
          >
            <path
              d="M7.5 5l5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        {failed ? (
          <div className="flex shrink-0 gap-2 px-2.5 pb-1.5 sm:px-1 sm:pb-0">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={onRetry}
            >
              {busy ? "Starting..." : "Try again"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onDismiss}
            >
              Dismiss
            </Button>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-2.5 pb-1.5 pt-1 text-xs text-[var(--color-warning-text)]">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export default function PracticePaperProgress({ userId }: { userId: string }) {
  const [attempts, setAttempts] = useState<PracticePaperAttempt[]>([]);
  const [jobs, setJobs] = useState<PracticePaperJob[]>([]);
  const [dismissedJobIds, setDismissedJobIds] = useState<string[]>([]);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ jobId: string; message: string } | null>(null);
  // Bumped after a retry so polling restarts for the job that is building again.
  const [pollKey, setPollKey] = useState(0);

  useEffect(() => {
    let active = true;
    void getRecentPracticePaperAttempts(userId, 12)
      .then((items) => {
        if (active) setAttempts(items);
      })
      .catch(() => {
        if (active) setAttempts([]);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await getRecentPracticePaperJobs();
        if (!active) return;
        setJobs(next);
        if (next.some((job) => isPracticePaperJobBuilding(job.status))) {
          timer = setTimeout(() => void load(), JOB_POLL_MS);
        }
      } catch {
        // The builder is a status view; a failed refresh keeps the last list.
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollKey]);

  const builderJobs = useMemo(
    () =>
      getPaperBuilderJobs(jobs).filter((job) => !dismissedJobIds.includes(job.id)),
    [dismissedJobIds, jobs]
  );

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

  const retry = async (job: PracticePaperJob) => {
    setBusyJobId(job.id);
    setRowError(null);
    try {
      const next = await retryPracticePaperJob(job.id);
      setJobs((current) =>
        current.map((candidate) => (candidate.id === next.id ? next : candidate))
      );
      setPollKey((key) => key + 1);
    } catch (error) {
      setRowError({
        jobId: job.id,
        message: error instanceof Error ? error.message : "Jami could not try that paper again.",
      });
    } finally {
      setBusyJobId(null);
    }
  };

  const dismiss = async (job: PracticePaperJob) => {
    setRowError(null);
    setDismissedJobIds((ids) => [...ids, job.id]);
    try {
      await acknowledgePracticePaperJob(job.id);
    } catch {
      setDismissedJobIds((ids) => ids.filter((id) => id !== job.id));
      setRowError({ jobId: job.id, message: "Could not dismiss this paper. Try again." });
    }
  };

  // Nothing building, nothing failed, nothing marked: the section is not shown.
  if (marked.length === 0 && builderJobs.length === 0) return null;

  const buildingCount = builderJobs.filter((job) => job.status !== "failed").length;
  const failedCount = builderJobs.length - buildingCount;
  const builderTitle = buildingCount > 0
    ? `Jami is building ${buildingCount === 1 ? "a paper" : `${buildingCount} papers`}`
    : `${failedCount === 1 ? "A paper" : `${failedCount} papers`} could not be built`;

  return (
    <div className="space-y-4">
      {builderJobs.length > 0 ? (
        <Card padding="lg" className="space-y-4">
          <SectionHeader eyebrow="Paper builder" title={builderTitle} />
          <ul className="space-y-2">
            {builderJobs.map((job) => (
              <BuilderJobRow
                key={job.id}
                job={job}
                busy={busyJobId === job.id}
                error={rowError?.jobId === job.id ? rowError.message : undefined}
                onRetry={() => void retry(job)}
                onDismiss={() => void dismiss(job)}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      {marked.length > 0 ? (
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
      ) : null}
    </div>
  );
}
