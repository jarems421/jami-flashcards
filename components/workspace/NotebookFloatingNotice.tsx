"use client";

import type { ReactNode } from "react";
import type { NotebookToolbarDock } from "@/lib/workspace/notebook-toolbar";

/** A short line floating above the page, clear of the toolbar wherever it is docked. */
export default function NotebookFloatingNotice({
  toolbarDock,
  role,
  children,
}: {
  toolbarDock: NotebookToolbarDock;
  role?: "status";
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      className={`notebook-floating-control pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-text-secondary ${
        toolbarDock === "bottom"
          ? "bottom-[calc(var(--notebook-control-bottom-inset)+6.35rem)]"
          : "bottom-[var(--notebook-control-bottom-inset)]"
      }`}
    >
      {children}
    </div>
  );
}
