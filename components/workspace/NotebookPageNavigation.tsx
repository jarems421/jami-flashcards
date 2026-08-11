"use client";

import { NotebookIcon } from "@/components/workspace/NotebookToolbarIconButton";

export default function NotebookPageNavigation({
  selectedPageIndex,
  pageCount,
  navigationBusy,
  editingToolbarVisible,
  canCreatePage,
  creatingPage,
  onPrevious,
  onNext,
  onCreate,
}: {
  selectedPageIndex: number;
  pageCount: number;
  navigationBusy: boolean;
  editingToolbarVisible: boolean;
  canCreatePage: boolean;
  creatingPage: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCreate: () => void;
}) {
  const iconButton =
    "inline-grid h-9 w-9 place-items-center rounded-full text-text-secondary transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35";
  return (
    <div
      className={`notebook-floating-control absolute right-3 z-20 flex items-center gap-1 rounded-full border border-[var(--color-border)] p-1 md:right-4 ${
        editingToolbarVisible
          ? "bottom-[calc(var(--notebook-control-bottom-inset)+3.95rem)] md:bottom-[var(--notebook-control-bottom-inset)]"
          : "bottom-[var(--notebook-control-bottom-inset)]"
      }`}
      aria-label="Page navigation"
    >
      <button
        type="button"
        aria-label="Previous page"
        title="Previous page"
        disabled={selectedPageIndex <= 0 || navigationBusy}
        onClick={onPrevious}
        className={iconButton}
      >
        <span className="rotate-90"><NotebookIcon name="chevron" /></span>
      </button>
      <div className="min-w-[3.25rem] px-1 text-center text-xs font-semibold tabular-nums text-text-secondary">
        {selectedPageIndex >= 0 ? selectedPageIndex + 1 : 0} / {pageCount || 0}
      </div>
      {canCreatePage ? (
        <button
          type="button"
          aria-label="New page"
          title="New page"
          disabled={creatingPage || navigationBusy}
          onClick={onCreate}
          className={`${iconButton} text-[var(--color-selected-text)] hover:bg-[var(--color-selected-bg)]`}
        >
          <NotebookIcon name="plus" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Next page"
          title="Next page"
          disabled={selectedPageIndex < 0 || selectedPageIndex >= pageCount - 1 || navigationBusy}
          onClick={onNext}
          className={iconButton}
        >
          <span className="-rotate-90"><NotebookIcon name="chevron" /></span>
        </button>
      )}
    </div>
  );
}
