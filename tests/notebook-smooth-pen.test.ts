// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import type { Point2, Stroke, StrokeDataPoint } from "js-draw";
import { createNotebookSmoothPenStrokeFactory } from "@/lib/workspace/notebook-smooth-pen";
import { loadJsDraw, type JsDrawModule } from "@/lib/workspace/notebook-js-draw";

let jsDraw: JsDrawModule;

beforeAll(async () => {
  jsDraw = await loadJsDraw();
}, 120_000);

const PEN_WIDTH = 5;
const viewport = {
  getSizeOfPixelOnCanvas: () => 1,
  visibleRect: { x: 0, y: 0, w: 1000, h: 1000 },
} as never;

function point(x: number, y: number, width = PEN_WIDTH): StrokeDataPoint {
  return {
    pos: jsDraw.Vec2.of(x, y),
    width,
    color: jsDraw.Color4.fromString("#1b2a6b"),
    time: 0,
  };
}

function buildStroke(points: StrokeDataPoint[]): Stroke {
  const builder = createNotebookSmoothPenStrokeFactory(jsDraw)(
    points[0],
    viewport
  );
  for (const next of points.slice(1)) builder.addPoint(next);
  const built = builder.build();
  if (!(built instanceof jsDraw.Stroke)) {
    throw new Error("The smooth pen should produce a Stroke.");
  }
  return built;
}

/** A half circle sampled finely, as a long curved stroke would be. */
function arc(samples = 200): StrokeDataPoint[] {
  return Array.from({ length: samples }, (_, step) => {
    const t = (step / (samples - 1)) * Math.PI;
    return point(300 + Math.cos(t) * 150, 300 + Math.sin(t) * 150);
  });
}

describe("the smooth pen", () => {
  /**
   * The whole point of the change: consecutive pieces share a tangent, so no
   * join can show.
   *
   * This does not discriminate against js-draw's fitter -- that builds a
   * filled outline rather than a stroked centre line, and the two sides of an
   * outline are each smooth even when the line they describe is not. The test
   * below on the style is what pins which of the two is being produced. This
   * one guards the spline itself, and was confirmed to fail when the two
   * control arms are given different lengths.
   */
  it("leaves no corner at any join", () => {
    const path = buildStroke(arc()).getParts()[0].path;
    const parts = path.parts;

    let worstTurn = 0;
    let previousEnd: Point2 | null = null;
    let previousControl: Point2 | null = null;

    for (const part of parts) {
      if (part.kind !== jsDraw.PathCommandType.CubicBezierTo) continue;
      if (previousEnd && previousControl) {
        // Direction the last curve arrived travelling, and the direction this
        // one leaves in. On a smooth join they are the same line.
        const incoming = previousEnd.minus(previousControl).normalized();
        const outgoing = part.controlPoint1.minus(previousEnd).normalized();
        const dot = Math.max(-1, Math.min(1, incoming.dot(outgoing)));
        worstTurn = Math.max(worstTurn, (Math.acos(dot) * 180) / Math.PI);
      }
      previousEnd = part.endPoint;
      previousControl = part.controlPoint2;
    }

    // A degree of slack for floating point; a real corner is tens of degrees.
    expect(worstTurn).toBeLessThan(1);
  });

  it("draws a stroked centre line rather than a fitted outline", () => {
    const style = buildStroke(arc()).getParts()[0].style;

    // The fitter fills an outline it computed; this strokes the path the pen
    // actually took, which is why there is no fitting step to leave chords.
    expect(style.stroke).toBeDefined();
    expect(style.stroke!.width).toBeCloseTo(PEN_WIDTH, 3);
    expect(style.fill.a).toBe(0);
  });

  it("is stored no more heavily than the fitter it replaces", () => {
    const points = arc();
    const smooth = buildStroke(points).getParts()[0].path.parts.length;

    const fitted = jsDraw.makeFreehandLineBuilder(points[0], viewport);
    for (const next of points.slice(1)) fitted.addPoint(next);
    const built = fitted.build();
    if (!(built instanceof jsDraw.Stroke)) throw new Error("stroke");
    const fitter = built.getParts()[0].path.parts.length;

    // Passing through every sample would be perfectly smooth and roughly 200
    // curves. Dropping the samples that sit on the line their neighbours
    // already describe is what keeps it comparable to the fitter.
    expect(smooth).toBeLessThanOrEqual(fitter * 2);
    expect(smooth).toBeLessThan(points.length / 4);
  });

  it("keeps the drawn line on the path the hand took", () => {
    const path = buildStroke(arc()).getParts()[0].path;

    let worstStray = 0;
    const consider = (p: Point2) => {
      const radius = Math.hypot(p.x - 300, p.y - 300);
      worstStray = Math.max(worstStray, Math.abs(radius - 150));
    };
    consider(path.startPoint);
    for (const part of path.parts) {
      if ("endPoint" in part) consider(part.endPoint);
    }

    // Sub-pixel: the decimation is allowed to shave the curve, not reshape it.
    expect(worstStray).toBeLessThan(1);
  });

  it("weights the stroke by average pressure, not by however it landed", () => {
    // A light touch at the start followed by firm pressure throughout.
    const points = [
      point(0, 0, 1),
      ...Array.from({ length: 30 }, (_, step) => point((step + 1) * 6, 0, 9)),
    ];
    const stroke = buildStroke(points).getParts()[0].style.stroke;

    expect(stroke).toBeDefined();
    // Nearer the sustained 9 than the initial 1.
    expect(stroke!.width).toBeGreaterThan(7);
  });

  it("marks a dot for a tap, which a zero-length stroke would not", () => {
    const box = buildStroke([point(40, 40)]).getBBox();

    expect(box.width).toBeCloseTo(PEN_WIDTH, 1);
    expect(box.height).toBeCloseTo(PEN_WIDTH, 1);
  });
});
