import { describe, expect, it } from "vitest";
import { inkFlattenPath } from "@/lib/ink/flatten";
import type { InkPathCommand, InkPoint } from "@/lib/ink/model";

function distanceToPolyline(point: InkPoint, points: InkPoint[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}

function cubicPoint(p: number[], t: number): InkPoint {
  const u = 1 - t;
  const at = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return { x: at(p[0], p[2], p[4], p[6]), y: at(p[1], p[3], p[5], p[7]) };
}

describe("inkFlattenPath", () => {
  it("passes a line through untouched", () => {
    const result = inkFlattenPath(
      [
        { op: "M", x: 0, y: 0 },
        { op: "L", x: 10, y: 0 },
        { op: "L", x: 10, y: 10 },
      ],
      0.1
    );
    expect(result).toEqual([
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        closed: false,
      },
    ]);
  });

  it.each([0.5, 0.05])("keeps a cubic within %s of the curve", (tolerance) => {
    const p = [0, 0, 0, 100, 100, 100, 100, 0];
    const [polyline] = inkFlattenPath(
      [
        { op: "M", x: p[0], y: p[1] },
        { op: "C", x1: p[2], y1: p[3], x2: p[4], y2: p[5], x: p[6], y: p[7] },
      ],
      tolerance
    );
    expect(polyline.points[0]).toEqual({ x: 0, y: 0 });
    expect(polyline.points[polyline.points.length - 1]).toEqual({ x: 100, y: 0 });
    expect(polyline.points.length).toBeGreaterThan(3);
    for (let i = 0; i <= 200; i += 1) {
      expect(distanceToPolyline(cubicPoint(p, i / 200), polyline.points)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("flattens a quadratic within tolerance", () => {
    const [polyline] = inkFlattenPath(
      [
        { op: "M", x: 0, y: 0 },
        { op: "Q", x1: 50, y1: 100, x: 100, y: 0 },
      ],
      0.2
    );
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      const point = { x: 2 * (1 - t) * t * 50 + t * t * 100, y: 2 * (1 - t) * t * 100 };
      expect(distanceToPolyline(point, polyline.points)).toBeLessThanOrEqual(0.2);
    }
  });

  it("uses fewer points for a coarser tolerance", () => {
    const path: InkPathCommand[] = [
      { op: "M", x: 0, y: 0 },
      { op: "C", x1: 0, y1: 100, x2: 100, y2: 100, x: 100, y: 0 },
    ];
    const fine = inkFlattenPath(path, 0.01)[0].points.length;
    const coarse = inkFlattenPath(path, 5)[0].points.length;
    expect(coarse).toBeLessThan(fine);
  });

  it("marks a closed subpath without repeating its start", () => {
    const result = inkFlattenPath(
      [
        { op: "M", x: 0, y: 0 },
        { op: "L", x: 10, y: 0 },
        { op: "L", x: 10, y: 10 },
        { op: "Z" },
      ],
      1
    );
    expect(result).toHaveLength(1);
    expect(result[0].closed).toBe(true);
    expect(result[0].points).toHaveLength(3);
  });

  it("returns one polyline per subpath", () => {
    const result = inkFlattenPath(
      [
        { op: "M", x: 0, y: 0 },
        { op: "L", x: 1, y: 1 },
        { op: "Z" },
        { op: "M", x: 5, y: 5 },
        { op: "L", x: 6, y: 6 },
      ],
      1
    );
    expect(result.map((r) => [r.points.length, r.closed])).toEqual([
      [2, true],
      [2, false],
    ]);
  });

  it("resumes from the start point when drawing follows a close", () => {
    const result = inkFlattenPath(
      [
        { op: "M", x: 2, y: 3 },
        { op: "L", x: 4, y: 3 },
        { op: "Z" },
        { op: "L", x: 2, y: 9 },
      ],
      1
    );
    expect(result).toHaveLength(2);
    expect(result[1].points).toEqual([
      { x: 2, y: 3 },
      { x: 2, y: 9 },
    ]);
  });

  it("treats a lone moveto as a single point", () => {
    const result = inkFlattenPath(
      [
        { op: "M", x: 7, y: 8 },
        { op: "M", x: 1, y: 2 },
      ],
      1
    );
    expect(result).toEqual([
      { points: [{ x: 7, y: 8 }], closed: false },
      { points: [{ x: 1, y: 2 }], closed: false },
    ]);
  });

  it("handles degenerate input", () => {
    expect(inkFlattenPath([], 1)).toEqual([]);
    expect(inkFlattenPath([{ op: "L", x: 1, y: 1 }, { op: "Z" }], 1)).toEqual([]);
    // A zero or NaN tolerance must still finish, and the depth cap bounds the work.
    for (const tolerance of [0, -1, Number.NaN]) {
      const [polyline] = inkFlattenPath(
        [
          { op: "M", x: 0, y: 0 },
          { op: "C", x1: 0, y1: 500, x2: 500, y2: 500, x: 500, y: 0 },
        ],
        tolerance
      );
      expect(polyline.points.length).toBeGreaterThan(2);
      expect(polyline.points.length).toBeLessThanOrEqual(4097);
    }
  });

  it("copes with a curve whose controls sit on its chord", () => {
    const [polyline] = inkFlattenPath(
      [
        { op: "M", x: 0, y: 0 },
        { op: "C", x1: 30, y1: 0, x2: -20, y2: 0, x: 10, y: 0 },
      ],
      0.1
    );
    expect(polyline.points[polyline.points.length - 1]).toEqual({ x: 10, y: 0 });
    expect(polyline.points.length).toBeGreaterThan(2);
  });
});
