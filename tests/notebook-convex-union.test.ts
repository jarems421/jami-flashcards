import { describe, expect, it } from "vitest";
import {
  getNotebookPolygonArea,
  unionOfConvexPolygons,
  unionOfConvexPolygonsWithHoles,
  type NotebookUnionPoint,
} from "@/lib/ink/geometry/convex-union";

const square = (
  left: number,
  top: number,
  size: number
): NotebookUnionPoint[] => [
  { x: left, y: top },
  { x: left + size, y: top },
  { x: left + size, y: top + size },
  { x: left, y: top + size },
];

const hasPoint = (
  outline: NotebookUnionPoint[],
  point: NotebookUnionPoint
) =>
  outline.some(
    (candidate) =>
      Math.abs(candidate.x - point.x) < 1e-6 &&
      Math.abs(candidate.y - point.y) < 1e-6
  );

/** Four bars enclosing an empty 10 x 10 middle. */
const ring: NotebookUnionPoint[][] = [
  [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 10 },
    { x: 0, y: 10 },
  ],
  [
    { x: 0, y: 20 },
    { x: 30, y: 20 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
  ],
  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 30 },
    { x: 0, y: 30 },
  ],
  [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 30 },
    { x: 20, y: 30 },
  ],
];

/** The nonzero winding number of `point` against every loop, as a canvas fills them. */
function windingAt(loops: readonly NotebookUnionPoint[][], point: NotebookUnionPoint) {
  let winding = 0;
  for (const loop of loops) {
    for (let index = 0; index < loop.length; index += 1) {
      const from = loop[index];
      const to = loop[(index + 1) % loop.length];
      const side = (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y);
      if (from.y <= point.y && to.y > point.y && side > 0) winding += 1;
      else if (from.y > point.y && to.y <= point.y && side < 0) winding -= 1;
    }
  }
  return winding;
}

describe("unionOfConvexPolygonsWithHoles", () => {
  it("keeps the middle of a ring empty, so a highlighter round a word does not cover it", () => {
    const loops = unionOfConvexPolygonsWithHoles(ring);
    expect(loops).not.toBeNull();
    expect(loops).toHaveLength(2);
    expect(getNotebookPolygonArea(loops![0])).toBeCloseTo(900, 6);
    expect(getNotebookPolygonArea(loops![1])).toBeCloseTo(-100, 6);
    expect(windingAt(loops!, { x: 15, y: 15 })).toBe(0);
    expect(windingAt(loops!, { x: 5, y: 15 })).not.toBe(0);
    expect(windingAt(loops!, { x: 15, y: 25 })).not.toBe(0);
  });

  it("is the outer boundary alone when there is no hole", () => {
    const loops = unionOfConvexPolygonsWithHoles([square(0, 0, 10), square(5, 0, 10)]);
    expect(loops).toHaveLength(1);
    expect(getNotebookPolygonArea(loops![0])).toBeCloseTo(150, 6);
  });

  it("leaves no sliver behind where footprints share an edge", () => {
    const loops = unionOfConvexPolygonsWithHoles([square(0, 0, 10), square(10, 0, 10), square(20, 0, 10)]);
    expect(loops).toHaveLength(1);
    expect(getNotebookPolygonArea(loops![0])).toBeCloseTo(300, 6);
  });

  it("is a lone polygon as it is, and null for nothing", () => {
    expect(unionOfConvexPolygonsWithHoles([square(0, 0, 10)])).toHaveLength(1);
    expect(unionOfConvexPolygonsWithHoles([])).toBeNull();
  });
});

describe("unionOfConvexPolygons", () => {
  it("returns a single polygon unchanged", () => {
    const outline = unionOfConvexPolygons([square(0, 0, 10)]);
    expect(outline).not.toBeNull();
    expect(Math.abs(getNotebookPolygonArea(outline!))).toBeCloseTo(100, 6);
  });

  it("traces two overlapping squares as one loop with the union's area", () => {
    const outline = unionOfConvexPolygons([square(0, 0, 10), square(5, 0, 10)]);
    expect(outline).not.toBeNull();
    // 10x10 plus 10x10 less the 5x10 they share.
    expect(Math.abs(getNotebookPolygonArea(outline!))).toBeCloseTo(150, 6);
  });

  it("keeps the outline free of points inside the union", () => {
    const outline = unionOfConvexPolygons([square(0, 0, 10), square(5, 0, 10)]);
    expect(outline).not.toBeNull();
    // The corners swallowed by the other square must not survive.
    expect(hasPoint(outline!, { x: 5, y: 0 })).toBe(true);
    expect(hasPoint(outline!, { x: 10, y: 5 })).toBe(false);
  });

  it("traces abutting squares that share only an edge", () => {
    const outline = unionOfConvexPolygons([square(0, 0, 10), square(10, 0, 10)]);
    expect(outline).not.toBeNull();
    expect(Math.abs(getNotebookPolygonArea(outline!))).toBeCloseTo(200, 6);
  });

  it("traces a chain of overlapping footprints, as a straight highlight makes", () => {
    const footprints = Array.from({ length: 12 }, (_, index) =>
      square(index * 6, 0, 10)
    );
    const outline = unionOfConvexPolygons(footprints);
    expect(outline).not.toBeNull();
    // 11 steps of 6 plus the final footprint's own width, all 10 tall.
    expect(Math.abs(getNotebookPolygonArea(outline!))).toBeCloseTo(
      (11 * 6 + 10) * 10,
      6
    );
  });

  it("traces a chain that turns, as a curved highlight makes", () => {
    const footprints = [
      square(0, 0, 10),
      square(6, 0, 10),
      square(12, 0, 10),
      square(12, 6, 10),
      square(12, 12, 10),
    ];
    const outline = unionOfConvexPolygons(footprints);
    expect(outline).not.toBeNull();
    expect(Math.abs(getNotebookPolygonArea(outline!))).toBeCloseTo(
      // A 22x10 arm and a 10x22 leg, sharing the 10x10 corner between them.
      22 * 10 + 10 * 22 - 10 * 10,
      6
    );
  });

  it("traces only the outer boundary, so a ring comes back as the disc it surrounds", () => {
    const outline = unionOfConvexPolygons(ring);
    expect(outline).not.toBeNull();
    expect(Math.abs(getNotebookPolygonArea(outline!))).toBeCloseTo(900, 6);
  });

  it("rejects input it cannot trace instead of returning a wrong shape", () => {
    expect(unionOfConvexPolygons([])).toBeNull();
    expect(unionOfConvexPolygons([[{ x: 0, y: 0 }, { x: 1, y: 1 }]])).toBeNull();
    expect(
      unionOfConvexPolygons([
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 10, y: 0 },
        ],
      ])
    ).toBeNull();
  });

  it("accepts either winding, since the caller's hull order is not guaranteed", () => {
    const clockwise = [...square(0, 0, 10)].reverse();
    const outline = unionOfConvexPolygons([clockwise, square(5, 0, 10)]);
    expect(outline).not.toBeNull();
    expect(Math.abs(getNotebookPolygonArea(outline!))).toBeCloseTo(150, 6);
  });
});
