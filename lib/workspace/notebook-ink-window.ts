/**
 * How much of a zoomed page the ink canvas actually paints.
 *
 * js-draw sizes its canvases from the element it is mounted in, and clears the
 * whole backing store on every frame of a stroke. The ink layer fills the
 * sheet, and the sheet grows with zoom -- so the work per frame grows with the
 * square of the zoom, while the part of it anybody can see does not grow at
 * all. At 4x on a 2x-density screen that is around 43 million pixels cleared
 * and repainted per frame, of which roughly fifteen sixteenths is off screen.
 * It is felt as writing going slightly soft the further in you are, which is
 * exactly where the detail being written is smallest.
 *
 * So the canvas is given the visible slice of the sheet rather than all of it,
 * and js-draw's transform is offset to match. Nothing else about the page
 * changes: the sheet element, the swipe track, the pinch transform, the text
 * blocks and the imported PDF are all still laid out against the whole sheet.
 *
 * Two things keep the seams from showing.
 *
 * The window is grown past the frame by `NOTEBOOK_INK_WINDOW_OVERSCAN`, so a
 * gesture that moves the sheet has somewhere already painted to move into. It
 * is only redrawn when a gesture settles, and during one the sheet is moved by
 * the compositor with the ink layer inside it -- so ink and paper travel
 * together, and only the far edge of a very fast pan or a pinch back out can
 * outrun what has been painted. That fills in as soon as the gesture ends.
 *
 * And the window is snapped out to a grid, so a small pan usually lands inside
 * the window that is already there and costs no redraw at all.
 */

/**
 * How far past the visible frame the canvas reaches, as a fraction of the
 * frame, on each side.
 *
 * Half a frame each way makes the window twice the frame in each direction --
 * four times the area, against sixteen at 4x zoom without it. Raising it buys
 * more room to pan before anything has to be repainted, and gives back the
 * saving quadratically; lowering it is cheaper per frame and shows blank edges
 * sooner during a fast gesture.
 *
 * Set this to `Number.POSITIVE_INFINITY` to turn the whole thing off: every
 * window then covers the entire sheet, which is exactly what the ink layer did
 * before this existed. That is the one-line way back if it misbehaves.
 */
export const NOTEBOOK_INK_WINDOW_OVERSCAN = 0.5;

/**
 * The grid the window is snapped out to, in CSS pixels.
 *
 * Without it the window would be a slightly different size and position after
 * every pan, and each change resizes two canvases and forces a full repaint of
 * the page. Snapped, a pan only costs a repaint when it crosses a grid line,
 * and the overscan covers everything in between.
 *
 * Only ever snapped outwards, so quantising can enlarge the window but never
 * shrink it below what is visible.
 */
export const NOTEBOOK_INK_WINDOW_GRID = 128;

export type NotebookInkRenderWindow = {
  /** The whole sheet at the current zoom, in CSS pixels. */
  sheetWidth: number;
  sheetHeight: number;
  /** The slice being painted, in sheet coordinates. */
  left: number;
  top: number;
  width: number;
  height: number;
};

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * The slice of the sheet worth painting, given where the sheet is sitting.
 *
 * `pageX`/`pageY` are the sheet's origin inside the frame, the same numbers the
 * sheet itself is positioned with, so a sheet pushed left has a negative
 * `pageX` and the window follows it.
 *
 * Returns the whole sheet whenever it would cover the whole sheet anyway --
 * which is every fitted page, and any zoom small enough that clipping would
 * save nothing. Callers can treat that as "no window" and leave the ink layer
 * exactly as it was.
 */
export function getNotebookInkRenderWindow(input: {
  sheetWidth: number;
  sheetHeight: number;
  pageX: number;
  pageY: number;
  frameWidth: number;
  frameHeight: number;
  overscan?: number;
  grid?: number;
}): NotebookInkRenderWindow {
  const sheetWidth = Math.max(0, finite(input.sheetWidth));
  const sheetHeight = Math.max(0, finite(input.sheetHeight));
  const whole = {
    sheetWidth,
    sheetHeight,
    left: 0,
    top: 0,
    width: sheetWidth,
    height: sheetHeight,
  };

  const overscan = input.overscan ?? NOTEBOOK_INK_WINDOW_OVERSCAN;
  if (!Number.isFinite(overscan) || overscan < 0) return whole;
  if (sheetWidth <= 0 || sheetHeight <= 0) return whole;

  const grid = Math.max(1, input.grid ?? NOTEBOOK_INK_WINDOW_GRID);

  const axis = (
    sheetSize: number,
    frameSize: number,
    pageOrigin: number
  ) => {
    const frame = Math.max(0, finite(frameSize));
    if (frame <= 0) return { start: 0, size: sheetSize };

    // Where the frame falls on the sheet, then opened out by the overscan.
    const reach = frame * overscan;
    const visibleStart = -finite(pageOrigin) - reach;
    const visibleEnd = -finite(pageOrigin) + frame + reach;

    const start = Math.max(0, Math.floor(visibleStart / grid) * grid);
    const end = Math.min(sheetSize, Math.ceil(visibleEnd / grid) * grid);
    if (end <= start) {
      // The sheet is entirely outside the frame -- mid-swipe, or pushed to its
      // bound. Painting the near edge keeps something ready to come back to.
      return { start: 0, size: Math.min(sheetSize, frame) };
    }
    return { start, size: end - start };
  };

  const horizontal = axis(sheetWidth, input.frameWidth, input.pageX);
  const vertical = axis(sheetHeight, input.frameHeight, input.pageY);

  if (
    horizontal.start === 0 &&
    vertical.start === 0 &&
    horizontal.size >= sheetWidth &&
    vertical.size >= sheetHeight
  ) {
    return whole;
  }

  return {
    sheetWidth,
    sheetHeight,
    left: horizontal.start,
    top: vertical.start,
    width: horizontal.size,
    height: vertical.size,
  };
}

/** Whether a window covers the whole sheet, and so changes nothing. */
export function isWholeNotebookInkSheet(window: NotebookInkRenderWindow) {
  return (
    window.left === 0 &&
    window.top === 0 &&
    window.width >= window.sheetWidth &&
    window.height >= window.sheetHeight
  );
}

/** Whether two windows would paint the same pixels, so nothing need change. */
export function sameNotebookInkRenderWindow(
  first: NotebookInkRenderWindow | null,
  second: NotebookInkRenderWindow | null
) {
  if (first === second) return true;
  if (!first || !second) return false;
  return (
    first.sheetWidth === second.sheetWidth &&
    first.sheetHeight === second.sheetHeight &&
    first.left === second.left &&
    first.top === second.top &&
    first.width === second.width &&
    first.height === second.height
  );
}
