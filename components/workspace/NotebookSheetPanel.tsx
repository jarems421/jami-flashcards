"use client";

import {
  FLOATING_ICON_BUTTON_CLASS,
  FloatingLayer,
  FloatingTutorResizeFrame,
  OPAQUE_PANEL_STYLE,
  floatingRectStyle,
  type FloatingFrame,
} from "@/components/ai/JamiFloatingTutor";
import { SheetControlsBar, SheetZoomControls } from "@/components/workspace/NotebookSheetControls";
import NotebookSheetPdf from "@/components/workspace/NotebookSheetPdf";
import { NotebookIcon } from "@/components/workspace/NotebookToolbarIconButton";
import { useFloatingPanel } from "@/hooks/useFloatingPanel";
import { useNotebookSheetImageUrl } from "@/hooks/useNotebookSheet";
import { useSheetZoom } from "@/hooks/useSheetZoom";
import type { NotebookSheet } from "@/lib/workspace/notebook-sheet";

/*
 * Tall and narrow, like a page held beside another, and bottom-left so the
 * first starts clear of the Tutor card in the bottom-right. Each later one is
 * placed clear of whatever is already on screen.
 */
const SHEET_SIZE = { width: 380, height: 620 };
const SHEET_LIMITS = { minWidth: 240, minHeight: 200, margin: 12 };
/** Below this the full-size button steps back; the edges still resize it. */
const ROOMY_SHEET_WIDTH = 300;

/**
 * One frame per sheet slot, each remembering its own place on this device.
 * Fixed in number because hooks cannot be called in a loop.
 */
export function useNotebookSheetFrames(open: boolean, occupiedSlots: readonly boolean[]): FloatingFrame[] {
  const frame = (slot: number) => ({
    storageKey: slot === 0 ? "jami:notebook-sheet-panel:v1" : `jami:notebook-sheet-panel:v1:${slot + 1}`,
    enabled: open && Boolean(occupiedSlots[slot]),
    preferredSize: SHEET_SIZE,
    limits: SHEET_LIMITS,
    side: "left" as const,
  });
  const sheet0 = useFloatingPanel(frame(0));
  const sheet1 = useFloatingPanel(frame(1));
  const sheet2 = useFloatingPanel(frame(2));
  return [sheet0, sheet1, sheet2];
}

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
 * page turn. Each file is one sheet: a PDF of several pages is swiped through
 * a page at a time inside it. The arrow by its title switches it for another
 * file. Hiding puts every sheet away, one tap from the toolbar; closing lets
 * this one go.
 */
export default function NotebookSheetPanel({
  frame,
  sheet,
  page,
  sheetCount,
  onChange,
  onPageChange,
  onAdd,
  onHide,
  onClose,
}: {
  frame: FloatingFrame;
  sheet: NotebookSheet;
  /** The PDF page the student left this sheet on, counted from 0. */
  page: number;
  /** How many sheets are beside the page, this one included. */
  sheetCount: number;
  onChange: () => void;
  onPageChange: (page: number) => void;
  /** Absent when no more sheets fit. */
  onAdd?: () => void;
  onHide: () => void;
  onClose: () => void;
}) {
  if (!frame.rect) return null;
  const roomy = frame.rect.width >= ROOMY_SHEET_WIDTH;

  return (
    <FloatingLayer>
      <aside
        aria-label={`Sheet beside page: ${sheet.title}`}
        data-floating-panel="sheet"
        className={`fixed flex flex-col overflow-hidden rounded-2xl border shadow-shell transition-[border-color,box-shadow] duration-fast ${
          frame.activeGesture ? "border-accent/70 ring-2 ring-accent/25" : "border-[var(--color-border-strong)]"
        }`}
        style={{ ...floatingRectStyle(frame.rect), ...OPAQUE_PANEL_STYLE }}
        {...frame.bodyDragProps}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b border-[var(--color-border)] py-1.5 pl-2 pr-1 active:cursor-grabbing"
          {...frame.dragHandleProps}
        >
          <span className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <NotebookIcon name="sheet" />
          </span>
          <span className="ml-1 min-w-0 leading-tight">
            <span className="block truncate text-xs font-semibold text-text-primary">{sheet.title}</span>
            <span className="block truncate text-2xs text-text-muted">{ORIGIN_LABEL[sheet.origin]}</span>
          </span>
          <button
            type="button"
            aria-label="Change this sheet"
            title="Change this sheet"
            className="inline-grid h-9 w-7 shrink-0 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            onClick={onChange}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {/* Bare header between the title and the buttons, to pick the sheet up by. */}
          <span aria-hidden="true" className="min-w-2 flex-1 self-stretch" />
          {onAdd ? (
            <button
              type="button"
              aria-label="Keep another sheet beside the page"
              title="Another sheet"
              className={FLOATING_ICON_BUTTON_CLASS}
              onClick={onAdd}
            >
              <NotebookIcon name="plus" />
            </button>
          ) : null}
          {roomy ? (
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
          ) : null}
          <button
            type="button"
            aria-label={sheetCount > 1 ? "Hide sheets" : "Hide sheet"}
            title={sheetCount > 1 ? "Hide sheets (the toolbar brings them back)" : "Hide (the toolbar brings it back)"}
            className={FLOATING_ICON_BUTTON_CLASS}
            onClick={onHide}
          >
            <NotebookIcon name="minus" />
          </button>
          <button
            type="button"
            aria-label="Close this sheet"
            title="Close this sheet"
            className={FLOATING_ICON_BUTTON_CLASS}
            onClick={onClose}
          >
            <NotebookIcon name="close" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface-base)]">
          <SheetBody sheet={sheet} page={page} onChange={onChange} onPageChange={onPageChange} />
        </div>
      </aside>
      <FloatingTutorResizeFrame frame={frame} />
    </FloatingLayer>
  );
}

function SheetBody({
  sheet,
  page,
  onChange,
  onPageChange,
}: {
  sheet: NotebookSheet;
  page: number;
  onChange: () => void;
  onPageChange: (page: number) => void;
}) {
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
      <NotebookSheetPdf
        key={sheet.storagePath}
        storagePath={sheet.storagePath}
        title={sheet.title}
        fallback={unavailable}
        initialPage={page}
        onPageChange={onPageChange}
      />
    );
  }
  if (image.failed) return unavailable;
  return image.url ? (
    <PictureSheet key={sheet.storagePath} url={image.url} title={sheet.title} />
  ) : (
    <div role="status" className="grid min-h-[10rem] place-items-center text-sm font-semibold text-text-muted">
      Loading…
    </div>
  );
}

/** A picture kept beside the page, fitted to the panel's width and zoomed like a PDF sheet. */
function PictureSheet({ url, title }: { url: string; title: string }) {
  const { setHost, setScroller, zoom } = useSheetZoom();
  return (
    <div ref={setHost} className="relative flex min-h-0 flex-1 flex-col">
      <div ref={setScroller} className="min-h-0 flex-1 overflow-auto overscroll-contain p-2 pb-12">
        <div style={{ width: `${zoom.level * 100}%`, ...zoom.contentStyle }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL for the student's own file */}
          <img src={url} alt={title} className="block w-full rounded-sm bg-white shadow-card" />
        </div>
      </div>
      <SheetControlsBar>
        <SheetZoomControls zoom={zoom} />
      </SheetControlsBar>
    </div>
  );
}
