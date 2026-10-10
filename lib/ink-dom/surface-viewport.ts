import type { InkBox, InkPoint } from "@/lib/ink/model";
import type { InkSheetRect } from "@/lib/ink/render-plan";
import type { InkViewport } from "@/lib/ink-dom/renderer";
import type { InkScreenMapping } from "@/lib/ink-dom/stroke-session";

/**
 * Where the sheet is on screen, turned into what the engine needs: the
 * renderer's viewport (zoom, density, the part of the sheet showing) and the
 * mapping a stroke or an erase is drawn through.
 *
 * Pure, so the editor's one layout read per settled gesture is the only thing
 * about it that touches the DOM.
 */

/** A measured rectangle, as `getBoundingClientRect()` returns it. */
export type InkHostRect = { left: number; top: number; width: number; height: number };

/**
 * Where the sheet sits in the frame that shows it: the sheet's origin inside the
 * frame, which is negative once the sheet is pushed left or up, and the frame's
 * size. The same numbers `getNotebookInkRenderWindow` takes.
 */
export type InkSheetFrame = { pageX: number; pageY: number; frameWidth: number; frameHeight: number };

export type InkSurfaceViewport = { viewport: InkViewport; mapping: InkScreenMapping };

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The part of the sheet that can be seen, in sheet CSS pixels: the sheet and
 * the region meet. A sheet wholly outside the region (mid-swipe, or pushed to
 * its bound) answers with the sheet's near corner, the size of the region, so
 * something stays ready to come back to, as the canvas window does.
 */
function meet(sheet: InkSheetRect, region: InkSheetRect): InkSheetRect {
  const left = Math.max(sheet.left, region.left);
  const top = Math.max(sheet.top, region.top);
  const right = Math.min(sheet.left + sheet.width, region.left + region.width);
  const bottom = Math.min(sheet.top + sheet.height, region.top + region.height);
  if (right > left && bottom > top) return { left, top, width: right - left, height: bottom - top };
  return {
    left: sheet.left,
    top: sheet.top,
    width: Math.min(sheet.width, region.width),
    height: Math.min(sheet.height, region.height),
  };
}

/**
 * The viewport and stroke mapping for a sheet measured at `rect`, or null when
 * nothing is laid out yet (a hidden or zero-sized host) and so nothing can be
 * drawn or aimed.
 *
 * The visible part is the sheet within `frame` when it is given: the frame
 * lies at `(-pageX, -pageY)` in sheet coordinates, because `pageX`/`pageY` are
 * where the sheet starts inside the frame. Without one it is the sheet within
 * `window`, the slice the page asked to have painted, and without that the
 * whole sheet.
 */
export function inkSurfaceViewport(input: {
  rect: InkHostRect;
  page: { width: number; height: number };
  devicePixelRatio: number;
  frame?: InkSheetFrame | null;
  window?: InkSheetRect | null;
}): InkSurfaceViewport | null {
  const { rect, page } = input;
  if (!positive(rect.width) || !positive(rect.height) || !positive(page.width) || !positive(page.height)) {
    return null;
  }
  const left = finite(rect.left);
  const top = finite(rect.top);
  const scale = rect.width / page.width;
  const sheet: InkSheetRect = { left: 0, top: 0, width: rect.width, height: rect.height };

  const frame = input.frame;
  let visible = sheet;
  if (frame && positive(frame.frameWidth) && positive(frame.frameHeight)) {
    visible = meet(sheet, {
      left: -finite(frame.pageX),
      top: -finite(frame.pageY),
      width: frame.frameWidth,
      height: frame.frameHeight,
    });
  } else if (input.window && positive(input.window.width) && positive(input.window.height)) {
    visible = meet(sheet, input.window);
  }

  return {
    viewport: {
      scale,
      devicePixelRatio: positive(input.devicePixelRatio) ? input.devicePixelRatio : 1,
      visible,
      screenOrigin: { x: left, y: top },
    },
    mapping: { left, top, scale },
  };
}

/** A pointer's position on the page, in page units. */
export function inkClientToPage(mapping: InkScreenMapping, clientX: number, clientY: number): InkPoint {
  return { x: (clientX - mapping.left) / mapping.scale, y: (clientY - mapping.top) / mapping.scale };
}

/**
 * A scribble found on screen, brought onto the page: only its hull crosses
 * over (a couple of dozen points rather than every sample), with the box that
 * holds it. `majorExtent` stays in screen pixels, as the scribble detector
 * reports it and `planInkScribbleErase` expects it. Null for an empty hull.
 */
export function inkScribbleInPageUnits(
  scribble: { band: { hull: readonly InkPoint[] }; majorExtent: number },
  mapping: InkScreenMapping
): { band: { hull: InkPoint[]; bounds: InkBox }; majorExtent: number } | null {
  const hull = scribble.band.hull.map((point) => inkClientToPage(mapping, point.x, point.y));
  if (hull.length === 0) return null;
  const bounds: InkBox = { minX: hull[0].x, minY: hull[0].y, maxX: hull[0].x, maxY: hull[0].y };
  for (const point of hull) {
    if (point.x < bounds.minX) bounds.minX = point.x;
    if (point.y < bounds.minY) bounds.minY = point.y;
    if (point.x > bounds.maxX) bounds.maxX = point.x;
    if (point.y > bounds.maxY) bounds.maxY = point.y;
  }
  return { band: { hull, bounds }, majorExtent: scribble.majorExtent };
}
