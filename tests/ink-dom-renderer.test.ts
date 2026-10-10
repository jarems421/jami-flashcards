// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyInkChange, inkAddChange, inkRemoveChange } from "@/lib/ink/history";
import type { InkDocument, InkItem, InkLayer, InkPaint, InkPathCommand } from "@/lib/ink/model";
import { createInkRenderer, type InkRenderer, type InkViewport } from "@/lib/ink-dom/renderer";
import { callsOf, FakePath2D, installFakeCanvas, type FakeCanvasEnvironment } from "./support/fake-canvas";

const black = { r: 17, g: 24, b: 39, a: 1 };
const yellow = { r: 253, g: 224, b: 71, a: 0.42 };
const penPaint: InkPaint = { fill: null, stroke: { color: black, width: 3, cap: "round", join: "round" }, opacity: 1 };
const highlighterPaint: InkPaint = { fill: yellow, stroke: null, opacity: 1 };

function line(id: string, layer: InkLayer, x: number, y: number, length = 40): InkItem {
  const path: InkPathCommand[] =
    layer === "pen"
      ? [
          { op: "M", x, y },
          { op: "L", x: x + length, y },
        ]
      : [
          { op: "M", x, y },
          { op: "L", x: x + length, y },
          { op: "L", x: x + length, y: y + 10 },
          { op: "L", x, y: y + 10 },
          { op: "Z" },
        ];
  return { kind: "outline", id, layer, path, paint: layer === "pen" ? penPaint : highlighterPaint };
}

function pathOf(item: InkItem): InkPathCommand[] {
  if (item.kind !== "outline") throw new Error("expected an outline");
  return item.path;
}

/** 0.6 CSS px a page unit at 2x: the whole sheet is 3 x 3 tiles of 512 device pixels. */
const FITTED: InkViewport = { scale: 0.6, devicePixelRatio: 2, visible: { left: 0, top: 0, width: 540, height: 744 } };
/** 2.5 at 2x, a screenful in the middle. */
const ZOOMED: InkViewport = { scale: 2.5, devicePixelRatio: 2, visible: { left: 500, top: 800, width: 1180, height: 820 } };

let canvas: FakeCanvasEnvironment;
let posted: Array<() => void>;
let host: HTMLDivElement;
let renderer: InkRenderer;

function pump() {
  for (let guard = 0; guard < 10_000 && posted.length > 0; guard += 1) posted.shift()!();
}

function make(options: { budgetBytes?: number } = {}) {
  renderer = createInkRenderer(host, {
    now: canvas.now,
    post: (callback) => posted.push(callback),
    pathFactory: () => new FakePath2D(),
    ...options,
  });
  return renderer;
}

/** Canvases in a dry layer group of the renderer (layer root index 0 = highlighter, 1 = pen). */
function dryCanvases(layer: InkLayer): HTMLCanvasElement[] {
  const root = host.querySelector("[data-ink-renderer]")!;
  const layerRoot = root.children[layer === "highlighter" ? 0 : 1];
  return Array.from(layerRoot.querySelectorAll("canvas"));
}

beforeEach(() => {
  canvas = installFakeCanvas();
  posted = [];
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  renderer?.destroy();
  host.remove();
  canvas.restore();
});

describe("createInkRenderer", () => {
  it("draws only tiles with ink, and highlighter tiles only where there is highlighter", () => {
    make();
    renderer.setViewport(FITTED);
    // Pen in the top-left tile; a highlighter in the top-left tile only.
    const doc: InkDocument = { version: 3, items: [line("h", "highlighter", 20, 20), line("p", "pen", 30, 30)] };
    renderer.setDocument(doc);
    pump();
    expect(renderer.idle).toBe(true);
    expect(renderer.coverage()).toEqual({ visible: 9, drawn: 9 });
    expect(dryCanvases("pen")).toHaveLength(1);
    expect(dryCanvases("highlighter")).toHaveLength(1);
    expect(renderer.stats.tileRenders).toBe(9);
    expect(renderer.stats.firstInkMs).not.toBeNull();
    expect(renderer.stats.visibleReadyMs).not.toBeNull();
    // Each tile is painted in page units through one transform: 1.2 device pixels a unit.
    const pen = dryCanvases("pen")[0];
    expect(callsOf(canvas, pen, "setTransform").at(-1)?.args).toEqual([1.2, 0, 0, 1.2, -0, -0]);
    expect(callsOf(canvas, pen, "stroke")).toHaveLength(1);
  });

  it("allocates no canvas and draws no tile while a stroke is written, and keeps its pixels at the lift", () => {
    make();
    renderer.setViewport(FITTED);
    const doc: InkDocument = { version: 3, items: [line("p", "pen", 30, 30)] };
    renderer.setDocument(doc);
    pump();
    renderer.resetStats();

    renderer.beginLive("pen");
    const path: InkPathCommand[] = [{ op: "M", x: 25, y: 35 }];
    for (let i = 1; i <= 20; i += 1) {
      path.push({ op: "L", x: 25 + i * 5, y: 35 + (i % 3) });
      renderer.drawLive(path.slice(), penPaint);
    }
    // A zoom settling mid-stroke waits for the lift, and background work is held.
    renderer.setViewport(ZOOMED);
    pump();
    expect(renderer.stats.canvasAllocations).toBe(0);
    expect(renderer.stats.tileRenders + renderer.stats.tileAppends).toBe(0);
    expect(renderer.stats.liveDraws).toBe(20);
    renderer.cancelLive();
    pump();
    expect(renderer.stats.levelSwaps).toBe(1);
  });

  it("hands the live tile to the dry layer at the lift, painting nothing again", () => {
    make();
    renderer.setViewport(FITTED);
    const doc: InkDocument = { version: 3, items: [line("p", "pen", 30, 30)] };
    renderer.setDocument(doc);
    pump();
    renderer.resetStats();

    renderer.beginLive("pen");
    const path: InkPathCommand[] = [
      { op: "M", x: 20, y: 60 },
      { op: "L", x: 120, y: 60 },
    ];
    renderer.drawLive(path, penPaint);
    const strokesBefore = dryCanvases("pen").map((element) => callsOf(canvas, element, "stroke").length);
    const item: InkItem = { kind: "outline", id: "new", layer: "pen", path, paint: penPaint };
    renderer.commitLive(applyInkChange(doc, inkAddChange(doc, [item])), inkAddChange(doc, [item]));

    expect(renderer.stats.commits).toBe(1);
    expect(renderer.stats.canvasAllocations).toBe(0);
    // The dry pen tile is now the canvas live ink painted; the old one was not painted again.
    const after = dryCanvases("pen");
    expect(after).toHaveLength(1);
    expect(callsOf(canvas, after[0], "stroke").length).toBeGreaterThan(0);
    expect(strokesBefore.every((count) => count === 1)).toBe(true);
    expect(after[0].style.visibility).toBe("");
  });

  it("paints the committed item afresh when it is not what live ink drew", () => {
    make();
    renderer.setViewport(FITTED);
    const doc: InkDocument = { version: 3, items: [line("p", "pen", 30, 30)] };
    renderer.setDocument(doc);
    pump();
    renderer.beginLive("highlighter");
    renderer.drawLive(pathOf(line("live", "highlighter", 10, 100)), highlighterPaint);
    const traced = line("traced", "highlighter", 10, 100, 41);
    const change = inkAddChange(doc, [traced]);
    renderer.commitLive(applyInkChange(doc, change), change);
    const highlighter = dryCanvases("highlighter");
    expect(highlighter).toHaveLength(1);
    expect(callsOf(canvas, highlighter[0], "fill")).toHaveLength(1);
  });

  it("redraws only the tiles a change touches", () => {
    make();
    renderer.setViewport(ZOOMED);
    // Strokes across the screen, a stroke in one corner of it.
    const items: InkItem[] = [];
    for (let row = 0; row < 8; row += 1) items.push(line(`r${row}`, "pen", 200, 330 + row * 40, 480));
    items.push(line("corner", "pen", 210, 335, 10));
    const doc: InkDocument = { version: 3, items };
    renderer.setDocument(doc);
    pump();
    const onScreen = renderer.coverage().visible;
    renderer.resetStats();
    const change = inkRemoveChange(doc, ["corner"]);
    renderer.applyChange(applyInkChange(doc, change), change);
    expect(renderer.stats.changeTiles).toBeGreaterThan(0);
    expect(renderer.stats.changeTiles).toBeLessThan(onScreen);
    expect(renderer.stats.tileRenders).toBe(renderer.stats.changeTiles);
  });

  it("keeps the old zoom on screen, scaled, until the new one is drawn, then swaps", () => {
    make();
    renderer.setViewport(FITTED);
    renderer.setDocument({ version: 3, items: [line("p", "pen", 400, 500)] });
    pump();
    renderer.setViewport(ZOOMED);
    const groups = (layer: InkLayer) =>
      Array.from(host.querySelector("[data-ink-renderer]")!.children[layer === "highlighter" ? 0 : 1].children) as HTMLElement[];
    expect(groups("pen")).toHaveLength(2);
    const [old, pending] = groups("pen");
    expect(old.style.transform).toBe(`scale(${2.5 / 0.6})`);
    expect(pending.style.visibility).toBe("hidden");
    expect(renderer.idle).toBe(false);
    pump();
    expect(renderer.stats.levelSwaps).toBe(1);
    expect(groups("pen")).toHaveLength(1);
    expect(groups("pen")[0].style.transform).toBe("");
    expect(groups("pen")[0].style.visibility).toBe("");
  });

  it("draws a dense tile over several slices, and none runs far past its budget", () => {
    make();
    renderer.setViewport(FITTED);
    const items: InkItem[] = [];
    for (let i = 0; i < 40; i += 1) items.push(line(`p${i}`, "pen", 20 + i, 20 + i * 4));
    canvas.paintCost = 1;
    renderer.setDocument({ version: 3, items });
    pump();
    expect(renderer.coverage()).toEqual({ visible: 9, drawn: 9 });
    expect(renderer.stats.slices).toBeGreaterThan(5);
    expect(renderer.stats.sliceMsMax).toBeLessThanOrEqual(4);
  });

  it("stays inside a small memory budget by evicting tiles off screen", () => {
    const tileBytes = 512 * 512 * 4;
    // Room for a screenful (24 to 30 tiles) and a little of the ring.
    make({ budgetBytes: tileBytes * 40 });
    renderer.setViewport(ZOOMED);
    const items: InkItem[] = [];
    for (let y = 0; y < 1240; y += 60) for (let x = 0; x < 900; x += 100) items.push(line(`${x}-${y}`, "pen", x, y, 90));
    renderer.setDocument({ version: 3, items });
    pump();
    // Pan across the sheet so the ring keeps reaching new tiles.
    for (let left = 0; left <= 1000; left += 250) {
      renderer.setViewport({ ...ZOOMED, visible: { ...ZOOMED.visible, left } });
      pump();
    }
    expect(renderer.stats.evictions).toBeGreaterThan(0);
    expect(renderer.stats.peakCanvasBytes).toBeLessThanOrEqual(tileBytes * 40);
    expect(renderer.stats.budgetMisses).toBe(0);
    expect(renderer.coverage().drawn).toBe(renderer.coverage().visible);
  });
  it("swaps to a new zoom even when two layers on every tile cannot sit beside the old level", () => {
    // An iPad Pro 12.9 in portrait at 2x, in the default 96 MB budget.
    make();
    const screen = { left: 0, top: 0, width: 1024, height: 1366 };
    renderer.setViewport({ scale: 1.1, devicePixelRatio: 2, visible: { left: 0, top: 0, width: 990, height: 1364 } });
    const items: InkItem[] = [];
    for (let y = 10; y < 1230; y += 40) {
      for (let x = 10; x < 890; x += 60) {
        items.push(line(`h${x}-${y}`, "highlighter", x, y, 50));
        items.push(line(`p${x}-${y}`, "pen", x, y + 15, 50));
      }
    }
    renderer.setDocument({ version: 3, items });
    pump();
    renderer.setViewport({ scale: 2.2, devicePixelRatio: 2, visible: { ...screen, left: 300, top: 700 } });
    pump();
    // 35 tiles on screen with two layers each, beside the old level's stand-ins,
    // is more than the budget holds: the new level ran short, replaced the old
    // one anyway, and then had room to finish.
    expect(renderer.stats.budgetMisses).toBeGreaterThan(0);
    expect(renderer.stats.levelSwaps).toBe(1);
    expect(renderer.idle).toBe(true);
    expect(renderer.coverage().drawn).toBe(renderer.coverage().visible);
    expect(renderer.stats.peakCanvasBytes).toBeLessThanOrEqual(96_000_000);
    // A stroke afterwards still finds canvases without making any.
    renderer.resetStats();
    renderer.beginLive("pen");
    renderer.drawLive(pathOf(line("live", "pen", 300, 400, 300)), penPaint);
    expect(renderer.stats.canvasAllocations).toBe(0);
    renderer.cancelLive();
  });

  it("holds a change made mid-stroke until the lift, then paints the stroke afresh over the changed page", () => {
    make();
    renderer.setViewport(FITTED);
    const under = line("under", "pen", 30, 60);
    const doc: InkDocument = { version: 3, items: [under] };
    renderer.setDocument(doc);
    pump();
    renderer.beginLive("pen");
    const path: InkPathCommand[] = [
      { op: "M", x: 20, y: 60 },
      { op: "L", x: 120, y: 62 },
    ];
    renderer.drawLive(path, penPaint);
    // An undo with the pen down takes the stroke under it away.
    const erase = inkRemoveChange(doc, ["under"]);
    const erased = applyInkChange(doc, erase);
    const before = dryCanvases("pen")[0];
    renderer.applyChange(erased, erase);
    expect(dryCanvases("pen")[0]).toBe(before);
    expect(callsOf(canvas, before, "clearRect")).toHaveLength(1);
    const item: InkItem = { kind: "outline", id: "new", layer: "pen", path, paint: penPaint };
    const add = inkAddChange(erased, [item]);
    renderer.commitLive(applyInkChange(erased, add), add);
    pump();
    const pen = dryCanvases("pen");
    expect(pen).toHaveLength(1);
    // Whatever canvas shows the tile, what it last drew holds the new stroke and not the erased one.
    const calls = canvas.contexts.get(pen[0])!.calls;
    const lastClear = calls.map((call) => call.op).lastIndexOf("clearRect");
    const painted = calls.slice(lastClear).filter((call) => call.op === "stroke").map((call) => (call.args[0] as FakePath2D).commands);
    expect(painted).toContainEqual([
      ["M", 20, 60],
      ["L", 120, 62],
    ]);
    expect(painted).not.toContainEqual([
      ["M", 30, 60],
      ["L", 70, 60],
    ]);
  });

  it("holds a new document until the stroke ends", () => {
    make();
    renderer.setViewport(FITTED);
    renderer.setDocument({ version: 3, items: [line("old", "pen", 30, 60)] });
    pump();
    renderer.beginLive("pen");
    renderer.drawLive(pathOf(line("live", "pen", 20, 62)), penPaint);
    const shown = dryCanvases("pen");
    renderer.setDocument({ version: 3, items: [line("next", "pen", 600, 900)] });
    expect(dryCanvases("pen")).toEqual(shown);
    renderer.cancelLive();
    pump();
    expect(renderer.stats.visibleReadyMs).not.toBeNull();
    expect(dryCanvases("pen")).toHaveLength(1);
    expect(dryCanvases("pen")[0].style.left).toBe("256px");
  });

  it("redraws a tile that comes on screen showing older ink without ever showing it half drawn", () => {
    make();
    renderer.setViewport(ZOOMED);
    // Tile (7, 4) is in the ring just right of the screen: page x 716.8 to 819.2, y 409.6 to 512.
    const items: InkItem[] = [];
    for (let i = 0; i < 30; i += 1) items.push(line(`t${i}`, "pen", 730, 420 + i * 3, 60));
    const doc: InkDocument = { version: 3, items };
    renderer.setDocument(doc);
    pump();
    const tileCanvas = () => dryCanvases("pen").find((element) => element.style.left === `${(7 * 512) / 2}px` && element.style.top === `${(4 * 512) / 2}px`);
    const old = tileCanvas();
    expect(old).toBeDefined();
    const clears = callsOf(canvas, old!, "clearRect").length;
    const erase = inkRemoveChange(doc, ["t0"]);
    renderer.applyChange(applyInkChange(doc, erase), erase);
    canvas.paintCost = 1;
    renderer.setViewport({ ...ZOOMED, visible: { ...ZOOMED.visible, left: 1000 } });
    let swappedAt = -1;
    for (let step = 0; posted.length > 0 && step < 1000; step += 1) {
      posted.shift()!();
      if (old!.isConnected) expect(callsOf(canvas, old!, "clearRect")).toHaveLength(clears);
      else if (swappedAt < 0) swappedAt = step;
    }
    expect(swappedAt).toBeGreaterThan(0);
    expect(renderer.stats.slices).toBeGreaterThan(2);
    expect(tileCanvas()).not.toBe(old);
    expect(renderer.coverage().drawn).toBe(renderer.coverage().visible);
  });
  describe("with every canvas the budget allows in use", () => {
    const tileBytes = 512 * 512 * 4;
    /** A short line in the middle of each of the 9 fitted tiles (427 page units a side). */
    const everyTile = (layer: InkLayer) => {
      const items: InkItem[] = [];
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) items.push(line(`${layer}${col}${row}`, layer, col * 427 + 150, row * 427 + 150));
      }
      return items;
    };

    it("draws a tile's pen layer before its highlighter, and retries the rest when a canvas comes back", () => {
      make({ budgetBytes: tileBytes * 9 });
      renderer.setViewport(FITTED);
      const doc: InkDocument = { version: 3, items: [...everyTile("highlighter"), ...everyTile("pen")] };
      renderer.setDocument(doc);
      pump();
      // 18 canvases wanted, 9 to be had: every tile that got any got its pen layer.
      expect(renderer.coverage().drawn).toBeLessThan(9);
      expect(dryCanvases("pen").length).toBeGreaterThan(dryCanvases("highlighter").length);
      expect(renderer.stats.budgetMisses).toBeGreaterThan(0);

      // Taking the highlighter off gives canvases back; the waiting tiles are retried.
      const erase = inkRemoveChange(doc, everyTile("highlighter").map((item) => item.id));
      renderer.applyChange(applyInkChange(doc, erase), erase);
      pump();
      expect(renderer.coverage()).toEqual({ visible: 9, drawn: 9 });
      expect(dryCanvases("pen")).toHaveLength(9);
      expect(dryCanvases("highlighter")).toHaveLength(0);
    });

    it("paints the stroke at the lift into a tile live ink had no canvas for, and allocates nothing", () => {
      make({ budgetBytes: tileBytes * 9 });
      renderer.setViewport(FITTED);
      const doc: InkDocument = { version: 3, items: everyTile("pen") };
      renderer.setDocument(doc);
      pump();
      expect(renderer.coverage()).toEqual({ visible: 9, drawn: 9 });
      renderer.resetStats();
      renderer.beginLive("pen");
      const path: InkPathCommand[] = [
        { op: "M", x: 40, y: 60 },
        { op: "L", x: 120, y: 64 },
      ];
      renderer.drawLive(path, penPaint);
      expect(renderer.stats.canvasAllocations).toBe(0);
      const item: InkItem = { kind: "outline", id: "new", layer: "pen", path, paint: penPaint };
      const add = inkAddChange(doc, [item]);
      renderer.commitLive(applyInkChange(doc, add), add);
      const corner = dryCanvases("pen").find((element) => element.style.left === "0px" && element.style.top === "0px")!;
      const painted = callsOf(canvas, corner, "stroke").map((call) => (call.args[0] as FakePath2D).commands);
      expect(painted).toContainEqual([
        ["M", 40, 60],
        ["L", 120, 64],
      ]);
      expect(renderer.stats.canvasAllocations).toBe(0);
    });
  });

  it("frees every canvas, those lent to a stroke included, when destroyed with the pen down", () => {
    make();
    renderer.setViewport(FITTED);
    renderer.setDocument({ version: 3, items: [line("p", "pen", 30, 30)] });
    pump();
    renderer.beginLive("pen");
    renderer.drawLive(pathOf(line("live", "pen", 20, 40, 300)), penPaint);
    expect(renderer.stats.canvasBytes).toBeGreaterThan(0);
    renderer.destroy();
    expect(renderer.stats.canvasBytes).toBe(0);
  });
});
