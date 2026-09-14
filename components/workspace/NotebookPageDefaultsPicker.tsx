"use client";

import type { CSSProperties } from "react";
import {
  NOTEBOOK_CREATION_PAGE_STYLES,
  type NotebookPageColor,
  type NotebookPageStyle,
} from "@/lib/workspace/notebooks";
import {
  getNotebookPaperPalette,
  NOTEBOOK_PAGE_COLORS,
} from "@/lib/workspace/notebook-paper-palette";

type NotebookPageDefaultsPickerProps = {
  pageColor: NotebookPageColor;
  pageStyle: NotebookPageStyle;
  onPageColorChange: (color: NotebookPageColor) => void;
  onPageStyleChange: (style: NotebookPageStyle) => void;
  disabled?: boolean;
};

const STYLE_LABELS: Record<NotebookPageStyle, string> = {
  plain: "Plain",
  lined: "Lined",
  grid: "Grid",
  dot: "Dot",
};

/** A little sheet of the paper itself, ruled the way the page will be. */
function paperStyle(color: NotebookPageColor, style: NotebookPageStyle): CSSProperties {
  const palette = getNotebookPaperPalette(color);
  const rule = `color-mix(in srgb, ${palette.line} 22%, transparent)`;
  const background: CSSProperties = { backgroundColor: palette.paper };
  if (style === "lined") {
    return { ...background, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 7px, ${rule} 7px 8px)` };
  }
  if (style === "grid") {
    return {
      ...background,
      backgroundImage: `linear-gradient(to right, ${rule} 1px, transparent 1px), linear-gradient(to bottom, ${rule} 1px, transparent 1px)`,
      backgroundSize: "8px 8px",
    };
  }
  if (style === "dot") {
    return { ...background, backgroundImage: `radial-gradient(${rule} 1px, transparent 1px)`, backgroundSize: "8px 8px" };
  }
  return background;
}

const tileClass = (selected: boolean) =>
  `flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-2.5 text-xs font-medium transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-60 ${
    selected
      ? "border-accent/60 bg-accent/10 text-text-primary shadow-e1"
      : "border-[var(--color-border)] bg-[var(--color-surface-panel)] text-text-secondary hover:border-[var(--color-border-strong)]"
  }`;

/**
 * The paper a new notebook's pages start on, chosen by looking at it.
 *
 * These were rows of text buttons reading "white", "cream", "plain" and
 * "grid" -- a choice about how paper looks, made without seeing any. Each tile
 * is now a small sheet in that colour, ruled the way the page will be.
 */
export default function NotebookPageDefaultsPicker({
  pageColor,
  pageStyle,
  onPageColorChange,
  onPageStyleChange,
  disabled = false,
}: NotebookPageDefaultsPickerProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-sm font-medium text-text-secondary">Page colour</legend>
        <div className="flex gap-2">
          {NOTEBOOK_PAGE_COLORS.map((color) => {
            const palette = getNotebookPaperPalette(color);
            const selected = pageColor === color;
            return (
              <button
                key={color}
                type="button"
                aria-pressed={selected}
                onClick={() => onPageColorChange(color)}
                className={tileClass(selected)}
              >
                <span
                  aria-hidden="true"
                  className="h-7 w-6 rounded-sm border border-black/15 shadow-sm"
                  style={{ backgroundColor: palette.paper }}
                />
                {palette.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-sm font-medium text-text-secondary">Page style</legend>
        <div className="flex gap-2">
          {NOTEBOOK_CREATION_PAGE_STYLES.map((style) => {
            const selected = pageStyle === style;
            return (
              <button
                key={style}
                type="button"
                aria-pressed={selected}
                onClick={() => onPageStyleChange(style)}
                className={tileClass(selected)}
              >
                <span
                  aria-hidden="true"
                  className="h-7 w-6 rounded-sm border border-black/15 shadow-sm"
                  style={paperStyle(pageColor, style)}
                />
                {STYLE_LABELS[style]}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
