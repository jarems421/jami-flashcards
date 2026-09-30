"use client";

import { useRef, type ReactNode } from "react";
import ZoomableArea from "@/components/cards/ZoomableArea";
import { Button, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@/components/ui";

/**
 * A diagram as large as the screen allows, to pinch and look around.
 *
 * On a phone a small label on a busy diagram is hard to read at card size;
 * this is the closer look, with the card exactly as it was underneath.
 */
export default function DiagramZoomDialog({
  open,
  title = "Diagram",
  onClose,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} initialFocusRef={closeRef} className="fixed inset-0 flex" onDismiss={onClose}>
      <DialogBackdrop className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <DialogPanel className="relative m-auto flex h-full w-full flex-col bg-[var(--color-surface-base)] sm:h-[min(94dvh,64rem)] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-[var(--color-border)]">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
          <DialogTitle className="truncate text-sm font-semibold text-text-primary">{title}</DialogTitle>
          <Button ref={closeRef} type="button" size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </header>
        <div className="min-h-0 flex-1 p-2 sm:p-4">
          <ZoomableArea label={`${title}, zoomable`}>{children}</ZoomableArea>
        </div>
        <p className="px-4 pb-3 text-center text-xs text-text-muted">
          Pinch or scroll to zoom, drag to look around, double-tap to jump in.
        </p>
      </DialogPanel>
    </Dialog>
  );
}
