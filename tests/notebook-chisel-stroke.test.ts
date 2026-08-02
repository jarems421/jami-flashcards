// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import type { Point2, Stroke, StrokeDataPoint } from "js-draw";
import { createNotebookChiselStrokeFactory } from "@/lib/workspace/notebook-chisel-stroke";
import { loadJsDraw, type JsDrawModule } from "@/lib/workspace/notebook-js-draw";

/**
 * The highlighter's whole character is its geometry, so these assert the shape
 * rather than that a stroke was produced at all. A round nib would pass "a
 * path came back"; only the outline distinguishes the two.
 */
let jsDraw: JsDrawModule;

beforeAll(async () => {
  jsDraw = await loadJsDraw();
}, 120_000);

const NIB_ANGLE_DEGREES = 65;
const STROKE_WIDTH = 20;

function point(x: number, y: number): StrokeDataPoint {
  return {
    pos: jsDraw.Vec2.of(x, y),
    width: STROKE_WIDTH,
    color: jsDraw.Color4.fromString("#ffd400"),
    time: 0,
  };
}

/** Fine enough that the tests' own samples are not filtered as hand tremor. */
const viewport = { getSizeOfPixelOnCanvas: () => 0.01 } as never;

function buildStroke(points: StrokeDataPoint[]): Stroke {
  const builder = createNotebookChiselStrokeFactory(jsDraw)(points[0], viewport);
  for (const next of points.slice(1)) builder.addPoint(next);

  const built = builder.build();
  if (!(built instanceof jsDraw.Stroke)) {
    throw new Error("The chisel builder should produce a Stroke.");
  }
  return built;
}

/** The outline's corner points, in the order the path visits them. */
function outlineOf(points: StrokeDataPoint[]): Point2[] {
  const path = buildStroke(points).getParts()[0].path;
  const corners: Point2[] = [path.startPoint];

  for (const part of path.parts) {
    corners.push(
      part.kind === jsDraw.PathCommandType.MoveTo ||
        part.kind === jsDraw.PathCommandType.LineTo
        ? part.point
        : part.endPoint
    );
  }
  return corners;
}

/** A half circle, which turns through every direction and so must cross the
 * nib's axis whatever angle the nib is set to. */
function halfCircle(): StrokeDataPoint[] {
  return Array.from({ length: 36 }, (_, step) => {
    const t = (step / 35) * Math.PI;
    return point(100 + Math.cos(t) * 80, Math.sin(t) * 80);
  });
}

describe("chisel highlighter geometry", () => {
  /**
   * How wide the stroke actually is, across its direction of travel. A
   * bounding box cannot be used: for a diagonal stroke it measures the travel
   * rather than the mark.
   */
  function perpendicularThickness(from: [number, number], to: [number, number]) {
    const outline = outlineOf([point(...from), point(...to)]);
    const axis = jsDraw.Vec2.of(to[0] - from[0], to[1] - from[1]).normalized();
    const across = outline.map(
      (corner) => corner.x * -axis.y + corner.y * axis.x
    );
    return Math.max(...across) - Math.min(...across);
  }

  it("offsets along a fixed nib angle rather than perpendicular to travel", () => {
    const radians = (NIB_ANGLE_DEGREES * Math.PI) / 180;
    const horizontal = perpendicularThickness([0, 0], [100, 0]);
    const alongNib = perpendicularThickness(
      [0, 0],
      [100 * Math.cos(radians), 100 * Math.sin(radians)]
    );

    // A round nib would make these identical. A chisel is broad across its
    // edge and narrow along it, which is the whole point.
    expect(horizontal).toBeGreaterThan(alongNib * 4);
  });

  it("still lays down its narrow side when running along the nib", () => {
    // The break mid-curve was this going to zero. A bare flat edge sweeps no
    // area at all in the one direction it is lined up with; a real tip is a
    // rectangle and always leaves at least its thickness.
    const radians = (NIB_ANGLE_DEGREES * Math.PI) / 180;
    const alongNib = perpendicularThickness(
      [0, 0],
      [100 * Math.cos(radians), 100 * Math.sin(radians)]
    );

    expect(alongNib).toBeCloseTo(STROKE_WIDTH * 0.2, 1);
  });

  it("keeps close to the full thickness on an ordinary horizontal sweep", () => {
    const outline = outlineOf([point(0, 0), point(120, 0)]);
    const ys = outline.map((corner) => corner.y);
    const spread = Math.max(...ys) - Math.min(...ys);

    // Essentially the nominal thickness: the nib is steep enough that an
    // ordinary sweep meets it nearly broadside.
    expect(spread).toBeCloseTo(STROKE_WIDTH, 0);
  });

  it("ends on a slant, which is what reads as a highlighter", () => {
    const outline = outlineOf([point(0, 0), point(120, 0)]);
    // How far the top of the leading end overhangs the bottom of it. A round
    // nib ends square and would give zero here; a chisel ends on the skew.
    const upper = Math.max(
      ...outline.filter((corner) => corner.y > 0).map((corner) => corner.x)
    );
    const lower = Math.max(
      ...outline.filter((corner) => corner.y < 0).map((corner) => corner.x)
    );

    expect(upper - lower).toBeCloseTo(
      STROKE_WIDTH * Math.cos((NIB_ANGLE_DEGREES * Math.PI) / 180),
      0
    );
  });

  it("draws a visible mark for a tap, where a flat edge alone would not", () => {
    const box = buildStroke([point(50, 50)]).getBBox();

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("produces a filled path, so overlaps within one stroke do not darken", () => {
    const style = buildStroke([point(0, 0), point(60, 0)]).getParts()[0].style;

    expect(style.fill.a).toBeGreaterThan(0);
    expect(style.stroke).toBeUndefined();
  });
});

/**
 * The stroke used to break apart where it doubled back: mid-curve at first,
 * and as a mesh of holes where one continuous motion crossed itself. Both had
 * the same cause. A single outline around the whole stroke is only valid while
 * the path stays on one side of the nib's axis and never turns tighter than
 * the nib reaches; past either limit it folds through itself and the crossed
 * region takes a winding number of zero, punching it out of the fill.
 *
 * Sweeping each step as its own parallelogram removes the possibility instead
 * of handling the cases, and these pin that structure.
 */
describe("never eating a hole in itself", () => {
  /** The outline split back into its subpaths. */
  function subpathsOf(points: StrokeDataPoint[]): Point2[][] {
    const path = buildStroke(points).getParts()[0].path;
    const subpaths: Point2[][] = [[path.startPoint]];

    for (const part of path.parts) {
      const corner =
        part.kind === jsDraw.PathCommandType.MoveTo ||
        part.kind === jsDraw.PathCommandType.LineTo
          ? part.point
          : part.endPoint;
      if (part.kind === jsDraw.PathCommandType.MoveTo) subpaths.push([corner]);
      else subpaths[subpaths.length - 1].push(corner);
    }
    return subpaths;
  }

  function signedArea(corners: Point2[]) {
    let twice = 0;
    for (let index = 0; index < corners.length; index += 1) {
      const here = corners[index];
      const next = corners[(index + 1) % corners.length];
      twice += here.x * next.y - next.x * here.y;
    }
    return twice / 2;
  }

  it("sweeps each step as its own convex footprint, which cannot fold", () => {
    const subpaths = subpathsOf(halfCircle());

    expect(subpaths.length).toBeGreaterThan(4);
    for (const corners of subpaths) {
      // The tip is a rectangle, so a step sweeps a hexagon at most.
      expect(corners.length).toBeGreaterThanOrEqual(4);
      expect(corners.length).toBeLessThanOrEqual(6);

      // Convexity: every turn around the footprint goes the same way. A
      // folded outline is exactly what fails this.
      const turns = corners.map((corner, index) => {
        const next = corners[(index + 1) % corners.length];
        const after = corners[(index + 2) % corners.length];
        const a = next.minus(corner);
        const b = after.minus(next);
        return Math.sign(a.x * b.y - a.y * b.x);
      });
      expect(new Set(turns.filter((turn) => turn !== 0)).size).toBe(1);
    }
  });

  it("winds every quad the same way, so overlaps add instead of cancelling", () => {
    // A stroke scrubbed back over itself, which is where the mesh appeared.
    const scrub: StrokeDataPoint[] = [];
    for (let pass = 0; pass < 4; pass += 1) {
      for (let step = 0; step < 20; step += 1) {
        const x = pass % 2 === 0 ? 20 + step * 6 : 134 - step * 6;
        scrub.push(point(x, 20 + pass * 3));
      }
    }

    const signs = subpathsOf(scrub).map((corners) =>
      Math.sign(signedArea(corners))
    );

    expect(signs.length).toBeGreaterThan(10);
    expect(new Set(signs).size).toBe(1);
  });

  it("steadies tremor rather than tracing it", () => {
    // A straight sweep with alternating noise on every sample.
    const jittery = Array.from({ length: 40 }, (_, step) =>
      point(20 + step * 6, step % 2 === 0 ? 6 : -6)
    );

    // Each quad's leading edge spans one steadied sample, so the midpoint of
    // its two corners recovers the path actually swept.
    const centres = subpathsOf(jittery).map((corners) =>
      corners[0].lerp(corners[3], 0.5)
    );
    const spread =
      Math.max(...centres.map((centre) => centre.y)) -
      Math.min(...centres.map((centre) => centre.y));

    // The raw input swings across 12 units every sample.
    expect(spread).toBeLessThan(12);
  });
});
