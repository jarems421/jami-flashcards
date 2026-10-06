"use client";

import {
  FLOATING_ICON_BUTTON_CLASS,
  FloatingLayer,
  FloatingTutorResizeFrame,
  OPAQUE_PANEL_STYLE,
  floatingRectStyle,
} from "@/components/ai/JamiFloatingTutor";
import SourcePdfReader from "@/components/library/SourcePdfReader";
import { NotebookIcon } from "@/components/workspace/NotebookToolbarIconButton";
import { useFloatingPanel } from "@/hooks/useFloatingPanel";
import { useNotebookSheetImageUrl } from "@/hooks/useNotebookSheet";
import type { NotebookSheet } from "@/lib/workspace/notebook-sheet";

/*
 * Tall and narrow, like a page held beside another, and bottom-left so it
 * starts clear of the Tutor card in the bottom-right.
 */
const SHEET_SIZE = { width: 380, height: 620 };
const SHEET_LIMITS = { minWidth: 220, minHeight: 200, margin: 12 };

const ORIGIN_LABEL: Record<NotebookSheet["origin"], string> = {
  notebook: "From this notebook",
  folder: "From this folder",
  chat: "Sent to Jami",
};

/**
 * A sheet kept beside the page: a question sheet, mark scheme or formula
 * sheet to work from without leaving the page being written on.
 *
 * Moved and resized like the Tutor card, read-only, and still there after a
 * page turn. Hiding it keeps it one tap away in the toolbar; closing it lets
 * it go.
 */
export default function NotebookSheetPanel({
  sheet,
  open,
  onChange,
  onHide,
  onClose,
}: {
  sheet: NotebookSheet | null;
  open: boolean;
  onChange: () => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const frame = useFloatingPanel({
    storageKey: "jami:notebook-sheet-panel:v1",
    enabled: open && sheet !== null,
    preferredSize: SHEET_SIZE,
    limits: SHEET_LIMITS,
    side: "left",
  });
  if (!sheet || !open || !frame.rect) return null;

  return (
    <FloatingLayer>
      <aside
        aria-label={`Sheet beside page: ${sheet.title}`}
        className={`fixed flex flex-col overflow-hidden rounded-2xl border shadow-shell transition-[border-color,box-shadow] duration-fast ${
          frame.activeGesture ? "border-accent/70 ring-2 ring-accent/25" : "border-[var(--color-border-strong)]"
        }`}
        style={{ ...floatingRectStyle(frame.rect), ...OPAQUE_PANEL_STYLE }}
        {...frame.bodyDragProps}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-[var(--color-border)] py-1.5 pl-3 pr-1 active:cursor-grabbing"
          {...frame.dragHandleProps}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <NotebookIcon name="sheet" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-xs font-semibold text-text-primary">{sheet.title}</span>
            <span className="block truncate text-2xs text-text-muted">{ORIGIN_LABEL[sheet.origin]}</span>
          </span>
          <button
            type="button"
            className="h-8 shrink-0 rounded-full px-2.5 text-2xs font-semibold text-text-secondary transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            onClick={onChange}
          >
            Change
          </button>
          <button
            type="button"
            aria-label={frame.maximised ? "Make sheet smaller" : "Make sheet full size"}
            title={frame.maximised ? "Smaller" : "Full size"}
            aria-pressed={frame.maximised}
            className={FLOATING_ICON_BUTTON_CLASS}
            onClick={frame.toggleMaximised}
          >
            <NotebookIcon name="expand" />
          </button>
          <button
            type="button"
            aria-label="Hide sheet"
            title="Hide (it stays in the toolbar)"
            className={FLOATING_ICON_BUTTON_CLASS}
            onClick={onHide}
          >
            <NotebookIcon name="minus" />
          </button>
          <button
            type="button"
            aria-label="Close sheet"
            title="Close sheet"
            className={FLOATING_ICON_BUTTON_CLASS}
            onClick={onClose}
          >
            <NotebookIcon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-base)]">
          <SheetBody sheet={sheet} onChange={onChange} />
        </div>
      </aside>
      <FloatingTutorResizeFrame frame={frame} />
    </FloatingLayer>
  );
}

function SheetBody({ sheet, onChange }: { sheet: NotebookSheet; onChange: () => void }) {
  const image = useNotebookSheetImageUrl(sheet);
  const unavailable = (
    <div className="grid min-h-[10rem] place-items-center px-5 py-8 text-center">
      <div>
        <p className="text-sm font-semibold text-text-primary">This sheet can’t be opened</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          It may have been deleted, or the connection dropped.
        </p>
        <button
          type="button"
          className="mt-3 rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3.5 py-1.5 text-xs font-semibold text-[var(--button-secondary-text)]"
          onClick={onChange}
        >
          Choose another
        </button>
      </div>
    </div>
  );

  if (sheet.fileType === "application/pdf") {
    return (
      <SourcePdfReader
        key={sheet.storagePath}
        storagePath={sheet.storagePath}
        title={sheet.title}
        fallback={unavailable}
        compact
      />
    );
  }
  if (image.failed) return unavailable;
  return image.url ? (
    <div className="p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL for the student's own file */}
      <img src={image.url} alt={sheet.title} className="block w-full rounded-sm bg-white shadow-card" />
    </div>
  ) : (
    <div role="status" className="grid min-h-[10rem] place-items-center text-sm font-semibold text-text-muted">
      Loading…
    </div>
  );
}
