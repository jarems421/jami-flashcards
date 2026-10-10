/**
 * Fidelity and lift scenes. The spec screenshots the stage between steps and
 * compares the pixels in Node.
 */

import { inkToSvg } from "@/lib/ink/export-svg";
import { inkAddChange } from "@/lib/ink/history";
import { importJsDrawSvg } from "@/lib/ink/import-js-draw-svg";
import { importLegacyStrokes } from "@/lib/ink/import-legacy-strokes";
import { inkBoxUnion, inkItemBounds, type InkBox, type InkDocument, type InkItem, type InkLayer } from "@/lib/ink/model";
import type { InkRenderer } from "@/lib/ink-dom/renderer";
import { legacyStrokesToJsDrawSvg } from "@/lib/workspace/notebook-ink-data";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  type NotebookStroke,
} from "@/lib/workspace/notebooks";
import { renderWithEngine, renderWithJsDraw, sheetAt, whenIdle, type Sheet, type View } from "./stage";
import { handwritingPage, outlineItem, seededPageSvg, strokeFor, strokeSamples, writeStroke, type LiveStroke } from "./strokes";

/**
 * CSS pixels per page unit. Fitted is about how the notebook fits the sheet on
 * a 1180 x 820 screen; zoomed is about four times that.
 */
export type Mode = "fitted" | "zoomed";
export const SCALE: Record<Mode, number> = { fitted: 0.6, zoomed: 2.5 };
const SCREEN = { width: 1180, height: 820 };

/** Where a page comes from, so js-draw and the engine read the very same thing. */
export type Source =
  | { kind: "svg"; svg: string }
  /** The SVG read into the engine and written back: highlighter paths first. */
  | { kind: "svg-layered"; svg: string }
  | { kind: "legacy"; strokes: NotebookStroke[] }
  | { kind: "seeded"; oldForm?: boolean }
  | { kind: "handwriting"; segments: number };

function documentOf(source: Source): InkDocument {
  switch (source.kind) {
    case "svg":
    case "svg-layered":
      return importJsDrawSvg(source.svg)?.document ?? { version: 3, items: [] };
    case "legacy":
      return importLegacyStrokes({ version: 1, strokes: source.strokes }).document;
    case "seeded":
      return importJsDrawSvg(seededPageSvg(60, 52, 1, source.oldForm))?.document ?? { version: 3, items: [] };
    case "handwriting":
      return handwritingPage(source.segments, 1 / SCALE.fitted);
  }
}

function svgOf(source: Source): string {
  switch (source.kind) {
    case "svg":
      return source.svg;
    case "svg-layered":
      return inkToSvg(documentOf(source));
    case "legacy":
      return legacyStrokesToJsDrawSvg(source.strokes, NOTEBOOK_PAGE_COORDINATE_WIDTH, NOTEBOOK_PAGE_COORDINATE_HEIGHT);
    case "seeded":
      return seededPageSvg(60, 52, 1, source.oldForm);
    case "handwriting":
      return inkToSvg(documentOf(source));
  }
}

function inkBounds(doc: InkDocument): InkBox | null {
  let box: InkBox | null = null;
  for (const item of doc.items) {
    if (item.kind === "unknown") continue;
    const bounds = inkItemBounds(item);
    box = box ? inkBoxUnion(box, bounds) : bounds;
  }
  return box;
}

/** The whole sheet when fitted; zoomed, a screenful centred on the ink, on whole CSS pixels. */
export function viewFor(mode: Mode, doc: InkDocument): { sheet: Sheet; view: View } {
  const sheet = sheetAt(SCALE[mode]);
  if (mode === "fitted") return { sheet, view: { left: 0, top: 0, width: sheet.width, height: sheet.height } };
  const box = inkBounds(doc) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const scale = SCALE[mode];
  const centreX = ((box.minX + box.maxX) / 2) * scale;
  const centreY = ((box.minY + box.maxY) / 2) * scale;
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(0, value), max));
  return {
    sheet,
    view: {
      left: clamp(centreX - SCREEN.width / 2, sheet.width - SCREEN.width),
      top: clamp(centreY - SCREEN.height / 2, sheet.height - SCREEN.height),
      ...SCREEN,
    },
  };
}

export async function showJsDraw(source: Source, mode: Mode): Promise<View> {
  const { sheet, view } = viewFor(mode, documentOf(source));
  await renderWithJsDraw(svgOf(source), sheet, view);
  return view;
}

export async function showEngine(source: Source, mode: Mode): Promise<View> {
  const doc = documentOf(source);
  const { sheet, view } = viewFor(mode, doc);
  await renderWithEngine(doc, sheet, view);
  return view;
}

/** Old v1 strokes, as point lists, with or without a highlighter. */
export function legacyStrokes(withHighlighter: boolean): NotebookStroke[] {
  const wave = (y: number, count: number, step: number, amplitude: number) =>
    Array.from({ length: count }, (_unused, i) => ({ x: 80 + i * step, y: y + Math.sin(i / 2) * amplitude }));
  const strokes: NotebookStroke[] = [
    { tool: "pen", color: "black", width: 3, points: wave(200, 60, 9, 12) },
    { tool: "pen", color: "#2563eb", width: 2, points: wave(260, 40, 12, 20) },
    { tool: "pen", color: "red", width: 5, points: wave(330, 25, 20, 6) },
  ];
  if (withHighlighter) strokes.push({ tool: "highlighter", color: "yellow", width: 18, points: wave(240, 30, 18, 3) });
  return strokes;
}

/* ---------------------------------------------------------------- lift -- */

export type LiftOptions = {
  layer: InkLayer;
  mode: Mode;
  /** Nib width in page units. */
  width: number;
  pressure: boolean;
  /**
   * What the lift commits: `same` is the live layer's last geometry (the path
   * array itself), `copy` an equal copy of it (so a freshly built path). The
   * last live packet is what the lift keeps: for a highlighter, its traced
   * union rather than the footprints drawn until then.
   */
  commit: "same" | "copy";
};

type LiftState = {
  renderer: InkRenderer;
  doc: InkDocument;
  stroke: LiveStroke;
  options: LiftOptions;
  /** The geometry of the last live packet, exactly as drawn. */
  last: ReturnType<LiveStroke["live"]> | null;
};

let lift: LiftState | null = null;

/** Ink already on the page under the stroke, so the lift is tested over ink too. */
function liftBackground(): InkDocument {
  const items: InkItem[] = [
    writeStroke("pen", { x: 330, y: 300, length: 200, samples: 80, width: 5, loops: 6, pressure: true }, 1 / SCALE.fitted),
    writeStroke("highlighter", { x: 300, y: 330, length: 260, samples: 60, width: 24, loops: 0, pressure: false }, 1 / SCALE.fitted),
  ];
  return { version: 3, items };
}

const LIFT_STROKE = { x: 320, y: 320, length: 240, samples: 200, loops: 8 };

export async function liftSetup(options: LiftOptions): Promise<View> {
  const doc = liftBackground();
  const { sheet, view } = viewFor(options.mode, doc);
  const { renderer } = await renderWithEngine(doc, sheet, view);
  const [first] = strokeSamples({ ...LIFT_STROKE, width: options.width, pressure: options.pressure });
  lift = { renderer, doc, stroke: strokeFor(options.layer, first, 1 / SCALE[options.mode]), options, last: null };
  return view;
}

/** Writes the stroke as live ink (two samples a packet) and leaves the pen down. */
export function liftWrite(): void {
  if (!lift) throw new Error("liftSetup first");
  const state = lift;
  const { renderer, stroke, options } = state;
  const [, ...rest] = strokeSamples({ ...LIFT_STROKE, width: options.width, pressure: options.pressure });
  renderer.beginLive(options.layer);
  state.last = stroke.live();
  renderer.drawLive(state.last.path, state.last.paint);
  for (let i = 0; i < rest.length; i += 2) {
    stroke.add(rest[i]);
    if (rest[i + 1]) stroke.add(rest[i + 1]);
    state.last = stroke.live();
    renderer.drawLive(state.last.path, state.last.paint);
  }
  // The last packet draws what the lift keeps (the highlighter's traced union).
  state.last = stroke.committed();
  renderer.drawLive(state.last.path, state.last.paint);
}

/** Lifts the pen. Returns how long the commit took, in milliseconds. */
export function liftCommit(): number {
  if (!lift) throw new Error("liftSetup first");
  const { renderer, doc, options, last } = lift;
  if (!last) throw new Error("liftWrite first");
  const geometry =
    options.commit === "copy" ? { path: last.path.map((command) => ({ ...command })), paint: { ...last.paint } } : last;
  const item = outlineItem(options.layer, geometry);
  const change = inkAddChange(doc, [item]);
  const next: InkDocument = { version: 3, items: [...doc.items, item] };
  const start = performance.now();
  renderer.commitLive(next, change);
  const elapsed = performance.now() - start;
  lift.doc = next;
  return elapsed;
}

/**
 * Draws the page again from nothing, as after a reload: what the lift left on
 * screen must be what a full redraw gives, so the clipped repaints of live ink
 * never drift from drawing the stroke whole.
 */
export async function liftRedraw(): Promise<void> {
  if (!lift) throw new Error("liftSetup first");
  lift.renderer.setDocument(lift.doc);
  await whenIdle(lift.renderer);
}
