/**
 * The stored `jami-ink` v3 encoding: `"j3:" + base64url(bytes)`.
 *
 * Byte layout (all varints are little-endian base-128, zigzag where signed):
 *
 *   document  := version(3) itemCount:varint item*
 *   item      := kind id layer data
 *   kind      := 1 (outline) | 2 (shape)          unknown kinds are rejected
 *   id        := byteLength:varint utf8Bytes       1-64 bytes, unique
 *   layer     := 0 (highlighter) | 1 (pen)         shapes are always pen
 *   colour    := r g b alpha                       4 bytes, alpha = round(a * 255)
 *   point     := dx:zigzag dy:zigzag               in 1/16 unit, from the previous
 *                                                  point written in the same item
 *                                                  (the first is from 0,0)
 *
 *   outline   := commandCount:varint command* flags [fillColour] [stroke] opacity
 *   command   := opcode(1 M, 2 L, 3 C, 4 Q, 5 Z) point*   (C: 3 points, Q: 2, M/L: 1)
 *   flags     := bit 0 = has fill, bit 1 = has stroke    other bits must be 0
 *   stroke    := colour width:varint cap(0 round, 1 butt, 2 square)
 *                join(0 round, 1 miter, 2 bevel)
 *   opacity   := 1 byte, round(opacity * 255)
 *
 *   shape     := colour width:varint geometry
 *   geometry  := 1 line  point point
 *              | 2 arrow point point
 *              | 3 polygon cornerCount:varint point{3+}
 *              | 4 ellipse point(centre) rx:varint ry:varint rotation:zigzag
 *   rotation  := round(radians * 65536)
 *
 * Numbers are rounded to 1/16 page unit (see `codec-quantize.ts`). Control
 * points are delta-coded too, because on a smooth curve each point is close to
 * the one before it, which is what makes a stroke a fraction of its SVG size.
 *
 * Decoding is strict and never throws: truncated data, trailing bytes, an
 * unknown kind, an overlong varint, a non-canonical base64url tail, duplicate
 * ids or absurd counts all return null. That also means each document has one
 * stored spelling, so `encode(decode(text)) === text` for any accepted text.
 */

import { base64UrlToBytes, ByteReader, ByteWriter, bytesToBase64Url } from "@/lib/ink/bytes";
import {
  fromQuantized,
  MAX_ENCODED_CHARACTERS,
  MAX_ID_BYTES,
  MAX_INK_ITEMS,
  MAX_PATH_COMMANDS_PER_ITEM,
  MAX_PATH_COMMANDS_TOTAL,
  MAX_POLYGON_CORNERS,
  MAX_QUANTIZED,
  MAX_ROTATION,
  ROTATION_SCALE,
  toAlphaByte,
  toQuantized,
} from "@/lib/ink/codec-quantize";
import type {
  InkCap,
  InkColor,
  InkDocument,
  InkItem,
  InkJoin,
  InkLayer,
  InkPaint,
  InkPathCommand,
  InkPoint,
  InkShapeGeometry,
} from "@/lib/ink/model";

export { quantizeInkDocument } from "@/lib/ink/codec-quantize";

const PREFIX = "j3:";
const VERSION = 3;

const KIND_OUTLINE = 1;
const KIND_SHAPE = 2;
const LAYERS: readonly InkLayer[] = ["highlighter", "pen"];
const CAPS: readonly InkCap[] = ["round", "butt", "square"];
const JOINS: readonly InkJoin[] = ["round", "miter", "bevel"];
const OPCODES = { M: 1, L: 2, C: 3, Q: 4, Z: 5 } as const;
const GEOMETRY_CODES = { line: 1, arrow: 2, polygon: 3, ellipse: 4 } as const;
const FLAG_FILL = 1;
const FLAG_STROKE = 2;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

class InkDecodeError extends Error {}

function reject(message: string): never {
  throw new InkDecodeError(message);
}

/* ------------------------------------------------------------------ encode */

/** Tracks the running point so coordinates are written as small deltas. */
class PointWriter {
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly out: ByteWriter) {}

  point(x: number, y: number): void {
    const qx = checkedUnits(x, "coordinate");
    const qy = checkedUnits(y, "coordinate");
    this.out.writeZigzag(qx - this.lastX);
    this.out.writeZigzag(qy - this.lastY);
    this.lastX = qx;
    this.lastY = qy;
  }
}

function checkedUnits(value: number, what: string): number {
  const units = toQuantized(value);
  if (!Number.isFinite(units) || Math.abs(units) > MAX_QUANTIZED) {
    throw new Error(`Ink ${what} ${value} cannot be stored.`);
  }
  return units;
}

function writeUnsignedUnits(out: ByteWriter, value: number, what: string): void {
  const units = checkedUnits(value, what);
  if (units < 0) throw new Error(`Ink ${what} ${value} cannot be negative.`);
  out.writeVarint(units);
}

function writeColor(out: ByteWriter, color: InkColor): void {
  for (const channel of [color.r, color.g, color.b]) {
    if (!Number.isFinite(channel)) throw new Error("Ink colour channel is not a number.");
    out.writeByte(Math.min(255, Math.max(0, Math.round(channel))));
  }
  if (!Number.isFinite(color.a)) throw new Error("Ink colour alpha is not a number.");
  out.writeByte(toAlphaByte(color.a));
}

function writeCommands(out: ByteWriter, commands: InkPathCommand[]): void {
  if (commands.length > MAX_PATH_COMMANDS_PER_ITEM) {
    throw new Error(`Ink path has more than ${MAX_PATH_COMMANDS_PER_ITEM} commands.`);
  }
  out.writeVarint(commands.length);
  const points = new PointWriter(out);
  for (const command of commands) {
    out.writeByte(OPCODES[command.op]);
    switch (command.op) {
      case "M":
      case "L":
        points.point(command.x, command.y);
        break;
      case "Q":
        points.point(command.x1, command.y1);
        points.point(command.x, command.y);
        break;
      case "C":
        points.point(command.x1, command.y1);
        points.point(command.x2, command.y2);
        points.point(command.x, command.y);
        break;
      case "Z":
        break;
    }
  }
}

function writePaint(out: ByteWriter, paint: InkPaint): void {
  out.writeByte((paint.fill ? FLAG_FILL : 0) | (paint.stroke ? FLAG_STROKE : 0));
  if (paint.fill) writeColor(out, paint.fill);
  if (paint.stroke) {
    writeColor(out, paint.stroke.color);
    writeUnsignedUnits(out, paint.stroke.width, "stroke width");
    out.writeByte(CAPS.indexOf(paint.stroke.cap));
    out.writeByte(JOINS.indexOf(paint.stroke.join));
  }
  if (!Number.isFinite(paint.opacity)) throw new Error("Ink opacity is not a number.");
  out.writeByte(toAlphaByte(paint.opacity));
}

function writeGeometry(out: ByteWriter, geometry: InkShapeGeometry): void {
  out.writeByte(GEOMETRY_CODES[geometry.type]);
  const points = new PointWriter(out);
  switch (geometry.type) {
    case "line":
    case "arrow":
      points.point(geometry.from.x, geometry.from.y);
      points.point(geometry.to.x, geometry.to.y);
      break;
    case "polygon":
      if (geometry.corners.length < 3 || geometry.corners.length > MAX_POLYGON_CORNERS) {
        throw new Error("An ink polygon needs between 3 and 10,000 corners.");
      }
      out.writeVarint(geometry.corners.length);
      for (const corner of geometry.corners) points.point(corner.x, corner.y);
      break;
    case "ellipse": {
      points.point(geometry.cx, geometry.cy);
      writeUnsignedUnits(out, geometry.rx, "ellipse radius");
      writeUnsignedUnits(out, geometry.ry, "ellipse radius");
      if (!Number.isFinite(geometry.rotation) || Math.abs(geometry.rotation) > MAX_ROTATION) {
        throw new Error("Ink ellipse rotation cannot be stored.");
      }
      out.writeZigzag(Math.round(geometry.rotation * ROTATION_SCALE) + 0);
      break;
    }
  }
}

function writeItem(out: ByteWriter, item: InkItem, seenIds: Set<string>): void {
  const id = textEncoder.encode(item.id);
  if (id.length === 0 || id.length > MAX_ID_BYTES) {
    throw new Error(`Ink item id must be 1 to ${MAX_ID_BYTES} bytes.`);
  }
  if (seenIds.has(item.id)) throw new Error(`Ink item id "${item.id}" is used twice.`);
  seenIds.add(item.id);

  out.writeByte(item.kind === "outline" ? KIND_OUTLINE : KIND_SHAPE);
  out.writeVarint(id.length);
  out.writeBytes(id);
  out.writeByte(LAYERS.indexOf(item.layer));
  if (item.kind === "outline") {
    writeCommands(out, item.path);
    writePaint(out, item.paint);
  } else {
    writeColor(out, item.color);
    writeUnsignedUnits(out, item.width, "shape width");
    writeGeometry(out, item.shape);
  }
}

/** Throws a clear Error if the document cannot be stored within the limits. */
export function encodeInkDocument(doc: InkDocument): string {
  if (doc.items.length > MAX_INK_ITEMS) {
    throw new Error(`Ink document has more than ${MAX_INK_ITEMS} items.`);
  }
  const out = new ByteWriter();
  out.writeByte(VERSION);
  out.writeVarint(doc.items.length);
  const seenIds = new Set<string>();
  let commandTotal = 0;
  for (const item of doc.items) {
    if (item.kind === "outline") commandTotal += item.path.length;
    if (commandTotal > MAX_PATH_COMMANDS_TOTAL) {
      throw new Error(`Ink document has more than ${MAX_PATH_COMMANDS_TOTAL} path commands.`);
    }
    writeItem(out, item, seenIds);
  }
  return PREFIX + bytesToBase64Url(out.toBytes());
}

/* ------------------------------------------------------------------ decode */

class PointReader {
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly input: ByteReader) {}

  point(): InkPoint {
    const x = this.lastX + this.input.readZigzag();
    const y = this.lastY + this.input.readZigzag();
    if (Math.abs(x) > MAX_QUANTIZED || Math.abs(y) > MAX_QUANTIZED) reject("Coordinate out of range.");
    this.lastX = x;
    this.lastY = y;
    return { x: fromQuantized(x), y: fromQuantized(y) };
  }
}

function readColor(input: ByteReader): InkColor {
  const r = input.readByte();
  const g = input.readByte();
  const b = input.readByte();
  return { r, g, b, a: input.readByte() / 255 };
}

function readUnsignedUnits(input: ByteReader): number {
  const units = input.readVarint();
  if (units > MAX_QUANTIZED) reject("Size out of range.");
  return fromQuantized(units);
}

function readChoice<T>(input: ByteReader, choices: readonly T[]): T {
  const choice = choices[input.readByte()];
  if (choice === undefined) reject("Unknown option code.");
  return choice;
}

function readCommands(input: ByteReader, budget: { left: number }): InkPathCommand[] {
  const count = input.readVarint();
  // Every command takes at least one byte, so a count beyond that is a lie.
  if (count > MAX_PATH_COMMANDS_PER_ITEM || count > input.remaining) reject("Too many commands.");
  budget.left -= count;
  if (budget.left < 0) reject("Too many commands in total.");
  const points = new PointReader(input);
  const commands: InkPathCommand[] = [];
  for (let i = 0; i < count; i += 1) {
    switch (input.readByte()) {
      case OPCODES.M: {
        const p = points.point();
        commands.push({ op: "M", x: p.x, y: p.y });
        break;
      }
      case OPCODES.L: {
        const p = points.point();
        commands.push({ op: "L", x: p.x, y: p.y });
        break;
      }
      case OPCODES.Q: {
        const c = points.point();
        const p = points.point();
        commands.push({ op: "Q", x1: c.x, y1: c.y, x: p.x, y: p.y });
        break;
      }
      case OPCODES.C: {
        const c1 = points.point();
        const c2 = points.point();
        const p = points.point();
        commands.push({ op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
        break;
      }
      case OPCODES.Z:
        commands.push({ op: "Z" });
        break;
      default:
        reject("Unknown path command.");
    }
  }
  return commands;
}

function readPaint(input: ByteReader): InkPaint {
  const flags = input.readByte();
  if ((flags & ~(FLAG_FILL | FLAG_STROKE)) !== 0) reject("Unknown paint flags.");
  const fill = flags & FLAG_FILL ? readColor(input) : null;
  const stroke =
    flags & FLAG_STROKE
      ? {
          color: readColor(input),
          width: readUnsignedUnits(input),
          cap: readChoice(input, CAPS),
          join: readChoice(input, JOINS),
        }
      : null;
  return { fill, stroke, opacity: input.readByte() / 255 };
}

function readGeometry(input: ByteReader): InkShapeGeometry {
  const code = input.readByte();
  const points = new PointReader(input);
  switch (code) {
    case GEOMETRY_CODES.line:
    case GEOMETRY_CODES.arrow: {
      const from = points.point();
      const to = points.point();
      return { type: code === GEOMETRY_CODES.line ? "line" : "arrow", from, to };
    }
    case GEOMETRY_CODES.polygon: {
      const count = input.readVarint();
      if (count < 3 || count > MAX_POLYGON_CORNERS || count > input.remaining) {
        reject("Bad polygon.");
      }
      const corners: InkPoint[] = [];
      for (let i = 0; i < count; i += 1) corners.push(points.point());
      return { type: "polygon", corners };
    }
    case GEOMETRY_CODES.ellipse: {
      const centre = points.point();
      const rx = readUnsignedUnits(input);
      const ry = readUnsignedUnits(input);
      const rotationUnits = input.readZigzag();
      if (Math.abs(rotationUnits) > MAX_ROTATION * ROTATION_SCALE) reject("Rotation out of range.");
      return {
        type: "ellipse",
        cx: centre.x,
        cy: centre.y,
        rx,
        ry,
        rotation: rotationUnits / ROTATION_SCALE,
      };
    }
    default:
      return reject("Unknown shape.");
  }
}

function readItem(input: ByteReader, budget: { left: number }): InkItem {
  const kind = input.readByte();
  if (kind !== KIND_OUTLINE && kind !== KIND_SHAPE) reject("Unknown item kind.");
  const idLength = input.readVarint();
  if (idLength < 1 || idLength > MAX_ID_BYTES) reject("Bad id length.");
  const id = textDecoder.decode(input.readBytes(idLength));
  const layer = readChoice(input, LAYERS);
  if (kind === KIND_OUTLINE) {
    const path = readCommands(input, budget);
    return { kind: "outline", id, layer, path, paint: readPaint(input) };
  }
  if (layer !== "pen") reject("Shapes live on the pen layer.");
  const color = readColor(input);
  const width = readUnsignedUnits(input);
  return { kind: "shape", id, layer: "pen", color, width, shape: readGeometry(input) };
}

/** Reads stored ink, or null if it is anything other than valid v3 data. */
export function decodeInkDocument(text: string): InkDocument | null {
  try {
    if (!text.startsWith(PREFIX) || text.length > MAX_ENCODED_CHARACTERS) return null;
    const input = new ByteReader(base64UrlToBytes(text.slice(PREFIX.length)));
    if (input.readByte() !== VERSION) return null;
    const count = input.readVarint();
    // An item takes several bytes, so a bigger count than bytes is a lie.
    if (count > MAX_INK_ITEMS || count > input.remaining) return null;
    const budget = { left: MAX_PATH_COMMANDS_TOTAL };
    const seenIds = new Set<string>();
    const items: InkItem[] = [];
    for (let i = 0; i < count; i += 1) {
      const item = readItem(input, budget);
      if (seenIds.has(item.id)) return null;
      seenIds.add(item.id);
      items.push(item);
    }
    return input.remaining === 0 ? { version: VERSION, items } : null;
  } catch {
    return null;
  }
}
