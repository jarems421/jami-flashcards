/**
 * Synthetic writing for the renderer harness: handwriting-like strokes put
 * through the real pen and highlighter geometry, and dense pages built from
 * them. Deterministic, so every run draws the same pixels.
 */

import { createInkChiselBuilder, type InkChiselBuilder } from "@/lib/ink/geometry/chisel";
import {
  createInkPenBuilder,
  type InkPenBuilder,
  type InkPenPaint,
  type InkPenSample,
} from "@/lib/ink/geometry/pen";
import {
  createInkItemId,
  type InkColor,
  type InkDocument,
  type InkItem,
  type InkLayer,
  type InkPaint,
  type InkPathCommand,
} from "@/lib/ink/model";
import { NIB_ANGLE_DEFAULT } from "@/lib/workspace/notebook-nib-angle";
import {
  getNotebookPenFeelFromSettings,
  NOTEBOOK_PEN_SETTINGS_DEFAULT,
} from "@/lib/workspace/notebook-pen-feel";

/** The notebook's default pen and highlighter colours, as the captured fixtures save them. */
export const BLACK: InkColor = { r: 0x11, g: 0x18, b: 0x27, a: 1 };
export const HIGHLIGHTER_YELLOW: InkColor = { r: 0xfd, g: 0xe0, b: 0x47, a: 0x6b / 255 };

/** A pencil reports about every 4 ms (240 Hz). */
const SAMPLE_INTERVAL_MS = 4.2;

export type StrokeSpec = {
  /** Where the stroke starts, in page units. */
  x: number;
  y: number;
  /** How far it travels to the right, in page units. */
  length: number;
  samples: number;
  /** The nib width, in page units (3 to 16 for the pen, 16 to 64 for the highlighter). */
  width: number;
  /** Loops written along the way; 0 draws a gentle wave, as a highlighter would. */
  loops: number;
  /** Pressure rising and falling along the stroke (which makes the pen fill an outline). */
  pressure: boolean;
};

/** Cursive-looking samples: a run of loops along a slightly rising line. */
export function strokeSamples(spec: StrokeSpec): InkPenSample[] {
  const samples: InkPenSample[] = [];
  for (let i = 0; i < spec.samples; i += 1) {
    const u = spec.samples === 1 ? 0 : i / (spec.samples - 1);
    const phase = u * spec.loops * Math.PI * 2;
    const loopRadius = spec.loops > 0 ? 7 : 0;
    const x = spec.x + u * spec.length + loopRadius * Math.sin(phase);
    const y = spec.y - u * 6 + (spec.loops > 0 ? 9 * -Math.cos(phase) + 9 : 3 * Math.sin(u * Math.PI * 3));
    const weight = spec.pressure ? 0.45 + 0.55 * Math.sin(u * Math.PI) : 1;
    samples.push({ x, y, width: spec.width * weight, time: i * SAMPLE_INTERVAL_MS });
  }
  return samples;
}

export function penInkPaint(paint: InkPenPaint, color: InkColor): InkPaint {
  return paint.kind === "fill"
    ? { fill: color, stroke: null, opacity: 1 }
    : { fill: null, stroke: { color, width: paint.width, cap: "round", join: "round" }, opacity: 1 };
}

/** A stroke being written: its geometry after each sample, as live ink draws it. */
export type LiveStroke = {
  layer: InkLayer;
  add(sample: InkPenSample): void;
  /** What live ink draws now. */
  live(): { path: InkPathCommand[]; paint: InkPaint };
  /**
   * What the lift keeps: for the pen the same geometry; for the highlighter
   * its traced union. The owner decided (10 October 2026) that the last live
   * packet draws this, so what shows at the lift is what is saved and reopens.
   */
  committed(): { path: InkPathCommand[]; paint: InkPaint };
};

export function penStroke(first: InkPenSample, pixelSize: number, color = BLACK): LiveStroke {
  const pen: InkPenBuilder = createInkPenBuilder(first, {
    feel: getNotebookPenFeelFromSettings(NOTEBOOK_PEN_SETTINGS_DEFAULT),
    pixelSize,
  });
  let last: { path: InkPathCommand[]; paint: InkPaint } | null = null;
  const live = () => {
    const geometry = pen.geometry();
    last = { path: geometry.path, paint: penInkPaint(geometry.paint, color) };
    return last;
  };
  return {
    layer: "pen",
    add: (sample) => pen.addPoint(sample),
    live,
    committed: () => last ?? live(),
  };
}

export function highlighterStroke(first: InkPenSample, pixelSize: number, color = HIGHLIGHTER_YELLOW): LiveStroke {
  const chisel: InkChiselBuilder = createInkChiselBuilder(first, { pixelSize, nibAngle: () => NIB_ANGLE_DEFAULT });
  const paint: InkPaint = { fill: color, stroke: null, opacity: 1 };
  return {
    layer: "highlighter",
    add: (sample) => chisel.addPoint(sample),
    live: () => ({ path: chisel.preview().path, paint }),
    committed: () => ({ path: chisel.build().path, paint }),
  };
}

export function strokeFor(layer: InkLayer, first: InkPenSample, pixelSize: number): LiveStroke {
  return layer === "pen" ? penStroke(first, pixelSize) : highlighterStroke(first, pixelSize);
}

export function outlineItem(layer: InkLayer, geometry: { path: InkPathCommand[]; paint: InkPaint }): InkItem {
  return { kind: "outline", id: createInkItemId(), layer, path: geometry.path, paint: geometry.paint };
}

/** Writes a whole stroke and returns the item the lift would keep. */
export function writeStroke(layer: InkLayer, spec: StrokeSpec, pixelSize: number): InkItem {
  const [first, ...rest] = strokeSamples(spec);
  const stroke = strokeFor(layer, first, pixelSize);
  for (const sample of rest) stroke.add(sample);
  return outlineItem(layer, stroke.committed());
}

/** Path commands that draw something (everything but moves and closes). */
export function segmentCount(doc: InkDocument): number {
  let count = 0;
  for (const item of doc.items) {
    if (item.kind !== "outline") continue;
    for (const command of item.path) if (command.op !== "M" && command.op !== "Z") count += 1;
  }
  return count;
}

/**
 * A page of handwriting: rows of pressure-shaped pen strokes, written until
 * the page holds `segments` path segments, with a highlighter over every
 * fourth row so both layers have tiles.
 */
export function handwritingPage(segments: number, pixelSize: number): InkDocument {
  const items: InkItem[] = [];
  let count = 0;
  for (let row = 0; count < segments; row += 1) {
    const y = 80 + (row % 22) * 52;
    const shift = Math.floor(row / 22) * 9;
    for (let word = 0; word < 5 && count < segments; word += 1) {
      const item = writeStroke(
        "pen",
        { x: 60 + word * 160 + shift, y, length: 120, samples: 60, width: 4, loops: 5, pressure: true },
        pixelSize
      );
      items.push(item);
      count += segmentCount({ version: 3, items: [item] });
    }
    if (row % 4 === 0) {
      items.push(
        writeStroke("highlighter", { x: 60, y: y + 4, length: 700, samples: 80, width: 22, loops: 0, pressure: false }, pixelSize)
      );
    }
  }
  return { version: 3, items };
}

/**
 * A page as `scripts/seed-large-notebook.mjs` writes one (rows of stroked
 * polylines), with `points` per row: 60 rows of 52 points is 3,060 segments.
 * With `oldForm`, every other row is written as the script wrote it before
 * 10 October 2026, as implicit line-tos after the M: js-draw's loader drops
 * those rows, and so must the importer.
 */
export function seededPageSvg(rows = 60, points = 52, pageNumber = 1, oldForm = false): string {
  const paths = Array.from({ length: rows }, (_unused, index) => {
    const y = 40 + index * 20;
    const coordinates = Array.from(
      { length: points },
      (_p, step) => `${60 + step * 15.5},${y + Math.sin(step + pageNumber) * 6}`
    );
    const d =
      oldForm && index % 2 === 0
        ? `M${coordinates.join(" ")}`
        : `M${coordinates[0]} L${coordinates.slice(1).join(" ")}`;
    return `<path d="${d}" stroke="#111" stroke-width="2" fill="none"/>`;
  }).join("");
  return `<svg viewBox="0 0 900 1240" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}
