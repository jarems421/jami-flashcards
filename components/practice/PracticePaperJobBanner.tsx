"use client";

import { Button, ElapsedTime, ProgressBar } from "@/components/ui";
import { canCancelPracticePaperJob, PRACTICE_PAPER_JOB_STAGE_LABELS } from "@/lib/practice/practice-paper-jobs";
import type { PracticePaperJob } from "@/lib/practice/practice-papers";

/**
 * A paper request's state, at the top of the builder.
 *
 * Opened from the Practice paper builder, the request is why the student is
 * here, so its state leads the page instead of waiting below the form: a
 * failure with the way to try again, or the stage it has reached with the way
 * to stop it. A request waiting on a confirmed format is shown in the form,
 * where the format is.
 */
export default function PracticePaperJobBanner({
  job,
  working,
  onRetry,
  onDismiss,
  onCancel,
}: {
  job: PracticePaperJob | null;
  working: boolean;
  onRetry: () => void;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  if (job?.status === "failed") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[color-mix(in_srgb,var(--color-warning-text)_32%,transparent)] bg-[color-mix(in_srgb,var(--color-warning-text)_7%,transparent)] p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">This paper could not be built</p>
            <p className="mt-0.5 truncate text-xs text-text-secondary">{job.title}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--color-warning-text)]">
              {job.failureMessage ?? "Jami could not finish that paper just now."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={working} onClick={onRetry}>
              Try again
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={working} onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!job || !canCancelPracticePaperJob(job.status) || job.status === "needs_confirmation") return null;

  return (
    <div className="rounded-2xl border border-accent/25 bg-accent/8 p-4" role="status">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">{PRACTICE_PAPER_JOB_STAGE_LABELS[job.stage]}</p>
          <p className="mt-0.5 truncate text-xs text-text-secondary">{job.title}</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            You can leave this page. The paper will appear in Practice when it is ready.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <ProgressBar progress={job.progress} size="sm" className="flex-1" />
        <ElapsedTime startedAt={job.createdAt} label="Building for" className="shrink-0 text-xs text-text-muted" />
      </div>
    </div>
  );
}
