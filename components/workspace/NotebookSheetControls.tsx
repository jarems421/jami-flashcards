"use client";

import type { ReactNode } from "react";
import type { SheetZoom } from "@/hooks/useSheetZoom";

/**
 * The bar along the bottom of a sheet kept beside the page: its zoom, and for
 * a PDF of several pages, which page is showing.
 */
export function SheetControlsBar({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-2">
      <div className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-0.5 shadow-e1 [scrollbar-width:none]">
        {children}
      </div>
    </div>
  );
}

export function SheetBarDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-[var(--color-border)]" />;
}

export function SheetBarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-secondary transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-35 disabled:hover:bg-transparent"
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {children}
      </svg>
    </button>
  );
}

/** Zoom out, the size (which fits the sheet back to the panel), and zoom in. */
export function SheetZoomControls({ zoom }: { zoom: SheetZoom }) {
  return (
    <>
      <SheetBarButton label="Zoom out" disabled={!zoom.canZoomOut} onClick={zoom.zoomOut}>
        <path d="M5 10h10" />
      </SheetBarButton>
      <button
        type="button"
        aria-label={zoom.canZoomOut ? "Fit the sheet to the panel" : "Zoom: fitted to the panel"}
        title="Fit to the panel"
        disabled={!zoom.canZoomOut}
        className="min-w-[3rem] shrink-0 rounded-full px-1 text-center text-2xs font-semibold tabular-nums text-text-secondary transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:hover:bg-transparent"
        onClick={zoom.fit}
      >
        <span aria-live="polite">{Math.round(zoom.level * 100)}%</span>
      </button>
      <SheetBarButton label="Zoom in" disabled={!zoom.canZoomIn} onClick={zoom.zoomIn}>
        <path d="M5 10h10M10 5v10" />
      </SheetBarButton>
    </>
  );
}
