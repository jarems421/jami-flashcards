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
    // The first and last corners are one sample offset by +nib and -nib, so
    // the vector between them is the nib laid end to end.
    const across = outline[0].minus(outline[outline.length - 1]);
    return Math.abs(across.x * axis.y - across.y * axis.x);
  }

  it("offsets along a fixed nib angle rather than perpendicular to travel", () => {
    const radians = (NIB_ANGLE_DEGREES * Math.PI) / 180;
    const horizontal = perpendicularThickness([0, 0], [100, 0]);
    const alongNib = perpendicularThickness(
      [0, 0],
      [100 * Math.cos(radians), 100 * Math.sin(radians)]
    );

    // A round nib would make these identical. A chisel is broad across its
    // edge and vanishes to a line along it, which is the whole point.
    expect(horizontal).toBeCloseTo(STROKE_WIDTH * Math.sin(radians), 1);
    expect(alongNib).toBeCloseTo(0, 5);
  });

  it("keeps close to the full thickness on an ordinary horizontal sweep", () => {
    const outline = outlineOf([point(0, 0), point(120, 0)]);
    const ys = outline.map((corner) => corner.y);
    const spread = Math.max(...ys) - Math.min(...ys);

    expect(spread).toBeCloseTo(
      STROKE_WIDTH * Math.sin((NIB_ANGLE_DEGREES * Math.PI) / 180),
      1
    );
  });

  it("ends on a slant, which is what reads as a highlighter", () => {
    const outline = outlineOf([point(0, 0), point(120, 0)]);
    const leading = outline[0];
    const trailing = outline[outline.length - 1];
    const edgeAngle =
      (Math.atan2(leading.y - trailing.y, leading.x - trailing.x) * 180) /
      Math.PI;
    // The cap is a line, not an arrow: which end it is measured from flips the
    // angle by 180 degrees without changing the slant.
    const slant = ((edgeAngle % 180) + 180) % 180;

    expect(slant).toBeCloseTo(NIB_ANGLE_DEGREES, 0);
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
 * The stroke used to stop dead partway through a curve and resume after it.
 * Offsetting by a fixed nib only describes the swept area while travel stays
 * on one side of the nib's axis; crossing that axis folded the outline into a
 * bowtie whose crossed lobe cancelled itself under the nonzero winding rule.
 */
describe("staying continuous through a turn", () => {
  /**
   * There is deliberately no "is the centre of the curve filled" test here.
   *
   * One was written, and it passed with the fold bug reintroduced:
   * `closedContainsPoint` does not model the nonzero winding rule the renderer
   * actually fills with, so it reported the cancelled lobe as covered. Keeping
   * it would have been false assurance. The two tests below encode the fix
   * itself and were both confirmed to fail when it is removed; continuity was
   * checked by rendering an arc, a loop and a wave and looking at them.
   */
  it("splits the turn into separate subpaths rather than one folded outline", () => {
    const path = buildStroke(halfCircle()).getParts()[0].path;
    const subpathStarts = path.parts.filter(
      (part) => part.kind === jsDraw.PathCommandType.MoveTo
    );

    expect(subpathStarts.length).toBeGreaterThanOrEqual(1);
  });

  it("winds every subpath the same way, so they union instead of cancelling", () => {
    const path = buildStroke(halfCircle()).getParts()[0].path;

    // Split the outline back into its subpaths and take each one's signed
    // area. Two subpaths wound opposite ways would subtract where they meet
    // and reopen the hole the splitting exists to close.
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

    const signs = subpaths
      .filter((corners) => corners.length > 2)
      .map((corners) => {
        let twiceArea = 0;
        for (let index = 0; index < corners.length; index += 1) {
          const here = corners[index];
          const next = corners[(index + 1) % corners.length];
          twiceArea += here.x * next.y - next.x * here.y;
        }
        return Math.sign(twiceArea);
      });

    expect(signs.length).toBeGreaterThan(1);
    expect(new Set(signs).size).toBe(1);
  });

  it("smooths its edges into curves rather than a chain of corners", () => {
    const path = buildStroke(halfCircle()).getParts()[0].path;
    const curves = path.parts.filter(
      (part) => part.kind === jsDraw.PathCommandType.QuadraticBezierTo
    );

    expect(curves.length).toBeGreaterThan(4);
  });
});
