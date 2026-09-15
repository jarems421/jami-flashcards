import { describe, expect, it } from "vitest";
import { clipGraphPolyline, compileGraphExpression, sampleGraphFunction } from "@/lib/math/graph-expression";

const at = (source: string, x: number, angle: "degrees" | "radians" = "radians") => {
  const compiled = compileGraphExpression(source, angle);
  if (!compiled.ok) throw new Error(compiled.error);
  return compiled.evaluate(x);
};

describe("compileGraphExpression", () => {
  it("reads functions written the way they are on paper", () => {
    expect(at("y = 2x² − 3x + 1", 2)).toBe(3);
    expect(at("3(x + 1)", 2)).toBe(9);
    expect(at("x(x - 4)", 5)).toBe(5);
    expect(at("f(x) = x^3 - 2", 2)).toBe(6);
    expect(at("|x - 3|", 1)).toBe(2);
    expect(at("√x", 9)).toBe(3);
    expect(at("2^x", 3)).toBe(8);
    expect(at("x³ − 3x", 2)).toBe(2);
  });

  it("follows the order of operations a student expects", () => {
    expect(at("-x^2", 3)).toBe(-9);
    expect(at("2^3^2", 0)).toBe(512);
    expect(at("6 / 2 * 3", 0)).toBe(9);
    expect(at("1 - 2 - 3", 0)).toBe(-4);
  });

  it("works trig in degrees for GCSE graphs, and in radians when asked", () => {
    expect(at("sin x", 90, "degrees")).toBeCloseTo(1, 10);
    expect(at("cos(x)", 180, "degrees")).toBeCloseTo(-1, 10);
    expect(at("sin(x)", Math.PI / 2)).toBeCloseTo(1, 10);
    expect(at("2πx", 1)).toBeCloseTo(2 * Math.PI, 10);
    expect(at("ln(e)", 0)).toBeCloseTo(1, 10);
  });

  it("returns a gap rather than a number where the function is undefined", () => {
    expect(Number.isNaN(at("1/x", 0))).toBe(true);
    expect(Number.isNaN(at("sqrt(x)", -1))).toBe(true);
  });

  it("refuses anything that is not a function of x, without running it", () => {
    for (const source of ["", "alert(1)", "x +", "(x + 1", "2 ** x", "y", "process.exit()"]) {
      expect(compileGraphExpression(source).ok, source).toBe(false);
    }
  });
});

describe("sampleGraphFunction", () => {
  const view = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };

  it("draws a straight line as one piece", () => {
    const compiled = compileGraphExpression("2x + 1");
    if (!compiled.ok) throw new Error(compiled.error);
    expect(sampleGraphFunction(compiled.evaluate, view, 100)).toHaveLength(1);
  });

  it("breaks 1/x at its asymptote instead of joining the branches", () => {
    const compiled = compileGraphExpression("1/x");
    if (!compiled.ok) throw new Error(compiled.error);
    const segments = sampleGraphFunction(compiled.evaluate, view, 101);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments.every((segment) => segment.every((point) => Math.sign(point.x) === Math.sign(segment[0].x)))).toBe(true);
  });
});

describe("clipGraphPolyline", () => {
  const view = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

  it("cuts a curve exactly where it leaves the view, and keeps what is inside", () => {
    const compiled = compileGraphExpression("x^2");
    if (!compiled.ok) throw new Error(compiled.error);
    const pieces = sampleGraphFunction(compiled.evaluate, view, 400).flatMap((segment) => clipGraphPolyline(segment, view));
    expect(pieces).toHaveLength(1);
    const piece = pieces[0]!;
    expect(piece.every((point) => point.y >= -10 - 1e-9 && point.y <= 10 + 1e-9)).toBe(true);
    // x² reaches 10 at ±√10.
    expect(piece[0]!.y).toBeCloseTo(10, 6);
    expect(piece[0]!.x).toBeCloseTo(-Math.sqrt(10), 2);
    expect(piece.at(-1)!.x).toBeCloseTo(Math.sqrt(10), 2);
  });

  it("draws nothing for a curve entirely outside the view", () => {
    expect(clipGraphPolyline([{ x: -10, y: 20 }, { x: 10, y: 30 }], view)).toEqual([]);
  });

  it("keeps the part of a line that crosses the view from outside to outside", () => {
    expect(clipGraphPolyline([{ x: -20, y: 0 }, { x: 20, y: 0 }], view)).toEqual([
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
    ]);
  });
});
