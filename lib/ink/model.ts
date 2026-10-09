/**
 * Jami Ink's document model: the pure, DOM-free shapes a notebook page's ink is
 * made of. It also runs on the server, so nothing here touches the browser.
 *
 * An {@link InkDocument} is an ordered list of items in page coordinates (the
 * 900 x 1240 page space of `NOTEBOOK_PAGE_COORDINATE_*`). Each item has a stable
 * id so history, the spatial index and the renderer can name it. Items are
 * treated as immutable: change one by making a new object, never by editing it,
 * because {@link inkItemBounds} caches per object.
 *
 * Pen and highlighter centreline items are a later stage; they will arrive as
 * new `kind`s of {@link InkItem}.
 */

import { inkPathBounds } from "@/lib/ink/path";
import { inkShapePath } from "@/lib/ink/shapes";

/** An sRGB colour: r, g, b are integers 0-255, a is 0 (clear) to 1 (opaque). */
export type InkColor = { r: number; g: number; b: number; a: number };

export type InkPoint = { x: number; y: number };

/** Absolute path commands in page units. SVG arcs are converted on import. */
export type InkPathCommand =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Q"; x1: number; y1: number; x: number; y: number }
  | { op: "Z" };

export type InkCap = "round" | "butt" | "square";
export type InkJoin = "round" | "miter" | "bevel";

export type InkStrokeStyle = {
  color: InkColor;
  width: number;
  cap: InkCap;
  join: InkJoin;
};

export type InkPaint = {
  fill: InkColor | null;
  stroke: InkStrokeStyle | null;
  opacity: number;
};

/**
 * Highlighter ink is always drawn under pen ink, whatever order it was drawn
 * in. Rendering draws every highlighter-layer item first, then every pen-layer
 * item; within a layer, array order decides.
 */
export type InkLayer = "highlighter" | "pen";

/** Imported legacy ink: a filled and/or stroked path. */
export type InkOutlineItem = {
  kind: "outline";
  id: string;
  layer: InkLayer;
  path: InkPathCommand[];
  paint: InkPaint;
};

export type InkShapeGeometry =
  | { type: "line" | "arrow"; from: InkPoint; to: InkPoint }
  /** Triangles and rectangles: three or more corners, closed. */
  | { type: "polygon"; corners: InkPoint[] }
  /** `rotation` is in radians about the centre. */
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number; rotation: number };

/** A parametric shape, stroked with round caps and joins at `width`. */
export type InkShapeItem = {
  kind: "shape";
  id: string;
  layer: "pen";
  color: InkColor;
  width: number;
  shape: InkShapeGeometry;
};

export type InkItem = InkOutlineItem | InkShapeItem;

export type InkDocument = { version: 3; items: InkItem[] };

export function emptyInkDocument(): InkDocument {
  return { version: 3, items: [] };
}

export type InkBox = { minX: number; minY: number; maxX: number; maxY: number };

export function inkBoxUnion(a: InkBox, b: InkBox): InkBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Boxes that merely touch count as intersecting, so no edge pixel is missed. */
export function inkBoxesIntersect(a: InkBox, b: InkBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function inkBoxGrow(box: InkBox, amount: number): InkBox {
  return {
    minX: box.minX - amount,
    minY: box.minY - amount,
    maxX: box.maxX + amount,
    maxY: box.maxY + amount,
  };
}

const EMPTY_BOX: InkBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** How far a miter join can poke past the path, as a multiple of the width. */
const MITER_REACH_IN_WIDTHS = 2;

const boundsCache = new WeakMap<InkItem, InkBox>();

function computeInkItemBounds(item: InkItem): InkBox {
  if (item.kind === "shape") {
    const pathBounds = inkPathBounds(inkShapePath(item.shape, item.width));
    return pathBounds ? inkBoxGrow(pathBounds, item.width / 2) : EMPTY_BOX;
  }
  const pathBounds = inkPathBounds(item.path);
  if (!pathBounds) return EMPTY_BOX;
  const stroke = item.paint.stroke;
  if (!stroke) return pathBounds;
  const reach = stroke.join === "miter" ? stroke.width * MITER_REACH_IN_WIDTHS : stroke.width / 2;
  return inkBoxGrow(pathBounds, reach);
}

/**
 * The painted area of an item, stroke included. Dirty regions and the spatial
 * index rely on it never being too small; a slightly generous miter allowance
 * is the price of not computing every corner. An item with no path has no
 * paint, so its box is the empty box at the origin.
 */
export function inkItemBounds(item: InkItem): InkBox {
  const cached = boundsCache.get(item);
  if (cached) return cached;
  const bounds = computeInkItemBounds(item);
  boundsCache.set(item, bounds);
  return bounds;
}

const ID_LENGTH = 10;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
/** Largest multiple of 36 below 256, so a byte maps to a character without bias. */
const ID_BYTE_LIMIT = 252;

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    // Ids only need to be unique within a page, so a weak source is acceptable
    // in the rare runtime without Web Crypto.
    for (let i = 0; i < count; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** A short unique id (10 base36 characters) that works in Node and browsers. */
export function createInkItemId(): string {
  let id = "";
  while (id.length < ID_LENGTH) {
    const bytes = randomBytes(ID_LENGTH * 2);
    for (let i = 0; i < bytes.length && id.length < ID_LENGTH; i += 1) {
      if (bytes[i] < ID_BYTE_LIMIT) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    }
  }
  return id;
}
