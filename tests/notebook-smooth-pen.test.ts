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

  it("lets a deliberate corner stay a corner", () => {
    /*
     * Joined-up writing is full of corners: the point of a 'v', the cusp
     * where one letter runs into the next. A spline that is smooth everywhere
     * rounds every one of them, and the pen feels magnetic -- as though it
     * will not go where it was taken.
     */
    const points = [
      ...Array.from({ length: 12 }, (_, step) => point(20 + step * 8, 200 - step * 8)),
      ...Array.from({ length: 12 }, (_, step) => point(108 + step * 8, 112 + step * 8)),
    ];
    const path = buildStroke(points).getParts()[0].path;

    // The sharpest turn anywhere along the drawn curve. A rounded corner
    // spreads its 90 degrees over several gentle segments instead.
    let sharpestTurn = 0;
    let previousEnd: Point2 | null = null;
    let previousControl: Point2 | null = null;
    for (const part of path.parts) {
      if (part.kind !== jsDraw.PathCommandType.CubicBezierTo) continue;
      if (previousEnd && previousControl) {
        const incoming = previousEnd.minus(previousControl).normalized();
        const outgoing = part.controlPoint1.minus(previousEnd).normalized();
        const dot = Math.max(-1, Math.min(1, incoming.dot(outgoing)));
        sharpestTurn = Math.max(sharpestTurn, (Math.acos(dot) * 180) / Math.PI);
      }
      previousEnd = part.endPoint;
      previousControl = part.controlPoint2;
    }

    // The input turns through 90 degrees at one point. Most of that has to
    // survive as a single turn rather than being spread into a curve.
    expect(sharpestTurn).toBeGreaterThan(60);
  });

  it("reaches the far end of a stroke that doubles back on itself", () => {
    /*
     * Joined-up writing retraces constantly -- up the stem of an 'l' and back
     * down it, round the top of an 'e'. At the turn, the point before and the
     * point after both sit on the same line, so the far end has no sideways
     * offset from the line between them at all. Judged on that alone it looks
     * like a sample carrying no shape, and dropping it pulls the ink back
     * short of where the pen went.
     */
    const points = [
      ...Array.from({ length: 20 }, (_, step) => point(10 + step * 4, 60)),
      ...Array.from({ length: 20 }, (_, step) => point(86 - step * 4, 60)),
    ];
    const reach = buildStroke(points).getBBox();

    // The pen went out to x = 86 and came back. The ink has to go there too.
    expect(reach.x + reach.w).toBeGreaterThan(86 - PEN_WIDTH);
  });

  it("eases the line towards its own curve without moving the pen's end", () => {
    /*
     * The lightest guidance: interior points are nudged a fraction towards
     * the line between their neighbours, which on a curve means very slightly
     * inside it. The newest point is never moved -- shifting that is what
     * would be felt as the ink trailing the pen, and it is the whole
     * difference between guidance and being dragged.
     */
    const points = arc();
    const path = buildStroke(points).getParts()[0].path;

    const ends: Point2[] = [];
    for (const part of path.parts) {
      if ("endPoint" in part) ends.push(part.endPoint);
    }

    // The line still finishes exactly where the pen did.
    const last = ends[ends.length - 1];
    const drawnTo = points[points.length - 1].pos;
    expect(last.x).toBeCloseTo(drawnTo.x, 6);
    expect(last.y).toBeCloseTo(drawnTo.y, 6);

    // Every sample sat exactly on a circle of radius 150. Easing pulls the
    // interior of the line a little inside it -- and only a little.
    const radii = ends.map((p) => Math.hypot(p.x - 300, p.y - 300));
    const meanRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    expect(meanRadius).toBeLessThan(150);
    expect(meanRadius).toBeGreaterThan(150 * 0.995);
  });

  it("never reaches past where the pen went", () => {
    /*
     * Thinning leaves the kept points very unevenly spaced -- a long straight
     * run keeps almost nothing, a tight curve keeps everything. Sizing a
     * control arm from the span between a point's neighbours then hands a
     * short segment an arm meant for a long one, and the curve bulges outside
     * the two points it joins. On a page that is writing reaching very
     * slightly further than the stroke that made it.
     *
     * A cubic stays within its endpoints when neither arm outruns the segment;
     * a third of it either side is the even-spacing case.
     */
    const points = [
      point(20, 100),
      point(160, 100),
      point(168, 104),
      point(174, 130),
      point(176, 240),
    ];
    const path = buildStroke(points).getParts()[0].path;

    let from = path.startPoint;
    let worstRatio = 0;
    for (const part of path.parts) {
      if (part.kind === jsDraw.PathCommandType.CubicBezierTo) {
        const span = part.endPoint.distanceTo(from);
        if (span > 0) {
          worstRatio = Math.max(
            worstRatio,
            part.controlPoint1.distanceTo(from) / span,
            part.controlPoint2.distanceTo(part.endPoint) / span
          );
        }
        from = part.endPoint;
      } else if ("point" in part) {
        from = part.point;
      }
    }

    expect(worstRatio).toBeLessThan(0.4);
  });

  describe("straightening when the pen is held still", () => {
    function autocorrect(points: StrokeDataPoint[]) {
      const builder = createNotebookSmoothPenStrokeFactory(jsDraw)(
        points[0],
        viewport
      );
      for (const next of points.slice(1)) builder.addPoint(next);
      return builder.autocorrectShape?.() ?? Promise.resolve(null);
    }

    it("snaps a roughly straight stroke onto its own two ends", async () => {
      // Drawn left to right with a hand's worth of wander.
      const points = Array.from({ length: 30 }, (_, step) =>
        point(20 + step * 10, 100 + (step % 3 === 0 ? 1.5 : -1.5))
      );
      const corrected = await autocorrect(points);

      expect(corrected).not.toBeNull();
      const path = (corrected as Stroke).getParts()[0].path;
      expect(path.parts).toHaveLength(1);
      expect(path.startPoint.x).toBeCloseTo(20, 3);
      expect(path.parts[0].kind).toBe(jsDraw.PathCommandType.LineTo);
    });

    /*
     * Declining matters more than snapping. The stroke is already finished
     * when this runs, so straightening something the hand did not mean as a
     * line overwrites real work; failing to straighten one it did costs
     * nothing but a moment.
     */
    it("leaves a curve alone", async () => {
      expect(await autocorrect(arc())).toBeNull();
    });

    it("leaves a letter-sized stroke alone", async () => {
      // Short enough that its wander cannot be judged, and the pen pauses
      // between letters constantly.
      const points = Array.from({ length: 12 }, (_, step) =>
        point(20 + step * 1.5, 100)
      );

      expect(await autocorrect(points)).toBeNull();
    });

    it("leaves a scribble alone", async () => {
      const points: StrokeDataPoint[] = [];
      for (let pass = 0; pass < 4; pass += 1) {
        for (let step = 0; step < 15; step += 1) {
          const x = pass % 2 === 0 ? 20 + step * 12 : 188 - step * 12;
          points.push(point(x, 100 + pass * 9));
        }
      }

      expect(await autocorrect(points)).toBeNull();
    });
  });

  it("stores a small fraction of the samples it was given", () => {
    const points = arc();
    const smooth = buildStroke(points).getParts()[0].path.parts.length;

    const fitted = jsDraw.makeFreehandLineBuilder(points[0], viewport);
    for (const next of points.slice(1)) fitted.addPoint(next);
    const built = fitted.build();
    if (!(built instanceof jsDraw.Stroke)) throw new Error("stroke");
    const fitter = built.getParts()[0].path.parts.length;

    // Passing through every sample would be perfectly smooth and roughly 200
    // curves, reparsed on every page load. Dropping the samples that lie on
    // the line their neighbours already describe is what keeps it small.
    expect(smooth).toBeLessThan(points.length / 6);
    // The fitter is not the benchmark here: on a noiseless arc it is at its
    // best and real input never is. This only guards against the spline
    // running away by an order of magnitude.
    expect(smooth).toBeLessThan(fitter * 8);
  });

  /**
   * Real input is never noiseless, and the thinning used to be defeated by
   * that: judged over a quarter of a pixel it was reading the digitiser rather
   * than the hand, so a slowly drawn line arrived with a point at nearly every
   * sample. Every one of those is a curve rasterised again on every frame for
   * the rest of the stroke, which is what made writing on a zoomed-in page --
   * where a stroke covers its true size in screen pixels -- run behind the pen.
   *
   * Both halves matter, so both are asserted: fewer curves, and closer to the
   * line that was actually drawn rather than to the wobble on top of it.
   */
  it("is not defeated by the wobble in a hand-drawn line", () => {
    let seed = 7;
    const wobble = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed / 2147483648 - 0.5) * 0.5;
    };
    const trueDirection = jsDraw.Vec2.of(1, 0.28).normalized();
    const samples = Array.from({ length: 600 }, (_, step) =>
      point(step + wobble(), step * 0.28 + wobble())
    );

    const path = buildStroke(samples).getParts()[0].path;

    // Kept 150 curves when the test sat under the noise; 35 once above it.
    expect(path.parts.length).toBeLessThan(60);

    let worstStray = 0;
    const consider = (p: Point2) => {
      // Distance from the line the hand meant, through the origin.
      worstStray = Math.max(
        worstStray,
        Math.abs(p.x * trueDirection.y - p.y * trueDirection.x)
      );
    };
    consider(path.startPoint);
    for (const part of path.parts) {
      if ("endPoint" in part) consider(part.endPoint);
    }

    // Inside the wobble it was given, so it is drawing the line and not the noise.
    expect(worstStray).toBeLessThan(0.5);
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

/**
 * Holding the pen still at the end of a stroke snaps it straight, and then
 * keeps it a line so the pen can aim it. Previously the judgement was strict
 * enough that only an already-straight line qualified -- the one case needing
 * no help -- and any movement after the snap threw the line away, so getting
 * the angle right meant drawing it again until it landed.
 */
describe("straightening a line", () => {
  function makeBuilder(points: StrokeDataPoint[]) {
    const builder = createNotebookSmoothPenStrokeFactory(jsDraw)(
      points[0],
      viewport
    );
    for (const next of points.slice(1)) builder.addPoint(next);
    return builder;
  }

  /** The stroke's two ends, whatever shape it ended up as. */
  function endsOf(stroke: Stroke) {
    const path = stroke.getParts()[0].path;
    const last = path.parts[path.parts.length - 1];
    const end =
      last && "endPoint" in last
        ? last.endPoint
        : last && "point" in last
          ? last.point
          : path.startPoint;
    return { start: path.startPoint, end };
  }

  const isStraightLine = (stroke: Stroke) => {
    const path = stroke.getParts()[0].path;
    return (
      path.parts.length === 1 &&
      path.parts[0].kind === jsDraw.PathCommandType.LineTo
    );
  };

  /**
   * A line drawn freehand: it wanders sideways but never doubles back.
   * `roughness` is the wander as a fraction of the line's length.
   */
  const roughLine = (roughness: number, samples = 40) =>
    Array.from({ length: samples }, (_, step) => {
      const t = step / (samples - 1);
      return point(100 + t * 400, 300 + Math.sin(t * Math.PI * 3) * 400 * roughness);
    });

  it.each([
    ["all but straight", 0.01],
    ["a little wobbly", 0.06],
    ["visibly rough", 0.12],
    ["frankly squiggly", 0.19],
  ])("straightens %s a line", async (_label, roughness) => {
    const corrected = await makeBuilder(roughLine(roughness)).autocorrectShape!();

    expect(corrected).not.toBeNull();
    expect(isStraightLine(corrected as Stroke)).toBe(true);
  });

  it("leaves a real curve alone", async () => {
    expect(await makeBuilder(arc()).autocorrectShape!()).toBeNull();
  });

  it("still has a ceiling, so the tolerance is not simply anything", async () => {
    expect(await makeBuilder(roughLine(0.35)).autocorrectShape!()).toBeNull();
  });

  it("leaves a shape that doubles back alone, however far apart its ends", () => {
    // A `v`: both halves are straight, and it ends a long way from where it
    // started, but it comes back on itself in the middle.
    const shape = [
      ...Array.from({ length: 20 }, (_, step) => point(100 + step * 5, 200 + step * 10)),
      ...Array.from({ length: 20 }, (_, step) => point(200 + step * 5, 400 - step * 10)),
    ];

    return expect(makeBuilder(shape).autocorrectShape!()).resolves.toBeNull();
  });

  it("leaves a stroke too short to be sure alone", async () => {
    const stub = Array.from({ length: 6 }, (_, step) => point(100 + step * 2, 300));

    expect(await makeBuilder(stub).autocorrectShape!()).toBeNull();
  });

  it("keeps the line, so the pen can pivot it before letting go", async () => {
    const builder = makeBuilder(roughLine(0.08));
    await builder.autocorrectShape!();

    // Swing well off the drawn direction, as aiming the line would.
    builder.addPoint(point(300, 700));
    const { start, end } = endsOf(builder.build() as Stroke);

    expect(isStraightLine(builder.build() as Stroke)).toBe(true);
    // The near end stays where the stroke began; the far end follows the pen.
    expect(start.x).toBeCloseTo(100, 0);
    expect(end.x).toBeCloseTo(300, 0);
    expect(end.y).toBeCloseTo(700, 0);
  });

  it("lets the line be shortened by coming back along it", async () => {
    const builder = makeBuilder(roughLine(0.05));
    await builder.autocorrectShape!();
    const drawn = endsOf(builder.build() as Stroke);

    builder.addPoint(point(250, 300));
    const shortened = endsOf(builder.build() as Stroke);

    expect(shortened.end.x).toBeLessThan(drawn.end.x);
    expect(shortened.start.x).toBeCloseTo(drawn.start.x, 4);
  });

  it("does not offer to straighten a line it has already straightened", async () => {
    const builder = makeBuilder(roughLine(0.05));

    expect(await builder.autocorrectShape!()).not.toBeNull();
    expect(await builder.autocorrectShape!()).toBeNull();
  });
});
