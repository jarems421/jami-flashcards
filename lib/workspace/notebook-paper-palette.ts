import type { NotebookPageColor } from "@/lib/workspace/notebooks";

/**
 * Everything that follows from what colour a page is, in one place.
 *
 * Fifteen places used to work this out for themselves, and every one of them
 * was written as "black, or else white" -- so a third paper colour was
 * impossible without finding all fifteen, and they had already drifted: the
 * page painted black paper #080a10 while the card preview beside it painted
 * #0b1020, which is a different black.
 *
 * A page colour decides four things, and asking one function for all four is
 * what makes adding paper a matter of adding a row here.
 */
export type NotebookPaperPalette = {
  /** The sheet itself. */
  paper: string;
  /** Ruling, gridlines and dots, before their own opacity is applied. */
  line: string;
  /** Text and the pen colour a page falls back to. */
  ink: string;
  /**
   * Whether the sheet is dark enough that ink has to be light on it.
   *
   * Callers branch on this rather than on the colour's name, so paper added
   * later is handled by everything that already reads it.
   */
  isDark: boolean;
  /** What a student sees this called. */
  label: string;
};

const PALETTES: Record<NotebookPageColor, NotebookPaperPalette> = {
  white: {
    paper: "#ffffff",
    line: "#1e293b",
    ink: "#0f172a",
    isDark: false,
    label: "White",
  },
  /*
   * Warm paper, for reading rather than for looks.
   *
   * A white sheet is the brightest thing on a dark-themed screen, and this app
   * is used for hours at a time. The tint is small on purpose: enough to take
   * the glare off, not so much that a photographed worksheet sitting on the
   * page looks wrong beside it.
   */
  cream: {
    paper: "#f7f1e3",
    line: "#3f3626",
    ink: "#2a2318",
    isDark: false,
    label: "Cream",
  },
  black: {
    paper: "#080a10",
    line: "#f8fafc",
    ink: "#f8fafc",
    isDark: true,
    label: "Black",
  },
};

/** Every paper a page can be, in the order they are offered. */
export const NOTEBOOK_PAGE_COLORS = Object.keys(PALETTES) as NotebookPageColor[];

/**
 * Takes an optional colour because plenty of callers hold one.
 *
 * A card rendering a notebook it has only partly loaded, or a page saved before
 * the field existed, has no colour to give -- and every one of those wants
 * white, which is what the page itself falls back to. Answering that here means
 * no caller has to remember it.
 */
export function getNotebookPaperPalette(
  pageColor: NotebookPageColor | undefined
): NotebookPaperPalette {
  return (pageColor && PALETTES[pageColor]) || PALETTES.white;
}

/**
 * The ruling colour with its opacity already folded in.
 *
 * Ruling is drawn at a low alpha so it sits under handwriting rather than
 * competing with it, and every surface that draws paper wants the same number.
 */
export function getNotebookRuleColor(
  pageColor: NotebookPageColor | undefined,
  opacity = 0.14
) {
  const { line } = getNotebookPaperPalette(pageColor);
  const clamped = Math.max(0, Math.min(1, opacity));
  const [r, g, b] = [1, 3, 5].map((offset) =>
    Number.parseInt(line.slice(offset, offset + 2), 16)
  );
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}
