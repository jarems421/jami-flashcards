"use client";

import type { KeyboardEventHandler } from "react";
import { NotebookIcon } from "@/components/workspace/NotebookToolbarIconButton";
import { getNotebookTextBlockOptionsElementId } from "@/lib/workspace/notebook-page-content";

export type NotebookTextBlockOptionsProps = {
  blockId: string;
  open: boolean;
  outlineVisible: boolean;
  openAbove: boolean;
  alignFromLeft: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleOutline: () => void;
  onDelete: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
};

export default function NotebookTextBlockOptions({
  blockId,
  open,
  outlineVisible,
  openAbove,
  alignFromLeft,
  onOpenChange,
  onToggleOutline,
  onDelete,
  onKeyDown,
}: NotebookTextBlockOptionsProps) {
  const menuId = getNotebookTextBlockOptionsElementId(blockId, "menu");
  const triggerId = getNotebookTextBlockOptionsElementId(blockId, "trigger");

  return (
    <div
      data-text-block-options-root
      className="absolute right-1.5 top-1.5 z-30"
    >
      <button
        id={triggerId}
        type="button"
        aria-label="Text box options"
        title="Text box options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-notebook-stylus-action="true"
        data-text-block-options-trigger="true"
        className="inline-grid h-7 w-7 place-items-center rounded-[0.55rem] border border-black/15 bg-black/60 text-[#f8fafc] shadow-sm backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f8fafc] [&_svg]:h-4 [&_svg]:w-4"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
      >
        <NotebookIcon name="options" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Text box options"
          className={`absolute z-40 min-w-44 overflow-hidden rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-[0_18px_46px_rgba(0,0,0,0.28)] ${
            openAbove ? "bottom-9" : "top-9"
          } ${alignFromLeft ? "left-0" : "right-0"}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={outlineVisible}
            data-notebook-stylus-action="true"
            data-text-block-outline-toggle="true"
            className="flex w-full items-center justify-between gap-4 rounded-[0.75rem] px-3 py-2 text-left text-sm font-medium text-text-primary transition hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleOutline();
            }}
          >
            <span>Show outline</span>
            <span
              aria-hidden="true"
              className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
                outlineVisible
                  ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)]"
                  : "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)]"
              }`}
            >
              <span
                className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full shadow-sm transition-transform ${
                  outlineVisible
                    ? "translate-x-[1.05rem] bg-[var(--color-selected-text)]"
                    : "translate-x-0.5 bg-text-muted"
                }`}
              />
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-notebook-stylus-action="true"
            data-text-block-delete="true"
            className="mt-0.5 flex w-full items-center gap-2.5 rounded-[0.75rem] px-3 py-2 text-left text-sm font-semibold text-error transition hover:bg-[var(--color-error-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error [&_svg]:h-4 [&_svg]:w-4"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <NotebookIcon name="trash" />
            <span>Delete text box</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
