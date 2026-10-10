/**
 * Performance scenes for the render gates in `docs/notebook-ink.md`. Each
 * runs in the page and returns its measurements; the spec turns on the CPU
 * throttle and checks them against the targets.
 */

import { inkAddChange, inkRemoveChange, invertInkChange, applyInkChange } from "@/lib/ink/history";
import { importJsDrawSvg } from "@/lib/ink/import-js-draw-svg";
import { inkItemBounds, type InkDocument, type InkLayer } from "@/lib/ink/model";
import { createInkRenderer } from "@/lib/ink-dom/renderer";
import { inkToSvg } from "@/lib/ink/export-svg";
import { frames, nextFrame, renderWithEngine, resetStage, whenIdle, type View } from "./stage";
import { SCALE, viewFor, type Mode } from "./fidelity";
import { handwritingPage, outlineItem, seededPageSvg, segmentCount, strokeFor, strokeSamples, writeStroke } from "./strokes";

/* ------------------------------------------------- instrumentation -- */

const layout = { reads: 0, counting: false };
let layoutWatched = false;

/** Counts calls to the browser's layout-reading APIs while `layout.counting` is on. */
function watchLayoutReads(): void {
  if (layoutWatched) return;
  layoutWatched = true;
  const count = () => {
    if (layout.counting) layout.reads += 1;
  };
  const wrapMethod = (target: object, name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    const original = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
    if (typeof original !== "function") return;
    Object.defineProperty(target, name, {
      ...descriptor,
      value(this: unknown, ...args: unknown[]) {
        count();
        return original.apply(this, args);
      },
    });
  };
  const wrapGetter = (target: object, name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    const getter = descriptor?.get;
    if (!getter) return;
    Object.defineProperty(target, name, {
      ...descriptor,
      get(this: unknown) {
        count();
        return getter.call(this);
      },
    });
  };
  wrapMethod(Element.prototype, "getBoundingClientRect");
  wrapMethod(Element.prototype, "getClientRects");
  wrapMethod(window, "getComputedStyle");
  for (const name of ["clientWidth", "clientHeight", "clientLeft", "clientTop", "scrollWidth", "scrollHeight", "scrollLeft", "scrollTop"]) {
    wrapGetter(Element.prototype, name);
  }
  for (const name of ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop", "offsetParent", "innerText"]) {
    wrapGetter(HTMLElement.prototype, name);
  }
}

/** Frame-to-frame times, from requestAnimationFrame, until stopped. */
function recordFrames(): () => number[] {
  const times: number[] = [];
  let running = true;
  const tick = (time: number) => {
    times.push(time);
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    running = false;
    return times.slice(1).map((time, index) => time - times[index]);
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const round = (value: number) => Math.round(value * 100) / 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A page of handwriting at about 3,000 segments, the size the page-open gate names. */
let handwriting: InkDocument | null = null;
function denseHandwriting(): InkDocument {
  handwriting ??= handwritingPage(3_000, 1 / SCALE.fitted);
  return handwriting;
}

/* -------------------------------------------------------------- writing -- */

export type WriteOptions = {
  mode: Mode;
  layer: InkLayer;
  width: number;
  pressure: boolean;
  /** Write over the dense page (the usual case), or on an empty one. */
  background?: "dense" | "empty";
};

export type WriteResult = {
  strokes: number;
  packets: number;
  packetMsP95: number;
  packetMsMax: number;
  drawMsP95: number;
  drawMsMax: number;
  frames: number;
  framesOver25: number;
  longestFrameMs: number;
  /** Where each frame over 25 ms fell: stroke number and frame within it. */
  longFrames: string[];
  allocationsDuringStroke: number;
  tileRendersDuringStroke: number;
  layoutReadsDuringStroke: number;
  /** The first lift on a fresh page runs cold, before the JIT has seen it. */
  firstCommitMs: number;
  /** The longest of the lifts after it. */
  commitMs: number;
  peakCanvasBytes: number;
  largestCanvasPixels: number;
};

const STROKES = 3;

/**
 * Writes three 200-sample strokes, one under another, over a page of
 * handwriting, through the real pen or highlighter geometry: two samples a
 * packet, a packet every 8 ms (a 240 Hz pencil coalesced into 120 Hz events).
 * A packet's work is the geometry and the live draw together. Counters for
 * "during the stroke" run from the first packet to the last, lift excluded.
 */
export async function measureWriting(options: WriteOptions): Promise<WriteResult> {
  watchLayoutReads();
  let doc: InkDocument = options.background === "empty" ? { version: 3, items: [] } : denseHandwriting();
  const { sheet, view } = viewFor(options.mode, doc);
  const { renderer } = await renderWithEngine(doc, sheet, view);
  const packetMs: number[] = [];
  const drawMs: number[] = [];
  const commits: number[] = [];
  const frameTimes: number[] = [];
  const longFrames: string[] = [];
  const during = { allocations: 0, tileRenders: 0, layoutReads: 0 };
  await frames(3);
  renderer.resetStats();

  for (let n = 0; n < STROKES; n += 1) {
    const spec = { x: 200, y: 280 + n * 40, length: 360, samples: 200, width: options.width, loops: 10, pressure: options.pressure };
    const [first, ...rest] = strokeSamples(spec);
    const stroke = strokeFor(options.layer, first, 1 / SCALE[options.mode]);
    const before = { allocations: renderer.stats.canvasAllocations, tiles: renderer.stats.tileRenders + renderer.stats.tileAppends };
    layout.reads = 0;
    layout.counting = true;
    const stopFrames = recordFrames();
    renderer.beginLive(options.layer);
    let last = stroke.live();
    renderer.drawLive(last.path, last.paint);
    for (let i = 0; i < rest.length; i += 2) {
      await sleep(8);
      const start = performance.now();
      stroke.add(rest[i]);
      if (rest[i + 1]) stroke.add(rest[i + 1]);
      last = stroke.live();
      const drawStart = performance.now();
      renderer.drawLive(last.path, last.paint);
      const end = performance.now();
      packetMs.push(end - start);
      drawMs.push(end - drawStart);
    }
    // The last packet draws what the lift keeps (the highlighter's traced union).
    {
      const start = performance.now();
      last = stroke.committed();
      renderer.drawLive(last.path, last.paint);
      packetMs.push(performance.now() - start);
    }
    during.allocations += renderer.stats.canvasAllocations - before.allocations;
    during.tileRenders += renderer.stats.tileRenders + renderer.stats.tileAppends - before.tiles;
    during.layoutReads += layout.reads;
    layout.counting = false;
    await nextFrame();
    const strokeFrames = stopFrames();
    strokeFrames.forEach((time, index) => {
      if (time > 25) longFrames.push(`stroke ${n + 1} frame ${index + 1} (${round(time)} ms)`);
    });
    frameTimes.push(...strokeFrames);
    const item = outlineItem(options.layer, last);
    const next: InkDocument = { version: 3, items: [...doc.items, item] };
    const commitStart = performance.now();
    renderer.commitLive(next, inkAddChange(doc, [item]));
    commits.push(performance.now() - commitStart);
    doc = next;
    await whenIdle(renderer);
  }
  return {
    strokes: STROKES,
    packets: packetMs.length,
    packetMsP95: round(percentile(packetMs, 95)),
    packetMsMax: round(Math.max(...packetMs)),
    drawMsP95: round(percentile(drawMs, 95)),
    drawMsMax: round(Math.max(...drawMs)),
    frames: frameTimes.length,
    framesOver25: frameTimes.filter((time) => time > 25).length,
    longestFrameMs: round(Math.max(0, ...frameTimes)),
    longFrames,
    allocationsDuringStroke: during.allocations,
    tileRendersDuringStroke: during.tileRenders,
    layoutReadsDuringStroke: during.layoutReads,
    firstCommitMs: round(commits[0]),
    commitMs: round(Math.max(...commits.slice(1))),
    peakCanvasBytes: renderer.stats.peakCanvasBytes,
    largestCanvasPixels: renderer.stats.largestCanvasPixels,
  };
}

/* ------------------------------------------------------------ page open -- */

export type OpenResult = {
  segments: number;
  importMs: number;
  firstInkMs: number;
  visibleReadyMs: number;
  tileRenderMsMax: number;
  sliceMsMax: number;
};

/**
 * Opens a page the way the app will: the SVG has arrived, the sheet is laid
 * out. Timed from the data arriving (before it is read) to the first tile with
 * ink, and to every tile on screen.
 */
export async function measurePageOpen(source: "handwriting" | "seeded", mode: Mode): Promise<OpenResult> {
  const svg = source === "seeded" ? seededPageSvg() : inkToSvg(denseHandwriting());
  const probe = importJsDrawSvg(svg)?.document ?? { version: 3 as const, items: [] };
  const { view } = viewFor(mode, probe);
  const stage = resetStage(view);
  const host = document.createElement("div");
  Object.assign(host.style, { position: "absolute", left: `${-view.left}px`, top: `${-view.top}px` });
  stage.appendChild(host);
  const renderer = createInkRenderer(host);
  renderer.setViewport({ scale: SCALE[mode], devicePixelRatio: window.devicePixelRatio, visible: view });
  await frames(3);

  const start = performance.now();
  const doc = importJsDrawSvg(svg)?.document ?? { version: 3 as const, items: [] };
  const importMs = performance.now() - start;
  renderer.setDocument(doc);
  while (renderer.stats.visibleReadyMs === null) await sleep(1);
  const result: OpenResult = {
    segments: segmentCount(doc),
    importMs: round(importMs),
    firstInkMs: round(importMs + (renderer.stats.firstInkMs ?? 0)),
    visibleReadyMs: round(importMs + renderer.stats.visibleReadyMs),
    tileRenderMsMax: round(renderer.stats.tileRenderMsMax),
    sliceMsMax: round(renderer.stats.sliceMsMax),
  };
  await whenIdle(renderer);
  renderer.destroy();
  return result;
}

/* ----------------------------------------------------------- zoomed pan -- */

export type PanResult = {
  pans: number;
  /** Tiles on screen not yet drawn the moment each pan settled, summed. */
  blankTilesAfterPan: number;
  visibleTilesPerPan: number;
  tileRenders: number;
  tileRenderMsMax: number;
  sliceMsMax: number;
  framesOver25: number;
  peakCanvasBytes: number;
  largestCanvasPixels: number;
};

/**
 * Pans a zoomed page in half-tile steps, the way a finger drag ends: the
 * gesture holds background drawing, then the sheet settles somewhere new.
 */
export async function measureZoomedPan(): Promise<PanResult> {
  const doc = denseHandwriting();
  const { sheet, view } = viewFor("zoomed", doc);
  const { renderer, host } = await renderWithEngine(doc, sheet, view);
  const steps: Array<[number, number]> = [[128, 0], [128, 64], [0, 128], [-128, 64], [-128, -96], [0, -128]];
  let current: View = view;
  let blank = 0;
  let visibleTiles = 0;
  renderer.resetStats();
  const stopFrames = recordFrames();
  for (const [dx, dy] of steps) {
    renderer.beginGesture();
    current = {
      ...current,
      left: Math.min(Math.max(0, current.left + dx), sheet.width - current.width),
      top: Math.min(Math.max(0, current.top + dy), sheet.height - current.height),
    };
    // The compositor moves the sheet while the finger is down.
    host.style.left = `${-current.left}px`;
    host.style.top = `${-current.top}px`;
    await frames(3);
    renderer.endGesture();
    renderer.setViewport({ scale: SCALE.zoomed, devicePixelRatio: window.devicePixelRatio, visible: current });
    const coverage = renderer.coverage();
    blank += coverage.visible - coverage.drawn;
    visibleTiles = coverage.visible;
    await whenIdle(renderer);
  }
  const frameTimes = stopFrames();
  return {
    pans: steps.length,
    blankTilesAfterPan: blank,
    visibleTilesPerPan: visibleTiles,
    tileRenders: renderer.stats.tileRenders,
    tileRenderMsMax: round(renderer.stats.tileRenderMsMax),
    sliceMsMax: round(renderer.stats.sliceMsMax),
    framesOver25: frameTimes.filter((time) => time > 25).length,
    peakCanvasBytes: renderer.stats.peakCanvasBytes,
    largestCanvasPixels: renderer.stats.largestCanvasPixels,
  };
}

/* ------------------------------------------------------------- changes -- */

export type ChangeResult = {
  name: string;
  ms: number;
  tilesRedrawn: number;
  tilesOnScreen: number;
  tileRenders: number;
};

/**
 * Erase, undo and redo as stage 4 will drive them: a stroke removed from the
 * middle of the page, put back at its place, and a new stroke added on top.
 */
export async function measureChanges(mode: Mode): Promise<ChangeResult[]> {
  let doc = denseHandwriting();
  const { sheet, view } = viewFor(mode, doc);
  const { renderer } = await renderWithEngine(doc, sheet, view);
  const onScreen = renderer.coverage().visible;
  const centreX = (view.left + view.width / 2) / SCALE[mode];
  const centreY = (view.top + view.height / 2) / SCALE[mode];
  const target = doc.items
    .filter((item) => item.kind === "outline" && item.layer === "pen")
    .map((item) => {
      const box = inkItemBounds(item);
      return { item, distance: Math.hypot((box.minX + box.maxX) / 2 - centreX, (box.minY + box.maxY) / 2 - centreY) };
    })
    .sort((a, b) => a.distance - b.distance)[0].item;

  const results: ChangeResult[] = [];
  const run = async (name: string, change: ReturnType<typeof inkRemoveChange>) => {
    renderer.resetStats();
    const next = applyInkChange(doc, change);
    const start = performance.now();
    renderer.applyChange(next, change);
    const ms = performance.now() - start;
    doc = next;
    results.push({ name, ms: round(ms), tilesRedrawn: renderer.stats.changeTiles, tilesOnScreen: onScreen, tileRenders: renderer.stats.tileRenders + renderer.stats.tileAppends });
    await whenIdle(renderer);
  };
  const erase = inkRemoveChange(doc, [target.id]);
  await run("erase a stroke", erase);
  await run("undo the erase", invertInkChange(erase));
  const added = writeStroke("pen", { x: centreX - 80, y: centreY, length: 160, samples: 120, width: 6, loops: 6, pressure: true }, 1 / SCALE[mode]);
  await run("add a stroke on top", inkAddChange(doc, [added]));
  return results;
}

/* ---------------------------------------------------------------- zoom -- */

export type ZoomResult = {
  /** From the zoom settling to the new level replacing the old one. */
  swapMs: number;
  /** Tiles of the stand-in on screen, and how many were drawn, the moment the zoom settled. */
  standInVisible: number;
  standInDrawn: number;
  levelSwaps: number;
};

/** Settles a zoom from fitted to zoomed, and waits for the sharp level to replace the scaled one. */
export async function measureZoomSettle(): Promise<ZoomResult> {
  const doc = denseHandwriting();
  const fitted = viewFor("fitted", doc);
  const { renderer, host } = await renderWithEngine(doc, fitted.sheet, fitted.view);
  const zoomed = viewFor("zoomed", doc);
  renderer.resetStats();
  host.style.left = `${-zoomed.view.left}px`;
  host.style.top = `${-zoomed.view.top}px`;
  const stage = host.parentElement!;
  stage.style.width = `${zoomed.view.width}px`;
  stage.style.height = `${zoomed.view.height}px`;
  const start = performance.now();
  renderer.setViewport({ scale: SCALE.zoomed, devicePixelRatio: window.devicePixelRatio, visible: zoomed.view });
  const standIn = renderer.coverage();
  while (renderer.stats.levelSwaps === 0) await sleep(1);
  const swapMs = performance.now() - start;
  await whenIdle(renderer);
  return { swapMs: round(swapMs), standInVisible: standIn.visible, standInDrawn: standIn.drawn, levelSwaps: renderer.stats.levelSwaps };
}
