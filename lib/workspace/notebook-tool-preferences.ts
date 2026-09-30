/**
 * The pen, highlighter and eraser as they were last set, on this device.
 *
 * Every other note app hands back the pen you put down. Jami handed back a
 * black pen at half thickness every time a notebook or a practice sheet
 * opened, and the practice sheet kept a separate pen of its own -- so a
 * student who writes in blue at a fine nib set it up again on every page they
 * opened, and set it up twice if they went between the two.
 *
 * One store for both surfaces, because it is one pen. The feel settings
 * (smoothing, pressure and the rest) already work this way, in
 * `notebook-pen-feel.ts`; this is the rest of what is in the hand.
 *
 * The active tool is deliberately not remembered. Opening a page with the
 * eraser already in hand is how work gets lost, and the pen is what anyone
 * reaching for a page means to pick up.
 */

import type {
  NotebookEraserMode,
  NotebookEraserSize,
} from "@/lib/workspace/notebook-eraser";
import {
  NOTEBOOK_DEFAULT_THICKNESS_PERCENT,
  clampNotebookThicknessPercent,
} from "@/lib/workspace/notebook-inking";
import {
  isNotebookCustomStrokeColor,
  isNotebookHighlighterColor,
  isNotebookPenColor,
  type NotebookStrokeColor,
} from "@/lib/workspace/notebooks";

export const NOTEBOOK_TOOL_PREFERENCES_STORAGE_KEY = "jami:notebook-tools";

export type NotebookToolPreferences = {
  penColor: NotebookStrokeColor;
  penThicknessPercent: number;
  highlighterColor: NotebookStrokeColor;
  highlighterThicknessPercent: number;
  eraserMode: NotebookEraserMode;
  eraserSize: NotebookEraserSize;
};

export const NOTEBOOK_TOOL_PREFERENCES_DEFAULT: NotebookToolPreferences = {
  penColor: "black",
  penThicknessPercent: NOTEBOOK_DEFAULT_THICKNESS_PERCENT,
  highlighterColor: "yellow",
  highlighterThicknessPercent: NOTEBOOK_DEFAULT_THICKNESS_PERCENT,
  eraserMode: "precision",
  eraserSize: "medium",
};

function isEraserMode(value: unknown): value is NotebookEraserMode {
  return value === "stroke" || value === "precision";
}

function isEraserSize(value: unknown): value is NotebookEraserSize {
  return value === "small" || value === "medium" || value === "large";
}

/**
 * A colour the picker could have produced, or the fallback.
 *
 * Each tool keeps to its own swatches plus custom colours: a highlighter
 * restored as black would paint an opaque bar over the page.
 */
function toolColor(
  value: unknown,
  isSwatch: (value: unknown) => boolean,
  fallback: NotebookStrokeColor
): NotebookStrokeColor {
  if (isSwatch(value)) return value as NotebookStrokeColor;
  if (isNotebookCustomStrokeColor(value)) {
    return value.toLowerCase() as NotebookStrokeColor;
  }
  return fallback;
}

/**
 * Every field forced back into range, one at a time.
 *
 * Field by field rather than all-or-nothing, so one value storage has mangled
 * costs that value and not the whole pen.
 */
export function clampNotebookToolPreferences(
  value: unknown
): NotebookToolPreferences {
  const stored =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<keyof NotebookToolPreferences, unknown>>)
      : {};
  const fallback = NOTEBOOK_TOOL_PREFERENCES_DEFAULT;

  return {
    penColor: toolColor(stored.penColor, isNotebookPenColor, fallback.penColor),
    penThicknessPercent:
      stored.penThicknessPercent === undefined
        ? fallback.penThicknessPercent
        : clampNotebookThicknessPercent(stored.penThicknessPercent),
    highlighterColor: toolColor(
      stored.highlighterColor,
      isNotebookHighlighterColor,
      fallback.highlighterColor
    ),
    highlighterThicknessPercent:
      stored.highlighterThicknessPercent === undefined
        ? fallback.highlighterThicknessPercent
        : clampNotebookThicknessPercent(stored.highlighterThicknessPercent),
    eraserMode: isEraserMode(stored.eraserMode)
      ? stored.eraserMode
      : fallback.eraserMode,
    eraserSize: isEraserSize(stored.eraserSize)
      ? stored.eraserSize
      : fallback.eraserSize,
  };
}

export function readNotebookToolPreferences(): NotebookToolPreferences {
  if (typeof window === "undefined") return NOTEBOOK_TOOL_PREFERENCES_DEFAULT;

  try {
    const stored = window.localStorage.getItem(
      NOTEBOOK_TOOL_PREFERENCES_STORAGE_KEY
    );
    if (stored === null) return NOTEBOOK_TOOL_PREFERENCES_DEFAULT;
    return clampNotebookToolPreferences(JSON.parse(stored));
  } catch {
    // Storage can be unavailable, and the stored value can be anything at all.
    return NOTEBOOK_TOOL_PREFERENCES_DEFAULT;
  }
}

/**
 * Keeps whatever just changed, leaving the rest as it was stored.
 *
 * Merged against storage rather than against the caller's state, so the
 * notebook and a practice sheet open in two tabs cannot put back each other's
 * older values for tools the other one never touched.
 */
export function saveNotebookToolPreferences(
  update: Partial<NotebookToolPreferences>
) {
  try {
    const next = clampNotebookToolPreferences({
      ...readNotebookToolPreferences(),
      ...update,
    });
    window.localStorage.setItem(
      NOTEBOOK_TOOL_PREFERENCES_STORAGE_KEY,
      JSON.stringify(next)
    );
  } catch {
    // These are non-critical, device-local preferences.
  }
}
