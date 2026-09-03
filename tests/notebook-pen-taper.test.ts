// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import type { Point2, Stroke, StrokeDataPoint } from "js-draw";
import { createNotebookSmoothPenStrokeFactory } from "@/lib/workspace/notebook-smooth-pen";
import { getNotebookPenFeel, NOTEBOOK_PEN_SMOOTHING_DEFAULT } from "@/lib/workspace/notebook-pen-feel";
import { loadJsDraw, type JsDrawModule } from "@/lib/workspace/notebook-js-draw";

let jsDraw: JsDrawModule;

beforeAll(async () => {
  jsDraw = await loadJsDraw();
}, 120_000);

const viewport = {
  getSizeOfPixelOnCanvas: () => 1,
  visibleRect: { x: 0, y: 0, w: 1000, h: 1000 },
} as never;

function point(x: number, y: number, width: number): StrokeDataPoint {
  return {
    pos: jsDraw.Vec2.of(x, y),
    width,
    color: jsDraw.Color4.fromString("#101010"),
    time: 0,
  };
}

function build(points: StrokeDataPoint[]) {
  const builder = createNotebookSmoothPenStrokeFactory(
    jsDraw,
    getNotebookPenFeel(NOTEBOOK_PEN_SMOOTHING_DEFAULT)
  )(points[0], viewport);
  for (const next of points.slice(1)) builder.addPoint(next);
  return builder.build() as Stroke;
}

/** A straight run, drawn at whatever weight the ramp gives each sample. */
function run(from: number, to: number, samples = 200) {
  return Array.from({ length: samples }, (_, step) => {
    const progress = step / (samples - 1);
    return point(20 + progress * 400, 200, from + (to - from) * progress);
  });
}

function outlinePoints(stroke: Stroke): Point2[] {
  const path = stroke.getParts()[0].path;
  const points: Point2[] = [path.startPoint];
  for (const part of path.parts) {
    if (part.kind === jsDraw.PathCommandType.CubicBezierTo) points.push(part.endPoint);
    else if (part.kind === jsDraw.PathCommandType.LineTo) points.push(part.point);
  }
  return points;
}

/** How far across the stroke is, measured near a given point along it. */
function thicknessNear(stroke: Stroke, x: number, window = 24) {
  const nearby = outlinePoints(stroke).filter((entry) => Math.abs(entry.x - x) <= window);
  const ys = nearby.map((entry) => entry.y);
  return Math.max(...ys) - Math.min(...ys);
}

/**
 * Whether the pen draws the weight it was written with.
 *
 * The continuous-curve pen bought its smoothness by drawing one stroked path,
 * and a stroked path has a single width for its whole length -- so pressure
 * could only be averaged into one heavier or lighter line, and an Apple Pencil
 * put down the same flat mark as a mouse. Modulation along a stroke is most of
 * what makes handwriting look like handwriting, and getting it back means
 * drawing both edges rather than a centre line.
 */
describe("a pen that tapers", () => {
  it("leaves a stroke of one steady weight as a stroked centre line", () => {
    // Nothing to show, so nothing is spent: this is the cheaper path, and it
    // is identical on screen.
    const style = build(run(3, 3)).getParts()[0].style;

    expect(style.stroke).toBeDefined();
    expect(style.stroke!.width).toBeCloseTo(3, 3);
    expect(style.fill.a).toBe(0);
  });

  it("draws a stroke made at varying weight as its own filled outline", () => {
    const style = build(run(1, 9)).getParts()[0].style;

    expect(style.fill.a).toBeGreaterThan(0);
    expect(style.stroke).toBeUndefined();
  });

  it("is broad where the pen pressed and fine where it did not", () => {
    const stroke = build(run(1, 9));

    const light = thicknessNear(stroke, 60);
    const heavy = thicknessNear(stroke, 380);

    expect(heavy).toBeGreaterThan(light * 2);
  });

  it("tapers the same way round when the pressure ramps the other way", () => {
    const stroke = build(run(9, 1));

    expect(thicknessNear(stroke, 60)).toBeGreaterThan(thicknessNear(stroke, 380) * 2);
  });

  /*
   * Apple Pencil reports almost nothing for the first sample or two of a
   * contact. Honouring that exactly starts every stroke from a point, which
   * reads as the pen failing to catch rather than as a calligraphic entry.
   */
  it("never pinches to nothing where the pen barely touched", () => {
    expect(thicknessNear(build(run(0.1, 9)), 40)).toBeGreaterThan(0.5);
  });

  /*
   * An outline drawn as separate subpaths is welded into a zig-zag by
   * everything downstream that closes a path -- the eraser's hit testing most
   * of all. It has to be one loop.
   */
  it("closes the outline as a single loop", () => {
    const path = build(run(1, 9)).getParts()[0].path;

    for (const part of path.parts) {
      expect(part.kind).not.toBe(jsDraw.PathCommandType.MoveTo);
    }

    const parts = path.parts;
    const finalPart = parts[parts.length - 1];
    const end =
      finalPart.kind === jsDraw.PathCommandType.CubicBezierTo
        ? finalPart.endPoint
        : finalPart.kind === jsDraw.PathCommandType.LineTo
          ? finalPart.point
          : null;

    expect(end).not.toBeNull();
    expect(end!.distanceTo(path.startPoint)).toBeLessThan(0.001);
  });

  it("keeps both edges smooth rather than passing the wobble through", () => {
    // The two edges are offset from the same spline, so each has to be as
    // continuous as the line it came from -- an edge built segment by segment
    // shows every join as a nick along the side of the stroke.
    const path = build(run(1, 9)).getParts()[0].path;
    const cubics = path.parts.filter(
      (part) => part.kind === jsDraw.PathCommandType.CubicBezierTo
    );

    expect(cubics.length).toBeGreaterThan(8);
  });
});
