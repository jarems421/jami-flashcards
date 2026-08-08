"use client";

import { memo } from "react";
import { Button } from "@/components/ui";
import { NotebookIcon } from "@/components/workspace/NotebookToolbarIconButton";
import NotebookPageThumbnail from "@/components/workspace/NotebookPageThumbnail";
import type {
  Notebook,
  NotebookFile,
  NotebookPage,
} from "@/lib/workspace/notebooks";

export type NotebookPageBackground = {
  file: NotebookFile | null;
  url: string | undefined;
};

type Props = {
  pages: NotebookPage[];
  notebook: Notebook;
  selectedPageId: string | null;
  /** Page currently being deleted, if any. */
  deletingPageId: string | null;
  editingEnabled: boolean;
  creatingPage: boolean;
  /** Page changes are locked while a swipe or handoff is animating. */
  navigationBusy: boolean;
  resolvePageBackground: (page: NotebookPage) => NotebookPageBackground;
  onSelectPage: (pageId: string) => void;
  onCreatePage: () => void;
  onImportPages: () => void;
  onRequestDeletePage: (page: NotebookPage) => void;
};

function NotebookPagesDrawer({
  pages,
  notebook,
  selectedPageId,
  deletingPageId,
  editingEnabled,
  creatingPage,
  navigationBusy,
  resolvePageBackground,
  onSelectPage,
  onCreatePage,
  onImportPages,
  onRequestDeletePage,
}: Props) {
  return (
    <aside
      aria-label="Notebook pages"
      className="notebook-drawer-in notebook-drawer-surface absolute bottom-0 left-0 top-0 z-50 flex min-h-0 w-64 flex-col border-r border-[var(--color-border)] p-3 shadow-[18px_0_42px_rgba(0,0,0,0.2)]"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-2">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          Pages
        </div>
        <span className="app-chip rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums">
          {pages.length}
        </span>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-2 px-1 pb-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full gap-1.5"
          disabled={!editingEnabled || creatingPage || navigationBusy}
          onClick={onCreatePage}
        >
          <NotebookIcon name="plus" />
          New page
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full"
          disabled={!editingEnabled}
          onClick={onImportPages}
        >
          Import PDF or image
        </Button>
      </div>

      <div
        role="region"
        aria-label="Notebook page list"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pr-1"
      >
        {pages.length > 0 ? (
          pages.map((page) => {
            const selected = page.id === selectedPageId;
            const deleting = deletingPageId === page.id;
            const thumbnailBackground = resolvePageBackground(page);
            return (
              <div
                key={page.id}
                className={`group relative rounded-md border transition ${
                  selected
                    ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] shadow-[0_0_0_3px_rgba(143,125,232,0.14)]"
                    : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)]"
                }`}
              >
                <button
                  type="button"
                  aria-label={`Open page ${page.pageNumber}`}
                  aria-current={selected ? "page" : undefined}
                  disabled={navigationBusy}
                  onClick={() => onSelectPage(page.id)}
                  className="block w-full rounded-md p-1.5 text-left transition"
                >
                  <NotebookPageThumbnail
                    page={page}
                    notebook={notebook}
                    backgroundFile={thumbnailBackground.file ?? undefined}
                    backgroundUrl={thumbnailBackground.url}
                  />
                </button>
                {/* A notebook always keeps at least one page. */}
                {pages.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Delete Page ${page.pageNumber}`}
                    title={`Delete Page ${page.pageNumber}`}
                    disabled={
                      Boolean(deletingPageId) || !editingEnabled || navigationBusy
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      onRequestDeletePage(page);
                    }}
                    className="absolute right-3 top-3 inline-grid h-8 w-8 place-items-center rounded-full bg-error text-[var(--color-text-inverse)] shadow-[0_3px_10px_rgba(0,0,0,0.35)] transition hover:scale-105 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {deleting ? (
                      <span className="text-2xs font-bold">...</span>
                    ) : (
                      <NotebookIcon name="trash" />
                    )}
                  </button>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 text-sm leading-6 text-text-muted">
            Start with a fresh page using New page above.
          </div>
        )}
      </div>
    </aside>
  );
}

export { NotebookPagesDrawer };

export default memo(NotebookPagesDrawer);
