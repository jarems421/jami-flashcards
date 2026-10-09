/**
 * What the stored ink encoding keeps of a number, and the limits it enforces.
 *
 * Coordinates and widths are rounded to 1/16 page unit (finer than a screen
 * pixel at any zoom the editor allows), colour alpha and opacity to 8 bits, and
 * ellipse rotation to 1/65536 radian. {@link quantizeInkDocument} applies
 * exactly that rounding, so `decode(encode(doc))` equals it.
 */

import type {
  InkColor,
  InkDocument,
  InkItem,
  InkPaint,
  InkPathCommand,
  InkPoint,
  InkShapeGeometry,
  InkStrokeStyle,
} from "@/lib/ink/model";

export const COORDINATE_SCALE = 16;
export const ROTATION_SCALE = 65536;

export const MAX_INK_ITEMS = 50_000;
export const MAX_PATH_COMMANDS_PER_ITEM = 500_000;
/** Across the whole document, so many large items cannot add up to a memory bomb. */
export const MAX_PATH_COMMANDS_TOTAL = 2_000_000;
export const MAX_ID_BYTES = 64;
export const MAX_POLYGON_CORNERS = 10_000;
/** The longest stored text accepted, before it is even decoded. */
export const MAX_ENCODED_CHARACTERS = 48 * 1024 * 1024;
/** Quantised coordinates must stay within this many 1/16 units (2^24 page units). */
export const MAX_QUANTIZED = 2 ** 28;
/** Radians; far beyond any real rotation, but small enough to quantise exactly. */
export const MAX_ROTATION = 1_000_000;

/** `+ 0` turns -0 into 0, so quantised documents compare equal under `toEqual`. */
function round(value: number): number {
  return Math.round(value) + 0;
}

/** The integer stored for a coordinate or width. */
export function toQuantized(value: number): number {
  return round(value * COORDINATE_SCALE);
}

export function fromQuantized(units: number): number {
  return units / COORDINATE_SCALE;
}

export function quantizeInkNumber(value: number): number {
  return fromQuantized(toQuantized(value));
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, round(value)));
}

/** The 8-bit alpha stored for a colour or opacity. */
export function toAlphaByte(alpha: number): number {
  return clampByte(alpha * 255);
}

export function quantizeInkColor(color: InkColor): InkColor {
  return {
    r: clampByte(color.r),
    g: clampByte(color.g),
    b: clampByte(color.b),
    a: toAlphaByte(color.a) / 255,
  };
}

function quantizePoint(point: InkPoint): InkPoint {
  return { x: quantizeInkNumber(point.x), y: quantizeInkNumber(point.y) };
}

function quantizeCommand(command: InkPathCommand): InkPathCommand {
  const q = quantizeInkNumber;
  switch (command.op) {
    case "Z":
      return { op: "Z" };
    case "M":
    case "L":
      return { op: command.op, x: q(command.x), y: q(command.y) };
    case "Q":
      return { op: "Q", x1: q(command.x1), y1: q(command.y1), x: q(command.x), y: q(command.y) };
    case "C":
      return {
        op: "C",
        x1: q(command.x1),
        y1: q(command.y1),
        x2: q(command.x2),
        y2: q(command.y2),
        x: q(command.x),
        y: q(command.y),
      };
  }
}

function quantizeStroke(stroke: InkStrokeStyle): InkStrokeStyle {
  return {
    color: quantizeInkColor(stroke.color),
    width: quantizeInkNumber(stroke.width),
    cap: stroke.cap,
    join: stroke.join,
  };
}

function quantizePaint(paint: InkPaint): InkPaint {
  return {
    fill: paint.fill ? quantizeInkColor(paint.fill) : null,
    stroke: paint.stroke ? quantizeStroke(paint.stroke) : null,
    opacity: toAlphaByte(paint.opacity) / 255,
  };
}

function quantizeGeometry(geometry: InkShapeGeometry): InkShapeGeometry {
  switch (geometry.type) {
    case "line":
    case "arrow":
      return { type: geometry.type, from: quantizePoint(geometry.from), to: quantizePoint(geometry.to) };
    case "polygon":
      return { type: "polygon", corners: geometry.corners.map(quantizePoint) };
    case "ellipse":
      return {
        type: "ellipse",
        cx: quantizeInkNumber(geometry.cx),
        cy: quantizeInkNumber(geometry.cy),
        rx: quantizeInkNumber(geometry.rx),
        ry: quantizeInkNumber(geometry.ry),
        rotation: round(geometry.rotation * ROTATION_SCALE) / ROTATION_SCALE,
      };
  }
}

function quantizeItem(item: InkItem): InkItem {
  if (item.kind === "outline") {
    return {
      kind: "outline",
      id: item.id,
      layer: item.layer,
      path: item.path.map(quantizeCommand),
      paint: quantizePaint(item.paint),
    };
  }
  return {
    kind: "shape",
    id: item.id,
    layer: "pen",
    color: quantizeInkColor(item.color),
    width: quantizeInkNumber(item.width),
    shape: quantizeGeometry(item.shape),
  };
}

/** The document exactly as it reads back after being stored. */
export function quantizeInkDocument(doc: InkDocument): InkDocument {
  return { version: 3, items: doc.items.map(quantizeItem) };
}
