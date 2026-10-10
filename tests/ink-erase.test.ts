import { describe, expect, it } from "vitest";
import { inkFlattenPath } from "@/lib/ink/flatten";
import type {
  InkDocument,
  InkItem,
  InkOutlineItem,
  InkPaint,
  InkPathCommand,
  InkPoint,
  InkShapeItem,
} from "@/lib/ink/model";
import {
  inkEraserSweepBox,
  inkItemsTouchedBySweep,
  inkPrecisionErase,
  type InkEraserSweep,
} from "@/lib/ink/tools/erase";

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const STROKE: InkPaint = {
  fill: null,
  stroke: { color: BLACK, width: 4, cap: "round", join: "round" },
  opacity: 1,
};
const FILL: InkPaint = { fill: BLACK, stroke: null, opacity: 1 };

function outline(id: string, path: InkPathCommand[], paint: InkPaint, layer: "pen" | "highlighter" = "pen"): InkOutlineItem {
  return { kind: "outline", id, layer, path, paint };
}

function polyPath(points: Array<[number, number]>, close = true): InkPathCommand[] {
  const path: InkPathCommand[] = points.map(([x, y], index) => ({ op: index === 0 ? "M" : "L", x, y }));
  if (close) path.push({ op: "Z" });
  return path;
}

function circlePath(cx: number, cy: number, r: number, sides: number): InkPathCommand[] {
  return polyPath(
    Array.from({ length: sides }, (_, i): [number, number] => [
      cx + r * Math.cos((i / sides) * Math.PI * 2),
      cy + r * Math.sin((i / sides) * Math.PI * 2),
    ])
  );
}

function doc(...items: InkItem[]): InkDocument {
  return { version: 3, items };
}

function sweepAt(radius: number, ...points: Array<[number, number]>): InkEraserSweep {
  return { points: points.map(([x, y]) => ({ x, y })), radius };
}

/** Nonzero point-in-region over every subpath of every item together. */
function filled(items: readonly InkItem[], x: number, y: number): boolean {
  let winding = 0;
  for (const item of items) {
    if (item.kind !== "outline") continue;
    for (const ring of inkFlattenPath(item.path, 0.05)) {
      const pts = ring.points;
      for (let i = 0, p = pts.length - 1; i < pts.length; p = i, i += 1) {
        const a = pts[p];
        const b = pts[i];
        const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
        if (a.y <= y) {
          if (b.y > y && side > 0) winding += 1;
        } else if (b.y <= y && side < 0) winding -= 1;
      }
    }
  }
  return winding !== 0;
}

function pointsOf(item: InkItem): InkPoint[] {
  if (item.kind !== "outline") return [];
  return inkFlattenPath(item.path, 0.05).flatMap((ring) => ring.points);
}

describe("inkEraserSweepBox", () => {
  it("covers the points grown by the radius", () => {
    expect(inkEraserSweepBox(sweepAt(3, [10, 20], [30, 5]))).toEqual({ minX: 7, minY: 2, maxX: 33, maxY: 23 });
  });
});

describe("inkItemsTouchedBySweep", () => {
  const line = outline("line", polyPath([[0, 50], [100, 50]], false), STROKE);
  const blob = outline("blob", circlePath(200, 50, 20, 48), FILL);
  const dot = outline("dot", [{ op: "M", x: 300, y: 50 }, { op: "L", x: 300, y: 50 }], STROKE);
  const unknown: InkItem = { kind: "unknown", id: "u", layerCode: 1, code: 9, payload: new Uint8Array(2) };
  const all = doc(line, blob, dot, unknown);
  const ids = all.items.map((item) => item.id);

  it("hits a stroke within radius plus half the width, and misses just outside", () => {
    // Eraser centre 6 above the line: reach is 4 + 2 = 6.
    expect(inkItemsTouchedBySweep(all, ids, sweepAt(4, [50, 44.01]))).toEqual(["line"]);
    expect(inkItemsTouchedBySweep(all, ids, sweepAt(4, [50, 43.9]))).toEqual([]);
  });

  it("hits a filled region by being inside it, or within the radius of its edge", () => {
    expect(inkItemsTouchedBySweep(all, ids, sweepAt(1, [200, 50]))).toEqual(["blob"]);
    expect(inkItemsTouchedBySweep(all, ids, sweepAt(5, [224, 50]))).toEqual(["blob"]);
    expect(inkItemsTouchedBySweep(all, ids, sweepAt(5, [226, 50]))).toEqual([]);
  });

  it("hits a swept path between its points, not just its ends", () => {
    expect(inkItemsTouchedBySweep(all, ids, sweepAt(1, [50, 0], [50, 100]))).toEqual(["line"]);
  });

  it("hits a dot, and returns ids in document order", () => {
    expect(inkItemsTouchedBySweep(all, ids, sweepAt(1, [300, 52.5]))).toEqual(["dot"]);
    expect(inkItemsTouchedBySweep(all, ids, sweepAt(400, [150, 50]))).toEqual(["line", "blob", "dot"]);
  });

  it("never touches unknown items, and skips non-candidates", () => {
    expect(inkItemsTouchedBySweep(all, ["u"], sweepAt(1000, [0, 0]))).toEqual([]);
    expect(inkItemsTouchedBySweep(all, ["blob"], sweepAt(400, [150, 50]))).toEqual(["blob"]);
  });
});

describe("inkPrecisionErase: stroked ink", () => {
  const line = outline("line", polyPath([[0, 50], [100, 50]], false), STROKE);

  it("cuts a line into two pieces whose ends sit at radius plus half the width", () => {
    const result = inkPrecisionErase(doc(line), ["line"], sweepAt(5, [50, 50]));
    const pieces = result.get("line") ?? [];
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces.map(pointsOf);
    expect(left[0]).toEqual({ x: 0, y: 50 });
    expect(left[left.length - 1].x).toBeCloseTo(43, 6);
    expect(right[0].x).toBeCloseTo(57, 6);
    expect(right[right.length - 1]).toEqual({ x: 100, y: 50 });
    for (const piece of pieces) {
      expect(piece.id).not.toBe("line");
      expect((piece as InkOutlineItem).paint).toBe(line.paint);
      expect(piece.kind === "outline" && piece.layer).toBe("pen");
    }
    expect(new Set(pieces.map((piece) => piece.id)).size).toBe(2);
  });

  it("shortens a line stamped on its end", () => {
    const pieces = inkPrecisionErase(doc(line), ["line"], sweepAt(5, [0, 50])).get("line") ?? [];
    expect(pieces).toHaveLength(1);
    const points = pointsOf(pieces[0]);
    expect(points[0].x).toBeCloseTo(7, 6);
    expect(points[points.length - 1].x).toBe(100);
  });

  it("cuts exactly at the crossing inside a segment, not at the nearest vertex", () => {
    const pieces = inkPrecisionErase(doc(line), ["line"], sweepAt(1, [10.5, 50])).get("line") ?? [];
    expect(pointsOf(pieces[0]).at(-1)?.x).toBeCloseTo(7.5, 6);
    expect(pointsOf(pieces[1])[0].x).toBeCloseTo(13.5, 6);
  });

  it("follows a swept path (a slanted pass cuts where it crosses)", () => {
    const pieces = inkPrecisionErase(doc(line), ["line"], sweepAt(2, [30, 0], [30, 100])).get("line") ?? [];
    expect(pieces).toHaveLength(2);
    expect(pointsOf(pieces[0]).at(-1)?.x).toBeCloseTo(26, 6);
    expect(pointsOf(pieces[1])[0].x).toBeCloseTo(34, 6);
  });

  it("erasing everything gives an empty array", () => {
    expect(inkPrecisionErase(doc(line), ["line"], sweepAt(200, [50, 50])).get("line")).toEqual([]);
  });

  it("drops a run that collapses inside the gap", () => {
    // A 1-unit nub left between two overlapping stamps would survive; a 0-length one must not.
    const result = inkPrecisionErase(doc(line), ["line"], sweepAt(5, [0, 50], [93, 50]));
    expect(result.get("line")).toEqual([]);
  });

  it("a miss gives an empty map; untouched and unknown items are absent", () => {
    const unknown: InkItem = { kind: "unknown", id: "u", layerCode: 1, code: 9, payload: new Uint8Array(1) };
    const d = doc(line, unknown);
    expect(inkPrecisionErase(d, ["line", "u"], sweepAt(5, [50, 80])).size).toBe(0);
    expect(inkPrecisionErase(d, ["line", "u"], sweepAt(1000, [50, 50])).has("u")).toBe(false);
  });

  it("removes a dot wholly when reached, and leaves it alone otherwise", () => {
    const dot = outline("dot", [{ op: "M", x: 30, y: 30 }, { op: "L", x: 30, y: 30 }], STROKE);
    expect(inkPrecisionErase(doc(dot), ["dot"], sweepAt(1, [30, 32])).get("dot")).toEqual([]);
    expect(inkPrecisionErase(doc(dot), ["dot"], sweepAt(1, [30, 40])).size).toBe(0);
  });

  it("a graze that removes nothing is not in the map", () => {
    expect(inkPrecisionErase(doc(line), ["line"], sweepAt(5, [50, 57])).size).toBe(0);
  });

  it("a closed subpath cut once becomes one open run across its seam", () => {
    const square = outline("sq", polyPath([[0, 0], [100, 0], [100, 100], [0, 100]]), STROKE);
    const pieces = inkPrecisionErase(doc(square), ["sq"], sweepAt(3, [50, 100])).get("sq") ?? [];
    expect(pieces).toHaveLength(1);
    const points = pointsOf(pieces[0]);
    expect(points.some((p) => p.x === 0 && p.y === 0)).toBe(true);
    expect(points.some((p) => p.x === 100 && p.y === 0)).toBe(true);
    // Open: no close command.
    expect((pieces[0] as InkOutlineItem).path.some((c) => c.op === "Z")).toBe(false);
    expect(points[0].x).toBeCloseTo(45, 6);
    expect(points.at(-1)?.x).toBeCloseTo(55, 6);
  });

  it("keeps whole the other subpaths of a touched item", () => {
    const two = outline("two", [...polyPath([[0, 0], [100, 0]], false), ...polyPath([[0, 40], [100, 40]], false)], STROKE);
    const pieces = inkPrecisionErase(doc(two), ["two"], sweepAt(2, [50, 0])).get("two") ?? [];
    expect(pieces).toHaveLength(3);
    expect(pieces.some((piece) => pointsOf(piece).length === 2 && pointsOf(piece)[0].y === 40)).toBe(true);
  });
});

describe("inkPrecisionErase: shapes", () => {
  const shape = (id: string, geometry: InkShapeItem["shape"]): InkShapeItem => ({
    kind: "shape",
    id,
    layer: "pen",
    color: { r: 10, g: 20, b: 30, a: 1 },
    width: 6,
    shape: geometry,
  });

  it("a cut line becomes stroked outlines with round caps at the shape's width and colour", () => {
    const line = shape("s", { type: "line", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
    const pieces = inkPrecisionErase(doc(line), ["s"], sweepAt(4, [50, 0])).get("s") ?? [];
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      expect(piece.kind).toBe("outline");
      expect((piece as InkOutlineItem).paint).toEqual({
        fill: null,
        stroke: { color: line.color, width: 6, cap: "round", join: "round" },
        opacity: 1,
      });
    }
    expect(pointsOf(pieces[0]).at(-1)?.x).toBeCloseTo(43, 6);
  });

  it("an ellipse cut once becomes a single open run", () => {
    const ellipse = shape("e", { type: "ellipse", cx: 100, cy: 100, rx: 50, ry: 30, rotation: 0 });
    const pieces = inkPrecisionErase(doc(ellipse), ["e"], sweepAt(3, [150, 100])).get("e") ?? [];
    expect(pieces).toHaveLength(1);
  });

  it("a stroke-eraser hit on a shape counts the shape's width", () => {
    const line = shape("s", { type: "line", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
    expect(inkItemsTouchedBySweep(doc(line), ["s"], sweepAt(2, [50, 4.9]))).toEqual(["s"]);
    expect(inkItemsTouchedBySweep(doc(line), ["s"], sweepAt(2, [50, 5.2]))).toEqual([]);
  });
});

describe("inkPrecisionErase: filled ink", () => {
  it("takes a round bite out of a filled blob", () => {
    const blob = outline("blob", circlePath(50, 50, 30, 64), FILL, "highlighter");
    const pieces = inkPrecisionErase(doc(blob), ["blob"], sweepAt(10, [80, 50])).get("blob") ?? [];
    expect(pieces).toHaveLength(1);
    expect(pieces[0].kind === "outline" && pieces[0].layer).toBe("highlighter");
    expect((pieces[0] as InkOutlineItem).paint).toBe(blob.paint);
    expect(filled(pieces, 50, 50)).toBe(true);
    expect(filled(pieces, 65, 50)).toBe(true);
    expect(filled(pieces, 75, 50)).toBe(false);
    expect(filled(pieces, 79, 50)).toBe(false);
    expect(filled(pieces, 50, 79)).toBe(true);
  });

  it("erasing a filled item entirely gives an empty array", () => {
    const blob = outline("blob", circlePath(50, 50, 10, 32), FILL);
    expect(inkPrecisionErase(doc(blob), ["blob"], sweepAt(40, [50, 50])).get("blob")).toEqual([]);
  });

  it("a bite through the middle splits a filled bar in two", () => {
    const bar = outline("bar", polyPath([[0, 0], [100, 0], [100, 10], [0, 10]]), FILL);
    const pieces = inkPrecisionErase(doc(bar), ["bar"], sweepAt(8, [50, 5])).get("bar") ?? [];
    expect(pieces).toHaveLength(2);
  });

  it("a miss gives an empty map", () => {
    const blob = outline("blob", circlePath(50, 50, 10, 32), FILL);
    expect(inkPrecisionErase(doc(blob), ["blob"], sweepAt(5, [200, 200])).size).toBe(0);
  });

  it("keeps the overlap of a ring that crosses itself with the same winding", () => {
    // Two squares joined in one ring: the 4-6 square is wound twice (nonzero fills it).
    const loop = outline(
      "loop",
      polyPath([[0, 0], [6, 0], [6, 6], [0, 6], [0, 0], [4, 4], [10, 4], [10, 10], [4, 10], [4, 4]]),
      FILL
    );
    expect(filled([loop], 5, 5)).toBe(true);
    const pieces = inkPrecisionErase(doc(loop), ["loop"], sweepAt(1, [0, 0])).get("loop") ?? [];
    expect(pieces.length).toBeGreaterThan(0);
    expect(filled(pieces, 5, 5)).toBe(true);
    expect(filled(pieces, 8, 8)).toBe(true);
    expect(filled(pieces, 3, 5)).toBe(true);
    expect(filled(pieces, 0.2, 0.2)).toBe(false);
  });

  it("keeps a hole wound against its outline", () => {
    const ring = outline(
      "ring",
      [...polyPath([[0, 0], [100, 0], [100, 100], [0, 100]]), ...polyPath([[30, 30], [30, 70], [70, 70], [70, 30]])],
      FILL
    );
    expect(filled([ring], 50, 50)).toBe(false);
    const pieces = inkPrecisionErase(doc(ring), ["ring"], sweepAt(5, [0, 0])).get("ring") ?? [];
    expect(filled(pieces, 50, 50)).toBe(false);
    expect(filled(pieces, 15, 50)).toBe(true);
    expect(filled(pieces, 1, 1)).toBe(false);
  });

  it("clips a 1,000-point outline in well under 8 ms", () => {
    const big = outline("big", circlePath(300, 300, 100, 1000), FILL);
    const d = doc(big);
    const sweep = sweepAt(10, [390, 300], [410, 310]);
    inkPrecisionErase(d, ["big"], sweep);
    let best = Infinity;
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      const result = inkPrecisionErase(d, ["big"], sweep);
      best = Math.min(best, performance.now() - start);
      expect(result.get("big")).toHaveLength(1);
    }
    expect(best).toBeLessThan(8);
  });
});
