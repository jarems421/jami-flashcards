/**
 * How typed text is set on a notebook page, in page units.
 *
 * Everything else on a page -- ink, images, the boxes themselves -- is placed
 * in the page's own 900 x 1240 coordinates and scales with it. Typed text did
 * not: it was 14 CSS pixels whatever size the page was drawn at. So the same
 * box wrapped its words in one place on an iPad, another on a laptop and a
 * third on a phone, where a page is drawn at under half the size and 14px is
 * enormous by comparison; zooming in made the page bigger around text that
 * stayed the same size; and the page image Tutor reads, which was always set
 * in page units, disagreed with all of them.
 *
 * Now the text is part of the page. The type is sized from the page's width,
 * through container query units on the text layer, so a box wraps exactly the
 * same way at every zoom and on every screen -- and the snapshot uses these
 * same numbers, so what Tutor sees is what the student wrote.
 *
 * The sizes are the ones the snapshot already used, which also land within a
 * pixel or so of the old 14px on the fitted page of a laptop or a landscape
 * iPad, where most typing happens.
 */

import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  type NotebookTextBlock,
} from "@/lib/workspace/notebooks";

export const NOTEBOOK_TEXT_FONT_SIZE = 22;
export const NOTEBOOK_TEXT_LINE_HEIGHT = 32;
/** The same on every side: nothing inside the box needs room kept for it. */
export const NOTEBOOK_TEXT_PADDING = 12;

/**
 * The attribute that marks the text layer, which is also the container the
 * page units below are measured against. It spans the page exactly.
 */
export const NOTEBOOK_TEXT_LAYER_ATTRIBUTE = "data-notebook-text-layer";

/**
 * A length in page units, as CSS.
 *
 * Relative to the width of the nearest size container, which must be a layer
 * as wide as the page. Height is expressed in the same unit: the page's
 * height is a fixed multiple of its width, so a page unit is the same length
 * in both directions.
 */
export function notebookPageUnits(units: number) {
  const percent = (units / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100;
  return `${Number(percent.toFixed(4))}cqw`;
}

/** The style that makes a layer the page-sized container the units refer to. */
export const NOTEBOOK_TEXT_LAYER_STYLE = { containerType: "inline-size" } as const;

/** Type, leading and padding for a box's text, identical when read and typed. */
export const NOTEBOOK_TEXT_STYLE = {
  fontSize: notebookPageUnits(NOTEBOOK_TEXT_FONT_SIZE),
  lineHeight: notebookPageUnits(NOTEBOOK_TEXT_LINE_HEIGHT),
  padding: notebookPageUnits(NOTEBOOK_TEXT_PADDING),
} as const;

/** The box's border, which sits outside the text but inside its height. */
const TEXT_BLOCK_BORDER_PX = 2;

/**
 * The height a box's text area is given, as CSS: the stored height, less
 * the border drawn round it, so a box is exactly as tall as it says it is.
 */
export function getNotebookTextBlockBodyHeight(block: Pick<NotebookTextBlock, "height">) {
  return `calc(${notebookPageUnits(block.height)} - ${TEXT_BLOCK_BORDER_PX}px)`;
}

/** Marks the element holding a box's text while it is being read. */
export const NOTEBOOK_TEXT_BODY_ATTRIBUTE = "data-notebook-text-body";

/**
 * How tall the text in a box is, border included, in page units -- the
 * shortest the box can be made without hiding any of it. Null if the page
 * has not been laid out.
 *
 * Measured from the text alone, never from the box: a box taller than its
 * text reports its own height, which would make every box its own minimum.
 */
export function measureNotebookTextBlockContentHeight(
  box: HTMLElement
): number | null {
  const layer = box.closest(`[${NOTEBOOK_TEXT_LAYER_ATTRIBUTE}]`);
  const pageWidthPx = layer instanceof HTMLElement ? layer.clientWidth : 0;
  if (!(pageWidthPx > 0)) return null;

  let contentPx: number;
  const editor = box.querySelector<HTMLTextAreaElement>(
    "[data-notebook-text-editor]"
  );
  if (editor) {
    // Collapsed for the measurement and put straight back, before any paint.
    const height = editor.style.height;
    editor.style.height = "0px";
    contentPx = editor.scrollHeight;
    editor.style.height = height;
  } else {
    const body = box.querySelector<HTMLElement>(`[${NOTEBOOK_TEXT_BODY_ATTRIBUTE}]`);
    const holder = body?.parentElement;
    if (!body || !holder) return null;
    const style = window.getComputedStyle(holder);
    contentPx =
      body.offsetHeight +
      (Number.parseFloat(style.paddingTop) || 0) +
      (Number.parseFloat(style.paddingBottom) || 0);
  }

  return (
    ((contentPx + TEXT_BLOCK_BORDER_PX) / pageWidthPx) *
    NOTEBOOK_PAGE_COORDINATE_WIDTH
  );
}

/**
 * How tall a box needs to be to show everything typed in it, or null if it
 * already is.
 *
 * Measured from the text area on screen and converted back into page units,
 * so the stored height is the same whichever device did the typing. A box
 * only ever grows here -- shrinking one under a student's cursor as they
 * delete would move everything they are looking at -- and never past the
 * foot of the page: moving the box up to make room would pull the line being
 * typed out from under the caret.
 */
export function getNotebookTextBlockFitHeight(input: {
  block: Pick<NotebookTextBlock, "height" | "y">;
  /** The text area's full content height, padding included, in CSS px. */
  contentHeightPx: number;
  /** How much of it the text area currently shows, in CSS px. */
  visibleHeightPx: number;
  /** How wide the page is drawn, in CSS px, measured in the same layout. */
  pageWidthPx: number;
}): number | null {
  const { block, contentHeightPx, pageWidthPx, visibleHeightPx } = input;
  if (!(pageWidthPx > 0) || !(contentHeightPx > 0)) return null;
  /*
   * Only for text that genuinely does not fit. A text area that is taller
   * than its text reports its own height as the content height, and reading
   * that back through the rounding below would grow the box by a unit on
   * every measure, for ever.
   */
  if (contentHeightPx <= visibleHeightPx + 1) return null;

  const needed = Math.ceil(
    ((contentHeightPx + TEXT_BLOCK_BORDER_PX) / pageWidthPx) *
      NOTEBOOK_PAGE_COORDINATE_WIDTH
  );
  const room = Math.max(0, NOTEBOOK_PAGE_COORDINATE_HEIGHT - block.y);
  const next = Math.min(room, needed);
  return next > block.height ? next : null;
}
