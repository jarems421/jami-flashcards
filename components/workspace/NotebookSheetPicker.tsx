"use client";

import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  Skeleton,
} from "@/components/ui";
import { NotebookIcon } from "@/components/workspace/NotebookToolbarIconButton";
import type { NotebookSheet } from "@/lib/workspace/notebook-sheet";

/**
 * Choosing a sheet to keep beside the page: the files imported into this
 * notebook and the folder's own PDFs and pictures.
 *
 * Says once, up front, what a kept sheet does, because nothing else on the
 * page explains it. A file sent to Jami is kept from the chat itself.
 */
export default function NotebookSheetPicker({
  open,
  replacing,
  firstSheet,
  notebookSheets,
  folderSheets,
  folderLoading,
  folderFailed,
  keptPaths,
  onPick,
  onCancel,
}: {
  open: boolean;
  /** Choosing a different sheet for a panel already open, rather than another one. */
  replacing: boolean;
  /** Nothing is beside the page yet, so this is where the feature is explained. */
  firstSheet: boolean;
  notebookSheets: readonly NotebookSheet[];
  folderSheets: readonly NotebookSheet[];
  folderLoading: boolean;
  folderFailed: boolean;
  /** The sheets already beside the page. */
  keptPaths: readonly string[];
  onPick: (sheet: NotebookSheet) => void;
  onCancel: () => void;
}) {
  const nothing = notebookSheets.length === 0 && folderSheets.length === 0 && !folderLoading;
  const title = replacing
    ? "Change this sheet"
    : firstSheet
      ? "Keep a sheet beside your page"
      : "Keep another sheet beside your page";
  const description = firstSheet
    ? "Work from a question sheet or mark scheme without swiping away from your working. Drag it anywhere, resize it, and it stays as you turn pages. Up to three at once."
    : replacing
      ? "The new sheet opens where this one is."
      : "It opens clear of what is already on screen. Up to three at once.";
  return (
    <Dialog
      open={open}
      className="fixed inset-0 flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4"
      onDismiss={() => onCancel()}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative my-4 flex max-h-[min(40rem,calc(100dvh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-xl backdrop-blur-md sm:rounded-2xl">
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
            <NotebookIcon name="sheet" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-sm font-semibold text-text-primary">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs leading-5 text-text-muted">{description}</DialogDescription>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-border)] px-2 py-2">
          {notebookSheets.length > 0 ? (
            <SheetGroup label="In this notebook" sheets={notebookSheets} keptPaths={keptPaths} onPick={onPick} />
          ) : null}
          {folderLoading ? (
            <div className="space-y-2 px-2 py-2" aria-label="Loading this folder's files">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : folderSheets.length > 0 ? (
            <SheetGroup label="In this folder" sheets={folderSheets} keptPaths={keptPaths} onPick={onPick} />
          ) : null}
          {folderFailed ? (
            <p className="px-2 py-2 text-xs text-text-muted">This folder’s files could not be loaded just now.</p>
          ) : null}
          {nothing && !folderFailed ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-semibold text-text-primary">No PDFs or pictures yet</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Add one to this folder’s sources, or send it to Jami and keep it from the chat.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-[var(--color-border)] px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

function SheetGroup({
  label,
  sheets,
  keptPaths,
  onPick,
}: {
  label: string;
  sheets: readonly NotebookSheet[];
  keptPaths: readonly string[];
  onPick: (sheet: NotebookSheet) => void;
}) {
  return (
    <section className="py-1">
      <h3 className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</h3>
      <ul className="space-y-0.5">
        {sheets.map((sheet) => {
          const current = keptPaths.includes(sheet.storagePath);
          return (
            <li key={sheet.storagePath}>
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition duration-fast hover:bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                  current ? "bg-[var(--color-glass-subtle)]" : ""
                }`}
                onClick={() => onPick(sheet)}
              >
                <span
                  className="grid h-9 w-8 shrink-0 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-glass-medium)] text-2xs font-bold tracking-tight text-text-secondary"
                  aria-hidden="true"
                >
                  {sheet.fileType === "application/pdf" ? "PDF" : "IMG"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">{sheet.title}</span>
                  <span className="block text-2xs text-text-muted">
                    {sheet.fileType === "application/pdf" ? "PDF" : "Picture"}
                    {current ? " · Beside your page now" : ""}
                  </span>
                </span>
                {current ? (
                  <span className="shrink-0 text-accent">
                    <NotebookIcon name="check" />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
