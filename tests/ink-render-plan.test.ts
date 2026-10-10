import { describe, expect, it } from "vitest";
import {
  INK_CANVAS_BUDGET_BYTES,
  INK_CANVAS_MAX_PIXELS,
  INK_DEFAULT_PAGE,
  inkBoxDeviceRect,
  inkDevicePixelSnap,
  inkDeviceRectIntersection,
  inkDeviceRectUnion,
  inkLevelReady,
  inkLevelStandInScale,
  inkLiveTileCount,
  inkPrefetchTiles,
  inkRenderLevel,
  inkTileBytes,
  inkTileCapacity,
  inkTileDeviceRect,
  inkTilePageBox,
  inkTilesForBox,
  inkTilesForDeviceRect,
  inkTilesToEvict,
  inkVisibleAtLevel,
  inkVisibleTiles,
  type InkRenderLevel,
} from "@/lib/ink/render-plan";

function level(scale: number, ratio: number): InkRenderLevel {
  const made = inkRenderLevel(scale, ratio);
  if (!made) throw new Error("expected a level");
  return made;
}

const keys = (tiles: Array<{ key: string }>) => tiles.map((tile) => tile.key);

describe("inkRenderLevel", () => {
  it("makes 256 CSS pixel tiles at the screen's density, whatever the zoom", () => {
    expect(level(0.6, 2)).toMatchObject({ tilePx: 512, unitPx: 1.2, columns: 3, rows: 3 });
    expect(level(2.5, 2)).toMatchObject({ tilePx: 512, unitPx: 5, columns: 9, rows: 13 });
    expect(level(1, 1).tilePx).toBe(256);
    expect(level(1, 3).tilePx).toBe(768);
    expect(level(1, 1.5).tilePx).toBe(384);
  });

  it("keys a level by zoom and density, so the same pair is the same pixels", () => {
    expect(level(0.6, 2).key).toBe(level(0.6, 2).key);
    expect(level(0.6, 2).key).not.toBe(level(0.61, 2).key);
    expect(level(0.6, 2).key).not.toBe(level(0.6, 1).key);
  });

  it("refuses a zoom or density that makes no sense", () => {
    for (const [scale, ratio] of [[0, 2], [-1, 2], [1, 0], [Number.NaN, 2], [1, Number.POSITIVE_INFINITY]]) {
      expect(inkRenderLevel(scale, ratio)).toBeNull();
    }
  });

  it("never makes a tile over the 4 MP canvas cap", () => {
    const huge = level(1, 40);
    expect(huge.tilePx * huge.tilePx).toBeLessThanOrEqual(INK_CANVAS_MAX_PIXELS);
  });

  describe("page size", () => {
    it("is the 900 x 1240 notebook page by default, whether passed or not", () => {
      expect(INK_DEFAULT_PAGE).toEqual({ width: 900, height: 1240 });
      for (const [scale, ratio] of [[0.6, 2], [2.5, 2], [1, 1], [1.37, 1.5]]) {
        expect(inkRenderLevel(scale, ratio, INK_DEFAULT_PAGE)).toEqual(inkRenderLevel(scale, ratio));
      }
    });

    it("sets the rows and columns from the page it is given, and nothing about a tile", () => {
      const exam = inkRenderLevel(0.6, 2, { width: 900, height: 2000 })!;
      const notebook = level(0.6, 2);
      // 2000 units at 1.2 device pixels a unit is 2400 pixels: five tiles of 512 down.
      expect(exam).toMatchObject({ tilePx: 512, unitPx: 1.2, columns: 3, rows: 5 });
      expect(exam.key).toBe(notebook.key);
      expect(exam.tilePx).toBe(notebook.tilePx);
      expect(inkRenderLevel(2.5, 2, { width: 450, height: 120 })).toMatchObject({ columns: 5, rows: 2 });
      // A short page still has a tile.
      expect(inkRenderLevel(0.1, 1, { width: 10, height: 10 })).toMatchObject({ columns: 1, rows: 1 });
    });

    it("keeps tiles of a taller page inside the sheet", () => {
      const tall = inkRenderLevel(1, 2, { width: 900, height: 3000 })!;
      const rows = inkVisibleTiles(tall, { left: 0, top: 0, width: 900, height: 6000 }).map((tile) => tile.row);
      expect(Math.max(...rows)).toBe(tall.rows - 1);
      expect(inkTilesForBox(tall, { minX: 0, minY: 2900, maxX: 10, maxY: 3200 }).map((tile) => tile.row)).toEqual([
        tall.rows - 1,
      ]);
    });

    it("refuses a page that makes no sense", () => {
      for (const page of [
        { width: 0, height: 100 },
        { width: 100, height: -1 },
        { width: Number.NaN, height: 100 },
        { width: 100, height: Number.POSITIVE_INFINITY },
      ]) {
        expect(inkRenderLevel(1, 1, page)).toBeNull();
      }
    });
  });
});

describe("tile geometry", () => {
  it("puts every tile's corner on a whole device pixel", () => {
    const at = level(1.7, 2);
    expect(inkTileDeviceRect(at, 3, 2)).toEqual({ x: 1536, y: 1024, width: 512, height: 512 });
  });

  it("gives a tile's page box with the antialiasing pixel around it", () => {
    const at = level(2, 2);
    const box = inkTilePageBox(at, 1, 0);
    // 512 device pixels at 4 device pixels a page unit is 128 units, plus a quarter unit each side.
    expect(box).toEqual({ minX: 128 - 0.25, minY: -0.25, maxX: 256 + 0.25, maxY: 128 + 0.25 });
  });

  it("finds the tiles a change box touches, including through the antialiasing pixel", () => {
    const at = level(2, 2);
    expect(keys(inkTilesForBox(at, { minX: 10, minY: 10, maxX: 20, maxY: 20 }))).toEqual(["0:0"]);
    // Ending exactly on a tile edge still reaches the next tile's first pixel.
    expect(keys(inkTilesForBox(at, { minX: 10, minY: 10, maxX: 128, maxY: 20 }))).toEqual(["0:0", "1:0"]);
    expect(inkTilesForBox(at, { minX: -50, minY: -50, maxX: -10, maxY: -10 })).toEqual([]);
    expect(inkTilesForBox(at, { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 })).toEqual([]);
  });

  it("finds the tiles a device rect meets, clamped to the sheet", () => {
    const at = level(0.6, 2);
    expect(keys(inkTilesForDeviceRect(at, { x: 500, y: 0, width: 20, height: 10 }))).toEqual(["0:0", "1:0"]);
    expect(keys(inkTilesForDeviceRect(at, { x: -100, y: -100, width: 50, height: 50 }))).toEqual([]);
  });

  it("rounds a page box out to whole device pixels with the antialiasing reach", () => {
    expect(inkBoxDeviceRect(level(1, 2), { minX: 10.2, minY: 5, maxX: 20.1, maxY: 6 })).toEqual({
      x: 19,
      y: 9,
      width: 23,
      height: 4,
    });
    expect(inkBoxDeviceRect(level(1, 2), { minX: 1, minY: 1, maxX: Number.NaN, maxY: 2 })).toBeNull();
  });

  it("unions and intersects device rects", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 8, width: 10, height: 10 };
    expect(inkDeviceRectUnion(a, b)).toEqual({ x: 0, y: 0, width: 15, height: 18 });
    expect(inkDeviceRectUnion(null, b)).toBe(b);
    expect(inkDeviceRectIntersection(a, b)).toEqual({ x: 5, y: 8, width: 5, height: 2 });
    expect(inkDeviceRectIntersection(a, { x: 10, y: 0, width: 5, height: 5 })).toBeNull();
  });
});

describe("visible tiles and the prefetch ring", () => {
  const zoomed = level(2.5, 2);
  const screen = { left: 1000, top: 1500, width: 1180, height: 820 };

  it("lists what is on screen nearest the middle first", () => {
    const tiles = inkVisibleTiles(zoomed, screen);
    // 2000..4360 device pixels across is columns 3 to 8; 3000..4640 down is rows 5 to 9.
    expect(tiles).toHaveLength(6 * 5);
    // The middle, (3180, 3820) in device pixels, is in column 6, row 7.
    expect(tiles[0].key).toBe("6:7");
    const centre = { x: (1000 + 590) * 2, y: (1500 + 410) * 2 };
    const distance = (key: string) => {
      const [col, row] = key.split(":").map(Number);
      return Math.hypot(col * 512 + 256 - centre.x, row * 512 + 256 - centre.y);
    };
    const distances = keys(tiles).map(distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("puts a ring of one tile around it, without repeating what is on screen", () => {
    const visible = new Set(keys(inkVisibleTiles(zoomed, screen)));
    const ring = inkPrefetchTiles(zoomed, screen);
    // Columns 2 to 8 (the sheet ends at 8) and rows 4 to 10, less the 30 on screen.
    expect(ring).toHaveLength(7 * 7 - 6 * 5);
    expect(ring.some((tile) => visible.has(tile.key))).toBe(false);
    expect(inkPrefetchTiles(zoomed, screen, 0)).toEqual([]);
  });

  it("clamps both to the sheet", () => {
    const fitted = level(0.6, 2);
    const whole = { left: 0, top: 0, width: 540, height: 744 };
    expect(inkVisibleTiles(fitted, whole)).toHaveLength(9);
    expect(inkPrefetchTiles(fitted, whole)).toEqual([]);
    expect(inkVisibleTiles(fitted, { left: 2000, top: 0, width: 100, height: 100 })).toEqual([]);
  });

  it("counts the most tiles a screenful can meet, wherever it sits", () => {
    // 2360 x 1640 device pixels can meet 6 columns and 5 rows of 512.
    expect(inkLiveTileCount(zoomed, screen)).toBe(6 * 5);
    expect(inkLiveTileCount(level(0.6, 2), { left: 0, top: 0, width: 540, height: 744 })).toBe(9);
    expect(inkLiveTileCount(zoomed, { left: 0, top: 0, width: 0, height: 10 })).toBe(0);
  });
});

describe("memory", () => {
  it("fits as many tiles as the budget allows once the live layer is reserved", () => {
    expect(inkTileBytes({ tilePx: 512 })).toBe(512 * 512 * 4);
    const tile = 512 * 512 * 4;
    expect(inkTileCapacity({ tilePx: 512, reservedBytes: 0, budgetBytes: tile * 10 })).toBe(10);
    expect(inkTileCapacity({ tilePx: 512, reservedBytes: tile * 3, budgetBytes: tile * 10 })).toBe(7);
    expect(inkTileCapacity({ tilePx: 512, reservedBytes: tile * 20, budgetBytes: tile * 10 })).toBe(0);
    expect(inkTileCapacity({ tilePx: 512, reservedBytes: 0 })).toBe(Math.floor(INK_CANVAS_BUDGET_BYTES / tile));
  });

  it("evicts the least recently used unpinned tiles until the canvases needed fit", () => {
    const entries = [
      { key: "a", lastUsed: 5, pinned: false, canvases: 1 },
      { key: "b", lastUsed: 1, pinned: true, canvases: 2 },
      { key: "c", lastUsed: 2, pinned: false, canvases: 2 },
      { key: "d", lastUsed: 3, pinned: false, canvases: 1 },
      { key: "e", lastUsed: 0, pinned: false, canvases: 0 },
    ];
    expect(inkTilesToEvict(entries, 6)).toEqual([]);
    expect(inkTilesToEvict(entries, 6, 1)).toEqual(["c"]);
    expect(inkTilesToEvict(entries, 3, 1)).toEqual(["c", "d", "a"]);
    // Pinned tiles stay even when that leaves the budget short.
    expect(inkTilesToEvict(entries, 0, 1)).toEqual(["c", "d", "a"]);
  });
});

describe("zoom levels", () => {
  it("is ready to replace the old level only when every visible tile is drawn", () => {
    const at = level(0.6, 2);
    const whole = { left: 0, top: 0, width: 540, height: 744 };
    const drawn = new Set(["0:0", "1:0", "2:0", "0:1", "1:1", "2:1", "0:2", "1:2"]);
    expect(inkLevelReady(at, whole, (tile) => drawn.has(tile.key))).toBe(false);
    drawn.add("2:2");
    expect(inkLevelReady(at, whole, (tile) => drawn.has(tile.key))).toBe(true);
  });

  it("scales the old level to stand in, and maps the screen back onto it", () => {
    const from = level(0.6, 2);
    const to = level(2.4, 2);
    expect(inkLevelStandInScale(from, to)).toBeCloseTo(4, 12);
    expect(inkVisibleAtLevel({ left: 400, top: 800, width: 1180, height: 820 }, from, to)).toEqual({
      left: 100,
      top: 200,
      width: 295,
      height: 205,
    });
  });
});

describe("inkDevicePixelSnap", () => {
  it("moves a corner onto the nearest device pixel", () => {
    expect(inkDevicePixelSnap(100.5, 1)).toBeCloseTo(0.5);
    expect(Math.abs(inkDevicePixelSnap(100.25, 2))).toBeCloseTo(0.25);
    expect(inkDevicePixelSnap(64, 2)).toBe(0);
    const origin = 33.3;
    expect(Number.isInteger(Math.round((origin + inkDevicePixelSnap(origin, 1.25)) * 1.25 * 1e9) / 1e9)).toBe(true);
    expect(inkDevicePixelSnap(Number.NaN, 2)).toBe(0);
    expect(inkDevicePixelSnap(10, 0)).toBe(0);
  });
});
