"use client";

import { NotebookIcon } from "@/components/workspace/NotebookToolbarIconButton";

import type { NotebookSaveStatus } from "@/lib/workspace/notebook-page-state";

/** Component-facing alias for the domain type. */
export type SaveStatus = NotebookSaveStatus;

// Icon-only autosave state so the header never shifts as the status changes.
// The failed state is the exception: it becomes an explicit retry action.
export default function NotebookSaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "failed") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-error-text)]/40 bg-[var(--color-error-text)]/10 px-2 py-0.5 text-[0.68rem] font-semibold text-[var(--color-error-text)] transition hover:bg-[var(--color-error-text)]/20 [&_svg]:h-3.5 [&_svg]:w-3.5"
      >
        <NotebookIcon name="alert" />
        Retry save
      </button>
    );
  }

  const label =
    status === "saving"
      ? "Saving..."
      : status === "unsaved"
        ? "Unsaved changes"
        : "All changes saved";
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="inline-grid h-5 w-5 shrink-0 place-items-center text-text-muted [&_svg]:h-3.5 [&_svg]:w-3.5"
    >
      {status === "saving" ? (
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      ) : status === "unsaved" ? (
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-[var(--color-selected-border)]"
        />
      ) : (
        <NotebookIcon name="check" />
      )}
    </span>
  );
}
