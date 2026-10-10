/**
 * Ink path data: reading and writing SVG `d` strings, exact bounds, and affine
 * transforms. Imported js-draw ink arrives as SVG paths, so the parser covers
 * the whole SVG path grammar and reduces it to absolute M, L, C, Q and Z.
 */

import { arcToCubics } from "@/lib/ink/arc";
import type { InkBox, InkPathCommand } from "@/lib/ink/model";
import { applyInkMatrix, type InkMatrix } from "@/lib/ink/matrix";
import { SvgScanner } from "@/lib/ink/svg-scan";

export {
  identityInkMatrix,
  multiplyInkMatrix,
  parseSvgTransform,
  type InkMatrix,
} from "@/lib/ink/matrix";

const PARAMETER_COUNTS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

type Pen = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** Second control point of the previous C or S, for S to reflect. */
  cubicControl: { x: number; y: number } | null;
  /** Control point of the previous Q or T, for T to reflect. */
  quadControl: { x: number; y: number } | null;
};

function isFiniteCommand(command: InkPathCommand): boolean {
  switch (command.op) {
    case "Z":
      return true;
    case "M":
    case "L":
      return Number.isFinite(command.x) && Number.isFinite(command.y);
    case "Q":
      return [command.x1, command.y1, command.x, command.y].every(Number.isFinite);
    case "C":
      return [command.x1, command.y1, command.x2, command.y2, command.x, command.y].every(
        Number.isFinite
      );
  }
}

/** Applies one command's parameters to the pen, appending absolute commands. */
function applyPathCommand(
  letter: string,
  p: number[],
  pen: Pen,
  out: InkPathCommand[]
): void {
  const relative = letter === letter.toLowerCase();
  const ox = relative ? pen.x : 0;
  const oy = relative ? pen.y : 0;
  let cubicControl: Pen["cubicControl"] = null;
  let quadControl: Pen["quadControl"] = null;

  switch (letter.toLowerCase()) {
    case "m": {
      const x = p[0] + ox;
      const y = p[1] + oy;
      out.push({ op: "M", x, y });
      pen.x = x;
      pen.y = y;
      pen.startX = x;
      pen.startY = y;
      break;
    }
    case "l":
    case "h":
    case "v": {
      const lower = letter.toLowerCase();
      const x = lower === "v" ? pen.x : p[0] + ox;
      const y = lower === "h" ? pen.y : (lower === "v" ? p[0] : p[1]) + oy;
      out.push({ op: "L", x, y });
      pen.x = x;
      pen.y = y;
      break;
    }
    case "c": {
      out.push({
        op: "C",
        x1: p[0] + ox,
        y1: p[1] + oy,
        x2: p[2] + ox,
        y2: p[3] + oy,
        x: p[4] + ox,
        y: p[5] + oy,
      });
      cubicControl = { x: p[2] + ox, y: p[3] + oy };
      pen.x = p[4] + ox;
      pen.y = p[5] + oy;
      break;
    }
    case "s": {
      const previous = pen.cubicControl;
      const x1 = previous ? 2 * pen.x - previous.x : pen.x;
      const y1 = previous ? 2 * pen.y - previous.y : pen.y;
      out.push({ op: "C", x1, y1, x2: p[0] + ox, y2: p[1] + oy, x: p[2] + ox, y: p[3] + oy });
      cubicControl = { x: p[0] + ox, y: p[1] + oy };
      pen.x = p[2] + ox;
      pen.y = p[3] + oy;
      break;
    }
    case "q": {
      out.push({ op: "Q", x1: p[0] + ox, y1: p[1] + oy, x: p[2] + ox, y: p[3] + oy });
      quadControl = { x: p[0] + ox, y: p[1] + oy };
      pen.x = p[2] + ox;
      pen.y = p[3] + oy;
      break;
    }
    case "t": {
      const previous = pen.quadControl;
      const x1 = previous ? 2 * pen.x - previous.x : pen.x;
      const y1 = previous ? 2 * pen.y - previous.y : pen.y;
      out.push({ op: "Q", x1, y1, x: p[0] + ox, y: p[1] + oy });
      quadControl = { x: x1, y: y1 };
      pen.x = p[0] + ox;
      pen.y = p[1] + oy;
      break;
    }
    case "a": {
      const x = p[5] + ox;
      const y = p[6] + oy;
      out.push(...arcToCubics(pen.x, pen.y, p[0], p[1], p[2], p[3] !== 0, p[4] !== 0, x, y));
      pen.x = x;
      pen.y = y;
      break;
    }
    case "z": {
      out.push({ op: "Z" });
      pen.x = pen.startX;
      pen.y = pen.startY;
      break;
    }
  }
  pen.cubicControl = cubicControl;
  pen.quadControl = quadControl;
}

/** Reads one command's parameters; arc flags are single digits. */
function readParameters(scanner: SvgScanner, letter: string): number[] | null {
  const count = PARAMETER_COUNTS[letter.toLowerCase()];
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const isArcFlag = letter.toLowerCase() === "a" && (i === 3 || i === 4);
    const value = isArcFlag ? scanner.readFlag() : scanner.readNumber();
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

/**
 * Parses SVG path data into absolute commands. Returns null for malformed
 * data (and never throws), so a damaged file costs one path, not the page.
 */
export function parseSvgPathData(d: string): InkPathCommand[] | null {
  const scanner = new SvgScanner(d);
  const out: InkPathCommand[] = [];
  const pen: Pen = {
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    cubicControl: null,
    quadControl: null,
  };
  let letter: string | null = null;

  for (;;) {
    scanner.skipSeparators();
    if (scanner.atEnd()) break;
    const ch = scanner.peek();
    if (/[A-Za-z]/.test(ch)) {
      if (!(ch.toLowerCase() in PARAMETER_COUNTS)) return null;
      if (out.length === 0 && ch.toLowerCase() !== "m") return null;
      scanner.advance();
      letter = ch;
    } else if (letter === null || PARAMETER_COUNTS[letter.toLowerCase()] === 0) {
      // Coordinates with no command to repeat, or after a Z.
      return null;
    }
    const parameters = readParameters(scanner, letter);
    if (!parameters) return null;
    applyPathCommand(letter, parameters, pen, out);
    // Extra coordinate pairs after a moveto are implicit linetos.
    if (letter === "M") letter = "L";
    else if (letter === "m") letter = "l";
  }

  if (out.length === 0) return null;
  return out.every(isFiniteCommand) ? out : null;
}

/** Fixed decimals with trailing zeros trimmed, and no "-0". */
export function formatNumber(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  const trimmed = text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  return trimmed === "-0" ? "0" : trimmed;
}

/**
 * Writes commands as compact `d` text: the command letter is dropped when it
 * repeats, and no space is written before a minus sign.
 */
export function formatSvgPathData(commands: InkPathCommand[], decimals = 2): string {
  let out = "";
  let previousOp = "";
  for (const command of commands) {
    const numbers: number[] =
      command.op === "Z"
        ? []
        : command.op === "M" || command.op === "L"
          ? [command.x, command.y]
          : command.op === "Q"
            ? [command.x1, command.y1, command.x, command.y]
            : [command.x1, command.y1, command.x2, command.y2, command.x, command.y];
    // A repeated M would read back as an implicit L, so it keeps its letter.
    const repeatsLetter = command.op === previousOp && command.op !== "M" && command.op !== "Z";
    if (!repeatsLetter) out += command.op;
    numbers.forEach((value, index) => {
      const text = formatNumber(value, decimals);
      const needsSpace = index > 0 || repeatsLetter;
      out += needsSpace && !text.startsWith("-") ? ` ${text}` : text;
    });
    previousOp = command.op;
  }
  return out;
}

/**
 * Calls `visit` with the quadratic's derivative root along one axis, if it is
 * inside (0, 1). Callbacks rather than arrays: bounds are taken for every
 * stroke at the lift, and a long one has hundreds of curves.
 */
function quadraticExtremum(p0: number, p1: number, p2: number, visit: (t: number) => void): void {
  const denominator = p0 - 2 * p1 + p2;
  if (denominator === 0) return;
  const t = (p0 - p1) / denominator;
  if (t > 0 && t < 1) visit(t);
}

/** Calls `visit` with each parameter in (0, 1) where a cubic's derivative along one axis is zero. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number, visit: (t: number) => void): void {
  const d0 = p1 - p0;
  const d1 = p2 - p1;
  const d2 = p3 - p2;
  const a = d0 - 2 * d1 + d2;
  const b = 2 * (d1 - d0);
  const c = d0;
  const inside = (t: number) => {
    if (t > 0 && t < 1) visit(t);
  };
  if (Math.abs(a) < 1e-12) {
    if (b !== 0) inside(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      inside((-b + root) / (2 * a));
      inside((-b - root) / (2 * a));
    }
  }
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function quadraticAt(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/**
 * The exact box of the path, including curve extrema rather than only control
 * points. A moveto that draws nothing does not count. Null when nothing is
 * drawn at all.
 */
export function inkPathBounds(commands: InkPathCommand[]): InkBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  const include = (px: number, py: number) => {
    any = true;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  };
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The subpath's start only counts once something is drawn from it.
  let startPending = false;
  const flushStart = () => {
    if (startPending) include(startX, startY);
    startPending = false;
  };

  for (const command of commands) {
    switch (command.op) {
      case "M":
        x = startX = command.x;
        y = startY = command.y;
        startPending = true;
        break;
      case "L":
        flushStart();
        include(command.x, command.y);
        x = command.x;
        y = command.y;
        break;
      case "Q": {
        flushStart();
        include(command.x, command.y);
        const at = (t: number) =>
          include(quadraticAt(x, command.x1, command.x, t), quadraticAt(y, command.y1, command.y, t));
        quadraticExtremum(x, command.x1, command.x, at);
        quadraticExtremum(y, command.y1, command.y, at);
        x = command.x;
        y = command.y;
        break;
      }
      case "C": {
        flushStart();
        include(command.x, command.y);
        const at = (t: number) =>
          include(
            cubicAt(x, command.x1, command.x2, command.x, t),
            cubicAt(y, command.y1, command.y2, command.y, t)
          );
        cubicExtrema(x, command.x1, command.x2, command.x, at);
        cubicExtrema(y, command.y1, command.y2, command.y, at);
        x = command.x;
        y = command.y;
        break;
      }
      case "Z":
        flushStart();
        x = startX;
        y = startY;
        break;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

/** Maps every point of the path through `m`. Curves stay curves under affine maps. */
export function transformInkPath(commands: InkPathCommand[], m: InkMatrix): InkPathCommand[] {
  return commands.map((command): InkPathCommand => {
    switch (command.op) {
      case "Z":
        return command;
      case "M":
      case "L": {
        const p = applyInkMatrix(m, command.x, command.y);
        return { op: command.op, x: p.x, y: p.y };
      }
      case "Q": {
        const c = applyInkMatrix(m, command.x1, command.y1);
        const p = applyInkMatrix(m, command.x, command.y);
        return { op: "Q", x1: c.x, y1: c.y, x: p.x, y: p.y };
      }
      case "C": {
        const c1 = applyInkMatrix(m, command.x1, command.y1);
        const c2 = applyInkMatrix(m, command.x2, command.y2);
        const p = applyInkMatrix(m, command.x, command.y);
        return { op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y };
      }
    }
  });
}
