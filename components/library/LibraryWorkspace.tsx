"use client";

import { useEffect, useRef } from "react";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type {
  LibrarySourceStatusFilter,
  LibrarySourceTypeFilter,
} from "@/lib/study/library-navigation";
import type { LibraryBrowserController } from "@/hooks/useLibraryBrowser";
import { Button, EmptyState, Input } from "@/components/ui";
import SourcePreview from "./SourcePreview";
import {
  closeDisclosureAndFocusTrigger,
  sourceDisplayLabel,
  sourceTypeLabel,
  sourceTypes,
  SourceActionIcon,
  SourceTypeIcon,
} from "./SourceWorkspace";
import styles from "@/app/dashboard/library/page.module.css";

export type LibraryWorkspaceActions = {
  addSource: () => void;
  askTutor: () => void;
  openDrafts: () => void;
  openDetails: () => void;
  openOriginal: () => void;
  rename: () => void;
  archive: () => void;
  restore: () => void;
  delete: () => void;
};

type LibraryWorkspaceProps = {
  browser: LibraryBrowserController;
  folders: StudyFolder[];
  selectedSourceFileUrl?: string;
  sourceDraftCount: number;
  restoring: boolean;
  actions: LibraryWorkspaceActions;
};

/**
 * The two-pane source browser. Filtering/navigation lives in the supplied
 * browser controller; source mutations remain explicit actions owned by the
 * surrounding workflows.
 */
export default function LibraryWorkspace({
  browser,
  folders,
  selectedSourceFileUrl,
  sourceDraftCount,
  restoring,
  actions,
}: LibraryWorkspaceProps) {
  const filterDisclosureRef = useRef<HTMLDetailsElement>(null);
  const sourceActionsDisclosureRef = useRef<HTMLDetailsElement>(null);
  const selectedSource = browser.selectedSource;
  const canOpenSelectedSource = Boolean(
    selectedSource &&
      ((selectedSource.type === "link" && selectedSource.externalUrl) ||
        (selectedSource.type === "file" && selectedSourceFileUrl))
  );

  useEffect(() => {
    const closeMenusOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      for (const disclosure of [
        filterDisclosureRef.current,
        sourceActionsDisclosureRef.current,
      ]) {
        if (disclosure?.open && !disclosure.contains(event.target)) {
          disclosure.removeAttribute("open");
        }
      }
    };

    document.addEventListener("pointerdown", closeMenusOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeMenusOnOutsidePointer);
  }, []);

  if (browser.sourceCount === 0) {
    return (
      <EmptyState
        emoji="Sources"
        eyebrow="No sources yet"
        title="Build your reference library."
        description="Save notes, useful links, images, and study documents in one calm workspace."
        action={
          <Button type="button" onClick={actions.addSource}>
            Add source
          </Button>
        }
      />
    );
  }

  return (
    <div className={styles.workspaceFrame}>
      <section
        aria-label="Sources workspace"
        className={[
          styles.workspaceLayout,
          "app-panel !overflow-hidden !rounded-2xl",
        ].join(" ")}
      >
        <aside
          className={[
            styles.sourceRail,
            browser.mobileTab === "sources" ? "flex" : "hidden",
            "relative z-20 border-r border-[var(--color-border)] bg-[var(--color-surface-panel)]",
          ].join(" ")}
        >
          <div className="relative shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-3.5">
            <div className="flex items-center gap-2">
              <Input
                type="search"
                aria-label="Search Sources"
                placeholder="Search sources"
                value={browser.searchTerm}
                onChange={(event) => browser.setSearchTerm(event.target.value)}
                containerClassName="min-w-0 flex-1"
                className="!rounded-lg !px-4 !py-3"
              />
              <details
                ref={filterDisclosureRef}
                className="group relative shrink-0"
                onKeyDownCapture={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.currentTarget.removeAttribute("open");
                  event.currentTarget
                    .querySelector<HTMLElement>("summary")
                    ?.focus();
                }}
              >
                <summary
                  aria-label={
                    browser.activeFilterCount > 0
                      ? `Filter sources, ${browser.activeFilterCount} active ${
                          browser.activeFilterCount === 1 ? "filter" : "filters"
                        }`
                      : "Filter sources"
                  }
                  className="app-button-secondary relative grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full [&::-webkit-details-marker]:hidden"
                >
                  <SourceActionIcon name="filter" />
                  {browser.activeFilterCount > 0 ? (
                    <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border border-[var(--color-surface-panel-strong)] bg-[var(--color-accent)] px-1 text-2xs font-semibold text-[var(--color-text-inverse)]">
                      {browser.activeFilterCount}
                    </span>
                  ) : null}
                </summary>
                <div className="absolute right-0 z-40 mt-2 w-[15rem] max-w-[calc(100vw-3rem)] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-3 shadow-[var(--shadow-shell)]">
                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                        Folder
                      </span>
                      <select
                        value={browser.folderFilter}
                        onChange={(event) =>
                          browser.setFolderFilter(event.target.value)
                        }
                        className="app-field min-h-11 w-full rounded-md px-3 text-sm outline-none"
                      >
                        <option value="">All folders</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                        Type
                      </span>
                      <select
                        value={browser.typeFilter}
                        onChange={(event) =>
                          browser.setTypeFilter(
                            event.target.value as LibrarySourceTypeFilter
                          )
                        }
                        className="app-field min-h-11 w-full rounded-md px-3 text-sm outline-none"
                      >
                        <option value="all">All types</option>
                        {sourceTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {sourceTypeLabel(type.value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                        Status
                      </span>
                      <select
                        value={browser.statusFilter}
                        onChange={(event) =>
                          browser.setStatusFilter(
                            event.target.value as LibrarySourceStatusFilter
                          )
                        }
                        className="app-field min-h-11 w-full rounded-md px-3 text-sm outline-none"
                      >
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                        <option value="all">All statuses</option>
                      </select>
                    </label>
                  </div>
                  {browser.activeFilterCount > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={(event) => {
                        browser.clearFilters();
                        closeDisclosureAndFocusTrigger(event.currentTarget);
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              </details>
            </div>
            {browser.searchTerm || browser.activeFilterCount > 0 ? (
              <p className="mt-2 px-1 text-xs text-text-muted" aria-live="polite">
                {browser.filteredSources.length} result
                {browser.filteredSources.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>

          <nav
            aria-label="Saved sources"
            className={[styles.sourceList, "flex-1"].join(" ")}
          >
            {browser.filteredSources.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <div className="text-sm font-semibold text-text-primary">
                  No matching sources
                </div>
                <p className="mt-2 text-xs leading-5 text-text-muted">
                  Try another search or clear the filters.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  onClick={browser.clearFilters}
                >
                  Reset
                </Button>
              </div>
            ) : (
              browser.filteredSources.map((source) => {
                const active = source.id === selectedSource?.id;
                const firstFolder = source.folderIds
                  .map(
                    (folderId) =>
                      folders.find((folder) => folder.id === folderId)?.name
                  )
                  .find(Boolean);
                return (
                  <button
                    key={source.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => browser.selectSource(source.id)}
                    className={
                      "group relative flex min-h-[4.25rem] w-full items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-2.5 text-left transition " +
                      (active
                        ? "bg-[var(--color-selected-bg)] text-text-primary"
                        : "text-text-secondary hover:bg-[var(--color-glass-subtle)]")
                    }
                  >
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[var(--color-accent)]"
                      />
                    ) : null}
                    <SourceTypeIcon
                      type={source.type}
                      className="h-4 w-4 shrink-0 text-text-muted"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text-primary">
                        {source.title}
                      </span>
                      <span className="mt-1 block truncate text-xs text-text-muted">
                        {sourceDisplayLabel(source)}
                        {firstFolder ? ` · ${firstFolder}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </nav>
        </aside>

        <article
          className={[
            styles.readerPane,
            browser.mobileTab === "source" ? "flex" : "hidden",
            "relative z-10 bg-[var(--color-surface-panel)]",
          ].join(" ")}
        >
          {selectedSource ? (
            <>
              <header className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
                <div className="flex min-w-0 items-start gap-3">
                  <button
                    type="button"
                    aria-label="Back to all sources"
                    onClick={browser.showSourceList}
                    className={[
                      styles.mobileOnly,
                      "grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary",
                    ].join(" ")}
                  >
                    <SourceActionIcon name="arrow-left" className="h-5 w-5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-lg font-semibold leading-6 text-text-primary sm:text-xl">
                      {selectedSource.title}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                      <span>{sourceDisplayLabel(selectedSource)}</span>
                      {selectedSource.status === "archived" ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-text-secondary">
                            Archived
                          </span>
                        </>
                      ) : null}
                      {sourceDraftCount > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <button
                            type="button"
                            aria-label={`Review ${sourceDraftCount} ${
                              sourceDraftCount === 1 ? "draft" : "drafts"
                            } from this source`}
                            className="font-semibold text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
                            onClick={actions.openDrafts}
                          >
                            {sourceDraftCount} draft
                            {sourceDraftCount === 1 ? "" : "s"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-11"
                    onClick={actions.askTutor}
                  >
                    <SourceActionIcon name="sparkles" className="mr-2 h-4 w-4" />
                    Ask Jami about this
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="min-h-11"
                    onClick={actions.openDrafts}
                  >
                    Create from this
                    {sourceDraftCount > 0 ? (
                      <span className="ml-2 rounded-full bg-[var(--color-accent-muted)] px-1.5 py-0.5 text-2xs font-semibold tabular-nums">
                        {sourceDraftCount}
                      </span>
                    ) : null}
                  </Button>

                  <details
                    key={selectedSource.id}
                    ref={sourceActionsDisclosureRef}
                    className="group relative ml-auto"
                    onKeyDownCapture={(event) => {
                      if (event.key !== "Escape") return;
                      event.preventDefault();
                      event.currentTarget.removeAttribute("open");
                      event.currentTarget
                        .querySelector<HTMLElement>("summary")
                        ?.focus();
                    }}
                  >
                    <summary
                      aria-label="More source actions"
                      className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary [&::-webkit-details-marker]:hidden"
                    >
                      <SourceActionIcon name="more" className="h-5 w-5" />
                    </summary>
                    <div className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid min-w-48 gap-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-[var(--shadow-shell)]">
                      {canOpenSelectedSource ? (
                        <button
                          type="button"
                          className="min-h-11 rounded-sm px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                          onClick={(event) => {
                            closeDisclosureAndFocusTrigger(event.currentTarget);
                            actions.openOriginal();
                          }}
                        >
                          Open original
                          <span className="sr-only"> in a new tab</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="min-h-11 rounded-sm px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                        onClick={(event) => {
                          closeDisclosureAndFocusTrigger(event.currentTarget);
                          actions.openDetails();
                        }}
                      >
                        Details and organisation
                      </button>
                      {sourceDraftCount > 0 ? (
                        <button
                          type="button"
                          className="min-h-11 rounded-sm px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                          onClick={(event) => {
                            closeDisclosureAndFocusTrigger(event.currentTarget);
                            actions.openDrafts();
                          }}
                        >
                          Drafts ({sourceDraftCount})
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="min-h-11 rounded-sm px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                        onClick={(event) => {
                          closeDisclosureAndFocusTrigger(event.currentTarget);
                          actions.rename();
                        }}
                      >
                        Rename
                      </button>
                      <div
                        aria-hidden="true"
                        className="my-1 h-px bg-[var(--color-border)]"
                      />
                      <button
                        type="button"
                        disabled={restoring}
                        className="min-h-11 rounded-sm px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:opacity-50"
                        onClick={(event) => {
                          closeDisclosureAndFocusTrigger(event.currentTarget);
                          if (selectedSource.status === "active") actions.archive();
                          else actions.restore();
                        }}
                      >
                        {selectedSource.status === "active" ? "Archive" : "Restore"}
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-sm px-3 text-left text-sm font-semibold text-[var(--color-error-text)] hover:bg-[var(--color-error-muted)]"
                        onClick={(event) => {
                          closeDisclosureAndFocusTrigger(event.currentTarget);
                          actions.delete();
                        }}
                      >
                        Delete source
                      </button>
                    </div>
                  </details>
                </div>
              </header>

              <div
                id="selected-source-preview"
                className={[
                  styles.previewScroll,
                  "min-h-0 flex-1 bg-[var(--color-surface-panel-strong)]",
                ].join(" ")}
              >
                <SourcePreview
                  source={selectedSource}
                  fileUrl={selectedSourceFileUrl}
                />
              </div>
            </>
          ) : (
            <div className="flex min-h-[34rem] flex-1 items-center justify-center px-6 text-center">
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  No source selected
                </div>
                <p className="mt-2 text-sm leading-6 text-text-muted">
                  Choose a source or adjust your filters.
                </p>
              </div>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
