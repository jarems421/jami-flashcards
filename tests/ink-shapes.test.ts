import { describe, expect, it } from "vitest";
import { inkPathBounds } from "@/lib/ink/path";
import { inkShapePath } from "@/lib/ink/shapes";

describe("inkShapePath", () => {
  it("draws a line as one segment", () => {
    expect(inkShapePath({ type: "line", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }, 4)).toEqual([
      { op: "M", x: 1, y: 2 },
      { op: "L", x: 3, y: 4 },
    ]);
  });

  it("draws a polygon closed", () => {
    const path = inkShapePath(
      {
        type: "polygon",
        corners: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
      2
    );
    expect(path.map((c) => c.op)).toEqual(["M", "L", "L", "L", "Z"]);
    expect(inkShapePath({ type: "polygon", corners: [] }, 2)).toEqual([]);
  });

  it("draws an arrow as a shaft and two head strokes at 30 degrees", () => {
    const path = inkShapePath({ type: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, 2);
    expect(path.map((c) => c.op)).toEqual(["M", "L", "M", "L", "M", "L"]);
    // Head length is 12 for thin pens, and the head hangs back from the tip.
    expect(path[3]).toMatchObject({ op: "L" });
    const first = path[3] as { x: number; y: number };
    const second = path[5] as { x: number; y: number };
    expect(Math.hypot(first.x - 100, first.y)).toBeCloseTo(12, 9);
    expect(Math.atan2(Math.abs(first.y), first.x - 100)).toBeCloseTo(Math.PI - Math.PI / 6, 9);
    expect(second.y).toBeCloseTo(-first.y, 9);
    expect(second.x).toBeCloseTo(first.x, 9);
  });

  it("grows the arrowhead with the width, but never past the shaft", () => {
    const thick = inkShapePath({ type: "arrow", from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }, 10);
    const tip = thick[3] as { x: number; y: number };
    expect(Math.hypot(tip.x - 200, tip.y)).toBeCloseTo(40, 9);
    const stubby = inkShapePath({ type: "arrow", from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }, 2);
    const stubTip = stubby[3] as { x: number; y: number };
    expect(Math.hypot(stubTip.x - 5, stubTip.y)).toBeCloseTo(5, 9);
  });

  it("draws a zero-length arrow as a dot", () => {
    expect(inkShapePath({ type: "arrow", from: { x: 5, y: 5 }, to: { x: 5, y: 5 } }, 3)).toHaveLength(2);
  });

  it("draws an ellipse as four cubic arcs", () => {
    const path = inkShapePath({ type: "ellipse", cx: 100, cy: 50, rx: 40, ry: 20, rotation: 0 }, 2);
    expect(path.map((c) => c.op)).toEqual(["M", "C", "C", "C", "C", "Z"]);
    const bounds = inkPathBounds(path);
    expect(bounds?.minX).toBeCloseTo(60, 1);
    expect(bounds?.maxX).toBeCloseTo(140, 1);
    expect(bounds?.minY).toBeCloseTo(30, 1);
    expect(bounds?.maxY).toBeCloseTo(70, 1);
  });

  it("rotates an ellipse about its centre", () => {
    const path = inkShapePath(
      { type: "ellipse", cx: 100, cy: 50, rx: 40, ry: 20, rotation: Math.PI / 2 },
      2
    );
    const bounds = inkPathBounds(path);
    expect(bounds?.minX).toBeCloseTo(80, 1);
    expect(bounds?.maxX).toBeCloseTo(120, 1);
    expect(bounds?.minY).toBeCloseTo(10, 1);
    expect(bounds?.maxY).toBeCloseTo(90, 1);
  });

  it("closes the ellipse where it starts", () => {
    const path = inkShapePath({ type: "ellipse", cx: 0, cy: 0, rx: 10, ry: 10, rotation: 0.4 }, 2);
    const start = path[0] as { x: number; y: number };
    const end = path[4] as { x: number; y: number };
    expect(end.x).toBeCloseTo(start.x, 9);
    expect(end.y).toBeCloseTo(start.y, 9);
  });
});
