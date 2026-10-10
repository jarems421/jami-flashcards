/**
 * The render plan: which tiles of a page to draw, in which order, at what
 * resolution, and which to let go of. Pure and DOM-free, so every decision the
 * renderer in `lib/ink-dom/` makes about tiles is tested in Node.
 *
 * Three coordinate spaces meet here:
 *
 * - page units, the 900 x 1240 space ink is stored in;
 * - sheet CSS pixels, the page laid out at the settled zoom (`scale` CSS
 *   pixels per page unit), with the sheet's top-left corner at 0, 0;
 * - sheet device pixels, sheet CSS pixels times the device pixel ratio.
 *
 * A level is one settled zoom on one screen. Its tiles are square, a fixed
 * number of device pixels on a side (256 CSS pixels at the screen's density),
 * and start at whole multiples of that size, so every tile's corner sits on a
 * whole device pixel of the sheet. Zooming changes what a tile covers on the
 * page, never the size of its canvas, which is why tile canvases can be pooled
 * and re-targeted rather than resized.
 */

import type { InkBox } from "@/lib/ink/model";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

/** A tile's side in CSS pixels at the screen's own density. */
export const INK_TILE_CSS_PX = 256;
/** No canvas the renderer makes may hold more pixels than this (4 MP). */
export const INK_CANVAS_MAX_PIXELS = 4_000_000;
/**
 * All the renderer's canvases together stay within this many bytes of
 * backing store (4 bytes a pixel). Decimal megabytes, the stricter reading.
 */
export const INK_CANVAS_BUDGET_BYTES = 96_000_000;
/** Tiles drawn ahead of need, as rings of tiles around what is on screen. */
export const INK_PREFETCH_RING_TILES = 1;
/**
 * Antialiasing paints up to a device pixel past the geometry, so tile queries
 * and change boxes reach that far too.
 */
export const INK_ANTIALIAS_DEVICE_PX = 1;

const BYTES_PER_PIXEL = 4;
const MIN_TILE_DEVICE_PX = 64;
/** Every canvas the renderer makes is a tile, so a tile is held under the 4 MP cap. */
const MAX_TILE_DEVICE_PX = Math.floor(Math.sqrt(INK_CANVAS_MAX_PIXELS));

/** A rectangle in sheet CSS pixels. */
export type InkSheetRect = { left: number; top: number; width: number; height: number };

/** A rectangle in sheet device pixels, all whole numbers. */
export type InkDeviceRect = { x: number; y: number; width: number; height: number };

export type InkRenderLevel = {
  /** Equal for two levels exactly when their tiles are the same pixels. */
  key: string;
  /** CSS pixels per page unit. */
  scale: number;
  devicePixelRatio: number;
  /** Device pixels per page unit: `scale * devicePixelRatio`. */
  unitPx: number;
  /** A tile's side in device pixels. */
  tilePx: number;
  columns: number;
  rows: number;
};

export type InkTile = { col: number; row: number; key: string };

export function inkTileKey(col: number, row: number): string {
  return `${col}:${row}`;
}

function tile(col: number, row: number): InkTile {
  return { col, row, key: inkTileKey(col, row) };
}

/**
 * The order tiles are listed in everywhere (`inkTilesForBox`,
 * `inkTilesForDeviceRect`): a row at a time, left to right. It is also the
 * order tile canvases stack in on screen where live ink and the lift meet:
 * canvases that abut are composited with a faint overlap at their seam, so the
 * order they sit in changes a seam pixel by a level in 255 (see
 * `lib/ink-dom/live-layer.ts`).
 */
export function compareInkTiles(a: InkTile, b: InkTile): number {
  return a.row - b.row || a.col - b.col;
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** The size of the page being drawn, in page units. */
export type InkPageSize = { width: number; height: number };

/** The notebook page: 900 x 1240. Exam working pages are 900 wide with other heights. */
export const INK_DEFAULT_PAGE: InkPageSize = {
  width: NOTEBOOK_PAGE_COORDINATE_WIDTH,
  height: NOTEBOOK_PAGE_COORDINATE_HEIGHT,
};

/**
 * The level for a settled zoom on a screen, or null when a number makes no
 * sense (zero, negative or not finite), in which case nothing is drawn. The
 * page only sets how many tiles there are, never what a tile holds, so the
 * same zoom on pages of different sizes is the same pixels (the same `key`).
 */
export function inkRenderLevel(
  scale: number,
  devicePixelRatio: number,
  page: InkPageSize = INK_DEFAULT_PAGE
): InkRenderLevel | null {
  if (!positive(scale) || !positive(devicePixelRatio) || !positive(page.width) || !positive(page.height)) return null;
  const unitPx = scale * devicePixelRatio;
  const tilePx = Math.min(
    MAX_TILE_DEVICE_PX,
    Math.max(MIN_TILE_DEVICE_PX, Math.round(INK_TILE_CSS_PX * devicePixelRatio))
  );
  return {
    key: `${scale}@${devicePixelRatio}`,
    scale,
    devicePixelRatio,
    unitPx,
    tilePx,
    columns: Math.max(1, Math.ceil((page.width * unitPx) / tilePx)),
    rows: Math.max(1, Math.ceil((page.height * unitPx) / tilePx)),
  };
}

/** Where a tile sits in sheet device pixels. */
export function inkTileDeviceRect(level: InkRenderLevel, col: number, row: number): InkDeviceRect {
  return { x: col * level.tilePx, y: row * level.tilePx, width: level.tilePx, height: level.tilePx };
}

/**
 * What a tile covers on the page, grown by the antialiasing reach, so an item
 * whose box only comes within a pixel of the tile is still drawn into it.
 */
export function inkTilePageBox(level: InkRenderLevel, col: number, row: number): InkBox {
  const reach = INK_ANTIALIAS_DEVICE_PX / level.unitPx;
  const size = level.tilePx / level.unitPx;
  return {
    minX: col * size - reach,
    minY: row * size - reach,
    maxX: (col + 1) * size + reach,
    maxY: (row + 1) * size + reach,
  };
}

type TileRange = { c0: number; c1: number; r0: number; r1: number };

/** Tiles meeting a device-pixel span, clamped to the sheet; null if none do. */
function tileRange(level: InkRenderLevel, x0: number, y0: number, x1: number, y1: number): TileRange | null {
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
  const c0 = Math.max(0, Math.floor(x0 / level.tilePx));
  const r0 = Math.max(0, Math.floor(y0 / level.tilePx));
  const c1 = Math.min(level.columns - 1, Math.ceil(x1 / level.tilePx) - 1);
  const r1 = Math.min(level.rows - 1, Math.ceil(y1 / level.tilePx) - 1);
  return c1 >= c0 && r1 >= r0 ? { c0, c1, r0, r1 } : null;
}

function visibleRange(level: InkRenderLevel, visible: InkSheetRect): TileRange | null {
  const ratio = level.devicePixelRatio;
  return tileRange(
    level,
    visible.left * ratio,
    visible.top * ratio,
    (visible.left + visible.width) * ratio,
    (visible.top + visible.height) * ratio
  );
}

/** Nearest the middle of what is on screen first; ties top to bottom, then left to right. */
function centreOut(level: InkRenderLevel, visible: InkSheetRect, tiles: InkTile[]): InkTile[] {
  const ratio = level.devicePixelRatio;
  const cx = (visible.left + visible.width / 2) * ratio;
  const cy = (visible.top + visible.height / 2) * ratio;
  const half = level.tilePx / 2;
  const distance = (t: InkTile) => {
    const dx = t.col * level.tilePx + half - cx;
    const dy = t.row * level.tilePx + half - cy;
    return dx * dx + dy * dy;
  };
  return tiles
    .map((t) => ({ t, d: distance(t) }))
    .sort((a, b) => a.d - b.d || a.t.row - b.t.row || a.t.col - b.t.col)
    .map(({ t }) => t);
}

/** The tiles on screen, nearest the middle first. */
export function inkVisibleTiles(level: InkRenderLevel, visible: InkSheetRect): InkTile[] {
  const range = visibleRange(level, visible);
  if (!range) return [];
  const tiles: InkTile[] = [];
  for (let row = range.r0; row <= range.r1; row += 1) {
    for (let col = range.c0; col <= range.c1; col += 1) tiles.push(tile(col, row));
  }
  return centreOut(level, visible, tiles);
}

/**
 * The ring of tiles just off screen, drawn ahead so a pan never shows blank
 * ink, nearest the middle first. Visible tiles are not repeated.
 */
export function inkPrefetchTiles(
  level: InkRenderLevel,
  visible: InkSheetRect,
  ring = INK_PREFETCH_RING_TILES
): InkTile[] {
  const range = visibleRange(level, visible);
  if (!range || ring <= 0) return [];
  const c0 = Math.max(0, range.c0 - ring);
  const r0 = Math.max(0, range.r0 - ring);
  const c1 = Math.min(level.columns - 1, range.c1 + ring);
  const r1 = Math.min(level.rows - 1, range.r1 + ring);
  const tiles: InkTile[] = [];
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const inside = row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1;
      if (!inside) tiles.push(tile(col, row));
    }
  }
  return centreOut(level, visible, tiles);
}

/**
 * The tiles a change touches: its box (page units, already covering the
 * paint) grown by the antialiasing reach. Clamped to the sheet; ink off the
 * page has no tile.
 */
export function inkTilesForBox(level: InkRenderLevel, box: InkBox): InkTile[] {
  const reach = INK_ANTIALIAS_DEVICE_PX;
  return tilesInRange(
    tileRange(
      level,
      box.minX * level.unitPx - reach,
      box.minY * level.unitPx - reach,
      box.maxX * level.unitPx + reach,
      box.maxY * level.unitPx + reach
    )
  );
}

/** The tiles a sheet device-pixel rect meets, clamped to the sheet. */
export function inkTilesForDeviceRect(level: InkRenderLevel, rect: InkDeviceRect): InkTile[] {
  return tilesInRange(tileRange(level, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height));
}

function tilesInRange(range: TileRange | null): InkTile[] {
  if (!range) return [];
  const tiles: InkTile[] = [];
  for (let row = range.r0; row <= range.r1; row += 1) {
    for (let col = range.c0; col <= range.c1; col += 1) tiles.push(tile(col, row));
  }
  return tiles;
}

/**
 * A page box as whole sheet device pixels, grown by the antialiasing reach
 * and rounded outwards: the area drawing it can touch.
 */
export function inkBoxDeviceRect(level: InkRenderLevel, box: InkBox): InkDeviceRect | null {
  const reach = INK_ANTIALIAS_DEVICE_PX;
  const x0 = Math.floor(box.minX * level.unitPx - reach);
  const y0 = Math.floor(box.minY * level.unitPx - reach);
  const x1 = Math.ceil(box.maxX * level.unitPx + reach);
  const y1 = Math.ceil(box.maxY * level.unitPx + reach);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function inkDeviceRectUnion(a: InkDeviceRect | null, b: InkDeviceRect | null): InkDeviceRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** The overlap of two device rects, or null when they do not overlap. */
export function inkDeviceRectIntersection(a: InkDeviceRect, b: InkDeviceRect): InkDeviceRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function inkTileBytes(level: Pick<InkRenderLevel, "tilePx">): number {
  return level.tilePx * level.tilePx * BYTES_PER_PIXEL;
}

export function inkCanvasBytes(width: number, height: number): number {
  return Math.max(0, width) * Math.max(0, height) * BYTES_PER_PIXEL;
}

/** How many tile canvases fit in the budget once `reservedBytes` (the live layer) is taken. */
export function inkTileCapacity(input: {
  tilePx: number;
  reservedBytes: number;
  budgetBytes?: number;
}): number {
  const budget = input.budgetBytes ?? INK_CANVAS_BUDGET_BYTES;
  const free = budget - Math.max(0, input.reservedBytes);
  return Math.max(0, Math.floor(free / inkTileBytes(input)));
}

/**
 * A drawn tile as the LRU sees it. `canvases` is how many canvases it holds:
 * one per layer with ink there, so 0, 1 or 2.
 */
export type InkLruEntry = { key: string; lastUsed: number; pinned: boolean; canvases: number };

/**
 * The tiles to let go of so that `needed` more canvases fit within
 * `capacity`: least recently used first, never a pinned one (on screen, or
 * standing in while a new zoom level draws). When too much is pinned, every
 * unpinned tile holding a canvas goes, and the caller sees it is still over.
 */
export function inkTilesToEvict(
  entries: readonly InkLruEntry[],
  capacity: number,
  needed = 0
): string[] {
  let held = 0;
  for (const entry of entries) held += entry.canvases;
  let excess = held + needed - Math.max(0, capacity);
  if (excess <= 0) return [];
  const evict: string[] = [];
  const candidates = entries
    .filter((entry) => !entry.pinned && entry.canvases > 0)
    .sort((a, b) => a.lastUsed - b.lastUsed || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const entry of candidates) {
    if (excess <= 0) break;
    evict.push(entry.key);
    excess -= entry.canvases;
  }
  return evict;
}

/**
 * Whether a level drawn for a new zoom can replace the one on screen: every
 * tile on screen has been drawn (or found empty). Until then the old level
 * stays up, scaled, so the page is never blank.
 */
export function inkLevelReady(
  level: InkRenderLevel,
  visible: InkSheetRect,
  isDrawn: (tile: InkTile) => boolean
): boolean {
  return inkVisibleTiles(level, visible).every(isDrawn);
}

/**
 * How much an old level's tiles are scaled by to stand in for the new zoom.
 * Both are laid out from the sheet's top-left corner, so a scale about that
 * corner puts the old pixels where the new ones will be.
 */
export function inkLevelStandInScale(from: InkRenderLevel, to: InkRenderLevel): number {
  return to.scale / from.scale;
}

/**
 * The visible part of the sheet as it was laid out at another zoom: what an
 * old level must keep to stand in for the new one.
 */
export function inkVisibleAtLevel(visible: InkSheetRect, from: InkRenderLevel, to: InkRenderLevel): InkSheetRect {
  const ratio = inkLevelStandInScale(from, to);
  return {
    left: visible.left / ratio,
    top: visible.top / ratio,
    width: visible.width / ratio,
    height: visible.height / ratio,
  };
}

/**
 * The most tiles a screenful the size of `visible` can meet on this level,
 * wherever it sits: live ink keeps this many tile canvases, so moving the
 * sheet never needs another. Clamped to the sheet's own tile count.
 */
export function inkLiveTileCount(level: InkRenderLevel, visible: InkSheetRect): number {
  if (!positive(visible.width) || !positive(visible.height)) return 0;
  const across = Math.ceil((visible.width * level.devicePixelRatio) / level.tilePx) + 1;
  const down = Math.ceil((visible.height * level.devicePixelRatio) / level.tilePx) + 1;
  return Math.min(level.columns, across) * Math.min(level.rows, down);
}

/**
 * How far to move something, in CSS pixels, so a corner at `screenOrigin`
 * lands on a device pixel. A canvas whose corner falls between device pixels
 * is resampled by the browser every frame, which smears thin ink across two
 * pixels; the sheet is often centred on a half pixel.
 */
export function inkDevicePixelSnap(screenOrigin: number, devicePixelRatio: number): number {
  if (!Number.isFinite(screenOrigin) || !positive(devicePixelRatio)) return 0;
  const device = screenOrigin * devicePixelRatio;
  return (Math.round(device) - device) / devicePixelRatio;
}
