import type { InkPoint } from "@/lib/ink/model";
import { SvgScanner } from "@/lib/ink/svg-scan";

/** An affine transform in SVG's `matrix(a b c d e f)` order. */
export type InkMatrix = { a: number; b: number; c: number; d: number; e: number; f: number };

export const identityInkMatrix: InkMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `multiply(m1, m2)` applies `m2` first, like `transform="m1 m2"` in SVG. */
export function multiplyInkMatrix(m1: InkMatrix, m2: InkMatrix): InkMatrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function applyInkMatrix(m: InkMatrix, x: number, y: number): InkPoint {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

const DEGREES = Math.PI / 180;

function translation(tx: number, ty: number): InkMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

function functionMatrix(name: string, args: number[]): InkMatrix | null {
  const count = args.length;
  switch (name) {
    case "matrix":
      return count === 6
        ? { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] }
        : null;
    case "translate":
      return count === 1 || count === 2 ? translation(args[0], count === 2 ? args[1] : 0) : null;
    case "scale":
      return count === 1 || count === 2
        ? { a: args[0], b: 0, c: 0, d: count === 2 ? args[1] : args[0], e: 0, f: 0 }
        : null;
    case "rotate": {
      if (count !== 1 && count !== 3) return null;
      const angle = args[0] * DEGREES;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotation: InkMatrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (count === 1) return rotation;
      // Rotation about (cx, cy): move the centre to the origin, rotate, move back.
      return multiplyInkMatrix(
        multiplyInkMatrix(translation(args[1], args[2]), rotation),
        translation(-args[1], -args[2])
      );
    }
    case "skewX":
      return count === 1 ? { a: 1, b: 0, c: Math.tan(args[0] * DEGREES), d: 1, e: 0, f: 0 } : null;
    case "skewY":
      return count === 1 ? { a: 1, b: Math.tan(args[0] * DEGREES), c: 0, d: 1, e: 0, f: 0 } : null;
    default:
      return null;
  }
}

/**
 * Parses an SVG `transform` attribute (matrix, translate, scale, rotate with
 * an optional centre, skewX, skewY, and lists of them). Empty text is the
 * identity. Anything malformed, or non-finite after combining, gives null.
 */
export function parseSvgTransform(text: string): InkMatrix | null {
  const scanner = new SvgScanner(text);
  let result = identityInkMatrix;
  for (;;) {
    scanner.skipSeparators();
    if (scanner.atEnd()) break;
    const name = scanner.readWord();
    if (name === "" || !scanner.expect("(")) return null;
    const args: number[] = [];
    for (;;) {
      scanner.skipSeparators();
      if (scanner.peek() === ")") {
        scanner.advance();
        break;
      }
      const value = scanner.readNumber();
      if (value === null) return null;
      args.push(value);
    }
    const matrix = functionMatrix(name, args);
    if (!matrix) return null;
    result = multiplyInkMatrix(result, matrix);
  }
  const finite = [result.a, result.b, result.c, result.d, result.e, result.f].every(Number.isFinite);
  return finite ? result : null;
}
