// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InkItem, InkLayer } from "@/lib/ink/model";
import { inkRenderLevel, inkVisibleTiles } from "@/lib/ink/render-plan";
import { InkCanvasLedger } from "@/lib/ink-dom/canvas";
import { InkDrawableCache } from "@/lib/ink-dom/rasterizer";
import { emptyInkRendererStats } from "@/lib/ink-dom/stats";
import { InkLevelTiles, InkTileStore } from "@/lib/ink-dom/tile-store";
import { FakePath2D, installFakeCanvas, type FakeCanvasEnvironment } from "./support/fake-canvas";

const black = { r: 0, g: 0, b: 0, a: 1 };
const item: InkItem = {
  kind: "outline",
  id: "a",
  layer: "pen",
  path: [
    { op: "M", x: 0, y: 0 },
    { op: "L", x: 1, y: 1 },
  ],
  paint: { fill: null, stroke: { color: black, width: 2, cap: "round", join: "round" }, opacity: 1 },
};
/** Pen ink in every tile. */
const query = (layer: InkLayer): InkItem[] => (layer === "pen" ? [item] : []);

let canvas: FakeCanvasEnvironment;

beforeEach(() => {
  canvas = installFakeCanvas();
});

afterEach(() => {
  canvas.restore();
});

describe("InkTileStore", () => {
  it("evicts least recently used, unpinned tiles when the budget shrinks, keeping pinned ones", () => {
    const stats = emptyInkRendererStats();
    const store = new InkTileStore(
      new InkCanvasLedger(document, stats),
      new InkDrawableCache(() => new FakePath2D()),
      stats,
      canvas.now,
      512
    );
    const parent = { highlighter: document.createElement("div"), pen: document.createElement("div") };
    const level = new InkLevelTiles(inkRenderLevel(2.5, 2)!, parent, document);
    store.addLevel(level);
    store.setCapacity(20);
    const tiles = inkVisibleTiles(level.level, { left: 0, top: 0, width: 1180, height: 820 }).slice(0, 12);
    for (const tile of tiles) expect(store.draw(level, tile, query)).toBe("done");
    expect(store.canvasCount).toBe(12);
    const pinned = tiles.slice(10);
    level.pinned = new Set(pinned.map((tile) => tile.key));

    // The live layer grew, say: the store must come down to the new budget.
    store.setCapacity(5);
    expect(store.canvasCount).toBe(5);
    expect(stats.canvasBytes).toBe(5 * 512 * 512 * 4);
    for (const tile of pinned) expect(level.isDrawn(tile)).toBe(true);
    // The most recently drawn unpinned tiles are the ones kept.
    expect(tiles.slice(0, 7).every((tile) => !level.isDrawn(tile))).toBe(true);
    expect(tiles.slice(7, 10).every((tile) => level.isDrawn(tile))).toBe(true);
  });
});
