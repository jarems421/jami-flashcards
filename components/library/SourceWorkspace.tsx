"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  MAX_SOURCE_FOLDER_IDS,
  type Source,
  type SourceType,
} from "@/lib/practice/sources";
import { getSourceFileTypeLabel } from "@/lib/practice/source-files";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { Button } from "@/components/ui";
import styles from "./SourceWorkspace.module.css";

export type SourceActionIconName =
  | "arrow-left"
  | "close"
  | "filter"
  | "more"
  | "sparkles";

export const sourceTypes: Array<{ value: SourceType; label: string }> = [
  { value: "pasted_text", label: "Pasted text" },
  { value: "manual_note", label: "Text note" },
  { value: "link", label: "Link" },
  { value: "file", label: "File" },
];

export function sourceTypeLabel(type: SourceType) {
  return sourceTypes.find((item) => item.value === type)?.label ?? "Source";
}

export function sourceDisplayLabel(source: Source) {
  return source.type === "file"
    ? getSourceFileTypeLabel(source.fileType)
    : sourceTypeLabel(source.type);
}

export function SourceTypeIcon({
  type,
  className = "",
}: {
  type: SourceType;
  className?: string;
}) {
  const paths: Record<SourceType, ReactNode> = {
    pasted_text: (
      <>
        <path d="M7 4h10v16H7z" />
        <path d="M10 8h4M10 12h4M10 16h3" />
      </>
    ),
    manual_note: (
      <>
        <path d="M5 19l3.5-.8L18 8.7 15.3 6 5.8 15.5z" />
        <path d="M13.8 7.5l2.7 2.7" />
      </>
    ),
    link: (
      <>
        <path d="M9.5 14.5l5-5" />
        <path d="M7.2 16.8l-1 1a3 3 0 004.2 4.2l3-3a3 3 0 000-4.2" />
        <path d="M16.8 7.2l1-1A3 3 0 0013.6 2l-3 3a3 3 0 000 4.2" />
      </>
    ),
    file: (
      <>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v5h4M10 13h5M10 17h5" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[type]}
    </svg>
  );
}

export function SourceActionIcon({
  name,
  className = "h-4 w-4",
}: {
  name: SourceActionIconName;
  className?: string;
}) {
  const paths: Record<SourceActionIconName, ReactNode> = {
    "arrow-left": <path d="m15 18-6-6 6-6" />,
    close: (
      <>
        <path d="m7 7 10 10" />
        <path d="M17 7 7 17" />
      </>
    ),
    filter: (
      <>
        <path d="M4 7h16" />
        <path d="M7 12h10" />
        <path d="M10 17h4" />
      </>
    ),
    more: (
      <>
        <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.1 3.2L16 7.5l-2.9 1.3L12 12l-1.1-3.2L8 7.5l2.9-1.3z" />
        <path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8z" />
        <path d="m6 13 .6 1.7 1.7.6-1.7.6L6 17.5l-.6-1.6-1.7-.6 1.7-.6z" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function closeDisclosureAndFocusTrigger(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return;
  const disclosure = target.closest("details");
  const trigger = disclosure?.querySelector<HTMLElement>("summary");
  disclosure?.removeAttribute("open");
  trigger?.focus();
}

export function SourceWorkspaceDrawer({
  open,
  eyebrow,
  title,
  wide = false,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  wide?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const autofocusTarget = drawerRef.current?.querySelector<HTMLElement>(
        '[data-drawer-autofocus="true"]'
      );
      (autofocusTarget ?? closeButtonRef.current)?.focus();
    });
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousBodyOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[75] flex justify-end">
      <button
        type="button"
        aria-label={`Close ${title}`}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`source-drawer-${eyebrow.toLowerCase().replaceAll(" ", "-")}`}
        className={`${styles.drawerPanel} relative flex h-[100dvh] max-h-[100dvh] w-full flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] shadow-[var(--shadow-shell)] ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            drawerRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ) ?? []
          ).filter(
            (element) =>
              !element.hasAttribute("hidden") &&
              element.getClientRects().length > 0
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-5 sm:px-7 sm:py-6">
          <div className="min-w-0">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-text-muted">
              {eyebrow}
            </div>
            <h2
              id={`source-drawer-${eyebrow.toLowerCase().replaceAll(" ", "-")}`}
              className="mt-1 truncate text-xl font-semibold text-text-primary sm:text-2xl"
            >
              {title}
            </h2>
          </div>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <SourceActionIcon name="close" className="h-5 w-5" />
          </Button>
        </header>
        <div
          className={`min-h-0 flex-1 overflow-y-auto px-5 pt-5 sm:px-7 sm:pt-6 ${
            footer
              ? "pb-5 sm:pb-6"
              : "pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          }`}
        >
          {children}
        </div>
        {footer ? (
          <footer className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-7 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pt-5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export function SourceFolderPicker({
  folders,
  selectedFolderIds,
  onChange,
}: {
  folders: StudyFolder[];
  selectedFolderIds: string[];
  onChange: (folderIds: string[]) => void;
}) {
  const selectedFolders = folders.filter((folder) =>
    selectedFolderIds.includes(folder.id)
  );
  const summary =
    selectedFolders.length === 0
      ? "No folders"
      : selectedFolders.length === 1
        ? selectedFolders[0].name
        : `${selectedFolders.length} folders`;

  return (
    <div className="block min-w-0">
      <span className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary">
        Folders
      </span>
      {folders.length === 0 ? (
        <div className="app-field flex min-h-[3.25rem] items-center rounded-[1.6rem] px-5 text-sm text-text-muted">
          No folders
        </div>
      ) : (
        <details className="group relative">
          <summary className="app-field flex min-h-[3.25rem] cursor-pointer list-none items-center justify-between gap-3 rounded-[1.6rem] px-5 text-sm text-text-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
            <span className="truncate">{summary}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="h-4 w-4 shrink-0 text-text-secondary transition group-open:rotate-180"
            >
              <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="absolute left-0 right-0 z-40 mt-2 max-h-60 overflow-y-auto rounded-[1.2rem] border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-2 shadow-[0_18px_46px_rgba(0,0,0,0.28)]">
            {folders.map((folder) => {
              const checked = selectedFolderIds.includes(folder.id);
              const selectionLimitReached =
                !checked && selectedFolderIds.length >= MAX_SOURCE_FOLDER_IDS;

              return (
                <label
                  key={folder.id}
                  className={`flex min-h-11 items-center gap-3 rounded-[0.85rem] px-3 text-sm transition ${
                    selectionLimitReached
                      ? "cursor-not-allowed text-text-muted"
                      : "cursor-pointer text-text-primary hover:bg-[var(--color-glass-subtle)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={selectionLimitReached}
                    onChange={() =>
                      onChange(
                        checked
                          ? selectedFolderIds.filter((id) => id !== folder.id)
                          : [...selectedFolderIds, folder.id]
                      )
                    }
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 truncate">{folder.name}</span>
                </label>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
