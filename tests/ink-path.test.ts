import { describe, expect, it } from "vitest";
import type { InkPathCommand } from "@/lib/ink/model";
import {
  formatSvgPathData,
  identityInkMatrix,
  inkPathBounds,
  multiplyInkMatrix,
  parseSvgPathData,
  parseSvgTransform,
  transformInkPath,
} from "@/lib/ink/path";
import { applyInkMatrix } from "@/lib/ink/matrix";
import { seededRandom } from "./support/ink-fixtures";

function parse(d: string): InkPathCommand[] {
  const commands = parseSvgPathData(d);
  if (!commands) throw new Error(`Expected "${d}" to parse.`);
  return commands;
}

describe("parseSvgPathData", () => {
  it("reads absolute and relative lines, h, v and z", () => {
    expect(parse("M10 10 L20 10 l0 5 H5 h-2 V30 v-1 Z")).toEqual([
      { op: "M", x: 10, y: 10 },
      { op: "L", x: 20, y: 10 },
      { op: "L", x: 20, y: 15 },
      { op: "L", x: 5, y: 15 },
      { op: "L", x: 3, y: 15 },
      { op: "L", x: 3, y: 30 },
      { op: "L", x: 3, y: 29 },
      { op: "Z" },
    ]);
  });

  it("treats extra pairs after a moveto as linetos", () => {
    expect(parse("M0 0 10 10 20 0")).toEqual([
      { op: "M", x: 0, y: 0 },
      { op: "L", x: 10, y: 10 },
      { op: "L", x: 20, y: 0 },
    ]);
    expect(parse("m1 1 2 2 3 3")).toEqual([
      { op: "M", x: 1, y: 1 },
      { op: "L", x: 3, y: 3 },
      { op: "L", x: 6, y: 6 },
    ]);
  });

  it("repeats curve commands with implicit parameters", () => {
    expect(parse("M0 0 c1 1 2 2 3 3 4 4 5 5 6 6")).toEqual([
      { op: "M", x: 0, y: 0 },
      { op: "C", x1: 1, y1: 1, x2: 2, y2: 2, x: 3, y: 3 },
      { op: "C", x1: 7, y1: 7, x2: 8, y2: 8, x: 9, y: 9 },
    ]);
  });

  it("reads every number form", () => {
    expect(parse("M1e-3 2E+1 L.5.5 -1-2 +3 4")).toEqual([
      { op: "M", x: 0.001, y: 20 },
      { op: "L", x: 0.5, y: 0.5 },
      { op: "L", x: -1, y: -2 },
      { op: "L", x: 3, y: 4 },
    ]);
    expect(parse("M,1,,2,L,3 ,4")).toEqual([
      { op: "M", x: 1, y: 2 },
      { op: "L", x: 3, y: 4 },
    ]);
    expect(parse("M0 0L1.5.25")).toEqual([
      { op: "M", x: 0, y: 0 },
      { op: "L", x: 1.5, y: 0.25 },
    ]);
  });

  it("reflects control points for S and T", () => {
    expect(parse("M0 0 C10 0 20 10 20 20 S30 40 40 40")[2]).toEqual({
      op: "C",
      x1: 20,
      y1: 30,
      x2: 30,
      y2: 40,
      x: 40,
      y: 40,
    });
    expect(parse("M0 0 S5 5 10 10")[1]).toEqual({ op: "C", x1: 0, y1: 0, x2: 5, y2: 5, x: 10, y: 10 });
    expect(parse("M0 0 Q10 10 20 0 T40 0")[2]).toEqual({ op: "Q", x1: 30, y1: -10, x: 40, y: 0 });
    // T after a T keeps reflecting the control point it just made.
    expect(parse("M0 0 Q10 10 20 0 T40 0 T60 0")[3]).toEqual({ op: "Q", x1: 50, y1: 10, x: 60, y: 0 });
    // A line between breaks the chain.
    expect(parse("M0 0 Q10 10 20 0 L30 0 T40 0")[3]).toEqual({ op: "Q", x1: 30, y1: 0, x: 40, y: 0 });
  });

  it("measures relative commands from the subpath start after z", () => {
    expect(parse("M5 5 L10 5 Z l1 1")[3]).toEqual({ op: "L", x: 6, y: 6 });
    expect(parse("M5 5 L10 5 z m1 1")[3]).toEqual({ op: "M", x: 6, y: 6 });
  });

  it("converts arcs to cubics that end on the endpoint", () => {
    const semicircle = parse("M0 0 A50 50 0 0 1 100 0");
    expect(semicircle.slice(1).every((c) => c.op === "C")).toBe(true);
    expect(semicircle).toHaveLength(3);
    expect(semicircle[2]).toMatchObject({ x: 100, y: 0 });
    const bounds = inkPathBounds(semicircle);
    expect(bounds?.minY).toBeCloseTo(-50, 1);
    expect(bounds?.maxY).toBeCloseTo(0, 6);
    expect(bounds?.minX).toBeCloseTo(0, 6);
    expect(bounds?.maxX).toBeCloseTo(100, 6);
  });

  it("honours the large-arc and sweep flags", () => {
    const sweepBottom = inkPathBounds(parse("M0 0 A50 50 0 0 0 100 0"));
    expect(sweepBottom?.maxY).toBeCloseTo(50, 1);
    const large = inkPathBounds(parse("M0 0 A50 50 0 1 1 50 50"));
    // Centre (50, 0): three quarters of the circle, round the top and the right.
    expect(large?.minX).toBeCloseTo(0, 1);
    expect(large?.minY).toBeCloseTo(-50, 1);
    expect(large?.maxX).toBeCloseTo(100, 1);
    expect(large?.maxY).toBeCloseTo(50, 1);
  });

  it("splits a 270 degree sweep into three cubics", () => {
    const threeQuarters = parse("M50 0 A50 50 0 1 1 0 50");
    expect(threeQuarters).toHaveLength(4); // the moveto and three cubics
  });

  it("reads arc flags written without separators", () => {
    expect(parse("M0 0a50 50 0 1150 0")).toEqual(parse("M0 0a50 50 0 1 1 50 0"));
    expect(parse("M0 0A25 25 0 0150 0")).toEqual(parse("M0 0A25 25 0 0 1 50 0"));
  });

  it("scales up radii that are too small", () => {
    const bounds = inkPathBounds(parse("M0 0 A1 1 0 0 1 100 0"));
    expect(bounds?.minY).toBeCloseTo(-50, 1);
  });

  it("turns zero radii into lines and ignores arcs to the same point", () => {
    expect(parse("M0 0 A0 5 0 0 1 10 10")).toEqual([
      { op: "M", x: 0, y: 0 },
      { op: "L", x: 10, y: 10 },
    ]);
    expect(parse("M3 3 A5 5 0 0 1 3 3")).toEqual([{ op: "M", x: 3, y: 3 }]);
  });

  it("rotates elliptical arcs", () => {
    const bounds = inkPathBounds(parse("M0 0 A100 20 90 0 1 40 0"));
    // Rotated a quarter turn, the 100-long axis runs vertically.
    expect((bounds?.maxY ?? 0) - (bounds?.minY ?? 0)).toBeGreaterThan(80);
  });

  it("returns null for malformed data and never throws", () => {
    const bad = [
      "",
      "   ",
      "L1 1",
      "M",
      "M1",
      "M1 1 L2",
      "M1 1 X",
      "M1 1 Z 5",
      "M1e999 0",
      "M0 0 A1 1 0 2 0 5 5",
      "M0 0 L1 1 $",
      "M0 0 1e",
      "5 5",
    ];
    for (const d of bad) expect(parseSvgPathData(d)).toBeNull();
  });
});

describe("formatSvgPathData", () => {
  it("writes compact path text", () => {
    expect(
      formatSvgPathData([
        { op: "M", x: 1, y: 2 },
        { op: "L", x: 3.5, y: -4 },
        { op: "L", x: 0.126, y: -0 },
        { op: "Z" },
      ])
    ).toBe("M1 2L3.5-4 0.13 0Z");
  });

  it("honours the decimals argument", () => {
    expect(formatSvgPathData([{ op: "M", x: 1.23456, y: 2 }], 3)).toBe("M1.235 2");
    expect(formatSvgPathData([{ op: "M", x: 1.6, y: 2 }], 0)).toBe("M2 2");
  });

  it("keeps the letter on a repeated moveto", () => {
    const commands: InkPathCommand[] = [
      { op: "M", x: 0, y: 0 },
      { op: "M", x: 5, y: 5 },
      { op: "L", x: 6, y: 6 },
    ];
    expect(parse(formatSvgPathData(commands))).toEqual(commands);
  });

  it("round-trips random paths within rounding", () => {
    const random = seededRandom(5);
    const value = () => (random() - 0.3) * 2000;
    for (let i = 0; i < 100; i += 1) {
      const commands: InkPathCommand[] = [{ op: "M", x: value(), y: value() }];
      for (let c = 0; c < 10; c += 1) {
        const kind = Math.floor(random() * 4);
        if (kind === 0) commands.push({ op: "L", x: value(), y: value() });
        else if (kind === 1) commands.push({ op: "Q", x1: value(), y1: value(), x: value(), y: value() });
        else if (kind === 2) {
          commands.push({ op: "C", x1: value(), y1: value(), x2: value(), y2: value(), x: value(), y: value() });
        } else commands.push({ op: "Z" });
      }
      const back = parse(formatSvgPathData(commands, 2));
      expect(back).toHaveLength(commands.length);
      back.forEach((command, index) => {
        const original = commands[index];
        expect(command.op).toBe(original.op);
        for (const [key, number] of Object.entries(original)) {
          if (typeof number === "number") {
            expect((command as unknown as Record<string, number>)[key]).toBeCloseTo(number, 1);
          }
        }
      });
    }
  });
});

describe("inkPathBounds", () => {
  it("finds cubic extrema, not just control points", () => {
    const bounds = inkPathBounds(parse("M0 0 C0 100 100 100 100 0"));
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 75 });
  });

  it("finds quadratic extrema", () => {
    expect(inkPathBounds(parse("M0 0 Q50 100 100 0"))).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
  });

  it("finds curves that bulge past both ends", () => {
    const bounds = inkPathBounds(parse("M0 0 C-50 10 150 10 100 0"));
    expect(bounds?.minX).toBeLessThan(-5);
    expect(bounds?.maxX).toBeGreaterThan(105);
  });

  it("ignores a moveto that draws nothing, and empty paths", () => {
    expect(inkPathBounds(parse("M-100 -100 M0 0 L10 10 M500 500"))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    });
    expect(inkPathBounds(parse("M5 5"))).toBeNull();
    expect(inkPathBounds([])).toBeNull();
  });

  it("includes a closing subpath's start", () => {
    expect(inkPathBounds(parse("M0 0 Z"))).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe("transforms", () => {
  const at = (text: string, x: number, y: number) => {
    const matrix = parseSvgTransform(text);
    if (!matrix) throw new Error(`Expected "${text}" to parse.`);
    return applyInkMatrix(matrix, x, y);
  };

  it("reads each transform function", () => {
    expect(at("translate(10 20)", 1, 1)).toEqual({ x: 11, y: 21 });
    expect(at("translate(5)", 1, 1)).toEqual({ x: 6, y: 1 });
    expect(at("scale(2)", 3, 4)).toEqual({ x: 6, y: 8 });
    expect(at("scale(2,3)", 3, 4)).toEqual({ x: 6, y: 12 });
    expect(at("matrix(1 0 0 1 5 6)", 1, 1)).toEqual({ x: 6, y: 7 });
    expect(at("matrix(2,0,0,2,0,0)", 1, 1)).toEqual({ x: 2, y: 2 });
  });

  it("rotates about the origin or a centre", () => {
    const quarter = at("rotate(90)", 1, 0);
    expect(quarter.x).toBeCloseTo(0, 9);
    expect(quarter.y).toBeCloseTo(1, 9);
    const about = at("rotate(90 10 10)", 20, 10);
    expect(about.x).toBeCloseTo(10, 9);
    expect(about.y).toBeCloseTo(20, 9);
  });

  it("skews", () => {
    expect(at("skewX(45)", 0, 1).x).toBeCloseTo(1, 9);
    expect(at("skewY(45)", 1, 0).y).toBeCloseTo(1, 9);
  });

  it("applies lists right to left, like SVG", () => {
    expect(at("translate(10 20) scale(2)", 1, 1)).toEqual({ x: 12, y: 22 });
    expect(at("scale(2) translate(10 20)", 1, 1)).toEqual({ x: 22, y: 42 });
    expect(at("translate(1,2),scale(3)", 1, 1)).toEqual({ x: 4, y: 5 });
  });

  it("treats empty text as the identity", () => {
    expect(parseSvgTransform("")).toEqual(identityInkMatrix);
    expect(parseSvgTransform("  ")).toEqual(identityInkMatrix);
  });

  it("returns null for malformed transforms", () => {
    for (const bad of ["rotate(1 2)", "foo(1)", "translate(", "translate(1) junk", "scale()", "matrix(1 2 3)", "translate(a)"]) {
      expect(parseSvgTransform(bad)).toBeNull();
    }
  });

  it("multiplies so the right-hand matrix applies first", () => {
    const move = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 };
    const grow = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    expect(applyInkMatrix(multiplyInkMatrix(move, grow), 1, 1)).toEqual({ x: 12, y: 2 });
    expect(multiplyInkMatrix(identityInkMatrix, grow)).toEqual(grow);
  });

  it("transforms every point of a path, controls included", () => {
    const path = parse("M0 0 C1 1 2 2 3 3 Q4 4 5 5 L6 6 Z");
    const scaled = transformInkPath(path, { a: 2, b: 0, c: 0, d: 3, e: 1, f: 1 });
    expect(scaled).toEqual([
      { op: "M", x: 1, y: 1 },
      { op: "C", x1: 3, y1: 4, x2: 5, y2: 7, x: 7, y: 10 },
      { op: "Q", x1: 9, y1: 13, x: 11, y: 16 },
      { op: "L", x: 13, y: 19 },
      { op: "Z" },
    ]);
  });
});
