"use client";

import { Button, Card } from "@/components/ui";

type NotebookDraftConflictBannerProps = {
  open: boolean;
  /** Drops below the feedback banner when one is already on screen. */
  belowFeedback: boolean;
  onKeepSynced: () => void;
  onRestoreLocal: () => void;
};

/**
 * Offered when a local recovery copy and the synced page have both moved on.
 *
 * Neither version can be discarded silently, so the student chooses.
 */
export default function NotebookDraftConflictBanner({
  open,
  belowFeedback,
  onKeepSynced,
  onRestoreLocal,
}: NotebookDraftConflictBannerProps) {
  if (!open) return null;

  return (
    <div
      className={`absolute left-3 right-3 z-50 mx-auto max-w-2xl ${
        belowFeedback ? "top-24" : "top-3"
      }`}
    >
      <Card
        padding="sm"
        role="alert"
        className="border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] shadow-shell"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              Unsaved work found on this device
            </p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              The synced page changed after this recovery copy was made. Choose
              which version to keep.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onKeepSynced}
            >
              Keep synced
            </Button>
            <Button type="button" size="sm" onClick={onRestoreLocal}>
              Restore mine
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
