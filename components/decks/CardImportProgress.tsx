"use client";

import { Button, Card as Panel, ElapsedTime, ProgressBar } from "@/components/ui";
import type { VideoCardJob } from "@/lib/ai/video-card-jobs";

/**
 * A card import that has failed, or is still being made: why it failed and the
 * way to start another, or the stage it has reached and the way to stop it.
 * Shows nothing once the cards are ready to review.
 */
export default function CardImportProgress({
  job,
  stageLabels,
  onTryAnother,
  onCancel,
}: {
  job: VideoCardJob;
  stageLabels: Record<VideoCardJob["stage"], string>;
  onTryAnother: () => void;
  onCancel: () => void;
}) {
  if (job.status === "failed") {
    return (
      <Panel tone="subtle" padding="md">
        <p className="text-sm text-text-secondary">{job.failureMessage}</p>
        <Button className="mt-3" variant="secondary" onClick={onTryAnother}>
          Try another
        </Button>
      </Panel>
    );
  }

  if (job.status !== "queued" && job.status !== "running") return null;

  return (
    <Panel tone="subtle" padding="md">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-text-primary">{stageLabels[job.stage]}</span>
        <span className="flex gap-2 tabular-nums text-text-muted">
          <ElapsedTime startedAt={job.createdAt} label="Making cards for" />
          <span>{job.progress}%</span>
        </span>
      </div>
      <ProgressBar className="mt-3" progress={job.progress} size="sm" variant="warm" />
      <Button className="mt-4" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </Panel>
  );
}
