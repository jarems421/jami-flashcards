import type {
  Color4,
  ComponentBuilder,
  ComponentBuilderFactory,
  PathCommand,
  Point2,
  RenderablePathSpec,
  StrokeDataPoint,
  Viewport,
} from "js-draw";
import type { JsDrawModule } from "@/lib/workspace/notebook-js-draw";
import { unionOfConvexPolygons } from "@/lib/workspace/notebook-convex-union";
import { NIB_ANGLE_DEFAULT } from "@/lib/workspace/notebook-nib-angle";

/**
 * A chisel-tip stroke builder, for the highlighter.
 *
 * A pen's outline is offset *perpendicular to the direction of travel*, which
 * is why it stays the same width whichever way it moves and ends in a round
 * cap. A chisel nib is a flat edge, so its outline is offset along a vector
 * set by how the pen is held rather than by where it is going. That one
 * difference produces the whole highlighter character: broad horizontal
 * strokes, slanted ends, and a stroke that narrows as it turns towards the
 * nib's own axis.
 *
 * Which way that edge faces is worked out in `notebook-nib-angle.ts` and read
 * in here once per accepted sample, so the edge turns with the hand. A pointer
 * that reports no orientation -- a mouse, a finger, a stylus without tilt --
 * holds the fixed angle this drew with before, so nothing about those strokes
 * changes.
 *
 * js-draw ships no calligraphic pen, so this implements its ComponentBuilder
 * interface directly. Nothing about the saved format changes -- the result is
 * an ordinary filled path -- so existing notebooks are untouched and strokes
 * drawn here open anywhere the old ones do.
 */

/**
 * The nib's narrow dimension, as a fraction of its width.
 *
 * A real chisel tip is a rectangle, not a knife edge, and that thickness is
 * what stops the stroke disappearing. Modelled as a bare flat edge, a stroke
 * travelling along the nib's own axis sweeps *no area at all* -- which is seen
 * as the stroke breaking apart partway through a curve, at exactly the angle
 * where the edge lines up with the direction of travel. A real highlighter
 * cannot do that, because it always lays down at least its narrow side.
 */
const NIB_NARROW_RATIO = 0.2;

/**
 * How far the tip must travel before a sample is kept, as a fraction of the
 * nib's half-width.
 *
 * A highlighter is a broad tool laid over text that is already there, so it
 * wants to follow the hand's intent rather than its tremor. Sampling in steps
 * proportional to the nib means a thick highlighter is steadied more than a
 * thin one, which is what makes it feel guided rather than twitchy.
 */
const GUIDE_STEP_RATIO = 0.34;

/**
 * How far the path may stray from a straight run, and how far a single
 * footprint may span, as fractions of the nib's half-width.
 *
 * Every step is swept as its own footprint, which is what makes holes
 * impossible -- but it also means a highlight over one word is dozens of
 * overlapping shapes. The precision eraser splits a filled shape at its edges,
 * so erasing across that many leaves the uncovered remainder of each one
 * behind: the specks that took several passes to clear.
 *
 * Sweeping between the samples that actually describe the path, rather than
 * every sample, gives the same shape in a handful of footprints instead. The
 * eraser then has a few large pieces to divide rather than a crowd of small
 * ones.
 */
const FOOTPRINT_TOLERANCE_RATIO = 0.06;
const FOOTPRINT_SPAN_RATIO = 6;
/** Beyond this turn a footprint always ends, so curves keep their shape. */
const FOOTPRINT_TURN_DEGREES = 12;

/**
 * The outline of a set of points, wound the same way every time.
 *
 * Monotone chain. Consistent winding is not incidental here: it is what lets
 * overlapping footprints add rather than cancel under the nonzero fill rule.
 */
function convexHull(points: Point2[]): Point2[] {
  const sorted = [...points].sort((left, right) =>
    left.x === right.x ? left.y - right.y : left.x - right.x
  );
  const turn = (origin: Point2, from: Point2, to: Point2) =>
    (from.x - origin.x) * (to.y - origin.y) -
    (from.y - origin.y) * (to.x - origin.x);

  const chain = (ordered: Point2[]) => {
    const side: Point2[] = [];
    for (const candidate of ordered) {
      while (
        side.length >= 2 &&
        turn(side[side.length - 2], side[side.length - 1], candidate) <= 0
      ) {
        side.pop();
      }
      side.push(candidate);
    }
    side.pop();
    return side;
  };

  return [...chain(sorted), ...chain([...sorted].reverse())];
}

export function createNotebookChiselStrokeFactory(
  jsDraw: JsDrawModule,
  /**
   * Which way the flat edge is facing, asked once per accepted sample.
   *
   * A function rather than a value because the factory outlives the stroke --
   * it is cached per pen in `applyNotebookStrokeShape` -- so an angle passed
   * in here would be the one that happened to be current when the highlighter
   * was first selected. Omitted, the edge is fixed, which is what a mouse and
   * every stylus reporting no orientation get.
   */
  nibAngle: () => number = () => NIB_ANGLE_DEFAULT
): ComponentBuilderFactory {
  const { PathCommandType, Rect2, Stroke, Vec2 } = jsDraw;

  return (startPoint: StrokeDataPoint, viewport: Viewport): ComponentBuilder => {
    const color: Color4 = startPoint.color;
    const halfWidth = Math.max(startPoint.width, 0.1) / 2;

    /**
     * A point on the path, carrying the tip that was held over it.
     *
     * The two vectors are worked out when the sample is accepted rather than
     * when it is drawn. `preview` rebuilds every footprint on the path each
     * frame, so deriving them there would put two sines and two cosines per
     * point into the render loop, on every frame of every stroke -- for an
     * angle that cannot have changed since the sample was taken.
     */
    type NibSample = {
      at: Point2;
      /** Half the flat edge, and half the tip's thickness across it. */
      nib: Point2;
      narrow: Point2;
    };

    const sampleAt = (at: Point2, angle: number): NibSample => ({
      at,
      nib: Vec2.of(Math.cos(angle), Math.sin(angle)).times(halfWidth),
      narrow: Vec2.of(-Math.sin(angle), Math.cos(angle)).times(
        halfWidth * NIB_NARROW_RATIO
      ),
    });

    /** The four corners of the tip, placed at a point on the path. */
    const tipAt = (sample: NibSample, centre: Point2 = sample.at) => [
      centre.plus(sample.nib).plus(sample.narrow),
      centre.plus(sample.nib).minus(sample.narrow),
      centre.minus(sample.nib).minus(sample.narrow),
      centre.minus(sample.nib).plus(sample.narrow),
    ];
    const minimumStep = Math.max(
      viewport.getSizeOfPixelOnCanvas() * 0.65,
      halfWidth * GUIDE_STEP_RATIO
    );

    const points = [
      sampleAt(Vec2.of(startPoint.pos.x, startPoint.pos.y), nibAngle()),
    ];

    /**
     * Eases the tremor out of the sampled path before it is swept.
     *
     * The steadying happens here, on the centre line, rather than on the
     * outline. Smoothing the outline instead only makes the edges prettier
     * while leaving the shape doing whatever the hand did.
     */
    const steadied = (raw: NibSample[]) => {
      if (raw.length < 3) return raw;

      // Positions are averaged; the tip is not. The edge is already filtered
      // where it is measured, and averaging it a second time here would only
      // add lag to a signal that is deliberately slow.
      const smoothed = [raw[0]];
      for (let index = 1; index < raw.length - 1; index += 1) {
        smoothed.push({
          ...raw[index],
          at: raw[index - 1].at
            .plus(raw[index].at.times(2))
            .plus(raw[index + 1].at)
            .times(0.25),
        });
      }
      smoothed.push(raw[raw.length - 1]);
      return smoothed;
    };

    /**
     * The samples worth sweeping between: where the path bends, where it has
     * run far enough, and nowhere else. Fewer, longer footprints describe the
     * same wash and leave the eraser far less to shred.
     */
    const sweepPoints = (path: NibSample[]) => {
      if (path.length < 3) return path;

      const tolerance = halfWidth * FOOTPRINT_TOLERANCE_RATIO;
      const span = halfWidth * FOOTPRINT_SPAN_RATIO;
      const turnCosine = Math.cos((FOOTPRINT_TURN_DEGREES * Math.PI) / 180);
      const kept = [path[0]];

      for (let index = 1; index < path.length - 1; index += 1) {
        const anchor = kept[kept.length - 1].at;
        const here = path[index].at;
        const next = path[index + 1].at;
        const arriving = here.minus(anchor);
        const leaving = next.minus(here);
        const bends =
          arriving.magnitude() > 0 &&
          leaving.magnitude() > 0 &&
          arriving.normalized().dot(leaving.normalized()) < turnCosine;

        const along = next.minus(anchor);
        const length = along.magnitude();
        const stray =
          length === 0
            ? here.distanceTo(anchor)
            : Math.abs(
                along.x * (here.y - anchor.y) - along.y * (here.x - anchor.x)
              ) / length;

        if (bends || stray >= tolerance || here.distanceTo(anchor) >= span) {
          kept.push(path[index]);
        }
      }

      kept.push(path[path.length - 1]);
      return kept;
    };

    /*
     * One swept footprint per step of the nib.
     *
     * A single outline traced naively is only valid while the path stays on one
     * side of the nib's axis and never turns tighter than the nib reaches.
     * Cross either limit and the outline folds back through itself; the crossed
     * region takes a winding number of zero and is punched out of the fill.
     * That was the stroke breaking mid-curve, and the mesh of holes where one
     * motion doubled back over itself.
     *
     * Sweeping each step separately removes the possibility rather than
     * handling the cases. Every footprint is convex and cannot fold, and wound
     * the same way they can only ever add: a point covered by five of them has
     * a winding number of five, not one or zero.
     */
    const footprints = (): Point2[][] => {
      // A tap leaves the tip's own footprint.
      if (points.length === 1) return [tipAt(points[0])];

      const path = sweepPoints(steadied(points));
      const polygons: Point2[][] = [];
      for (let index = 1; index < path.length; index += 1) {
        // The area a rectangular tip covers sliding from one point to the next
        // is the hull of its footprint at both ends. Sweeping the tip rather
        // than a bare edge is what keeps the stroke alive when it turns to run
        // along the nib, where an edge would sweep nothing at all.
        //
        // The two ends may now be held at different angles, and the hull
        // absorbs that without special handling: a tip that turned as it
        // travelled sweeps the region between its two orientations, which is
        // what it physically covers. It stays convex, so the guarantee that
        // footprints can only add still holds.
        const corners = convexHull([
          ...tipAt(path[index - 1]),
          ...tipAt(path[index]),
        ]);
        if (corners.length >= 3) polygons.push(corners);
      }
      return polygons;
    };

    const loopPath = (corners: Point2[]): RenderablePathSpec => ({
      startPoint: corners[0],
      commands: corners.slice(1).map(
        (point): PathCommand => ({ kind: PathCommandType.LineTo, point })
      ),
      style: { fill: color },
    });

    /** Every footprint as its own subpath. What the wet stroke draws. */
    const footprintPath = (polygons: Point2[][]): RenderablePathSpec => {
      const commands: PathCommand[] = [];
      let pathStart: Point2 | null = null;

      for (const corners of polygons) {
        if (pathStart === null) {
          pathStart = corners[0];
        } else {
          commands.push({ kind: PathCommandType.MoveTo, point: corners[0] });
        }
        for (const corner of corners.slice(1)) {
          commands.push({ kind: PathCommandType.LineTo, point: corner });
        }
      }

      return {
        startPoint: pathStart ?? points[0].at.plus(points[0].nib),
        commands,
        style: { fill: color },
      };
    };

    return {
      getBBox() {
        return Rect2.bboxOf(points.map((sample) => sample.at)).grownBy(halfWidth);
      },
      addPoint(newPoint: StrokeDataPoint) {
        const next = Vec2.of(newPoint.pos.x, newPoint.pos.y);
        if (next.distanceTo(points[points.length - 1].at) < minimumStep) return;
        // The angle is read here, with the sample, rather than at the lift:
        // this is the moment the tip was actually over this point.
        points.push(sampleAt(next, nibAngle()));
      },
      preview(renderer) {
        renderer.drawPath(footprintPath(footprints()));
      },
      /*
       * The committed stroke is the same region as one closed loop.
       *
       * Subpaths are what the eraser cannot survive. `Path.asClosed()`, which
       * every erased piece passes through, turns each `MoveTo` into a `LineTo`
       * -- welding the footprints into a zig-zag that bridges between them and
       * bulges outside the wash -- and the splitting above it pairs pieces on
       * the assumption that the path is a single loop. Tracing the union once,
       * here, hands the eraser the shape it expects, so a highlighter divides
       * like a pen stroke does.
       *
       * The union is the region the footprints already paint, so nothing moves
       * between the wet stroke and the dry one. If it cannot be traced the
       * footprints are kept: the old behaviour is the floor, not the ceiling.
       */
      build() {
        const polygons = footprints();
        const outline = unionOfConvexPolygons(polygons);
        return new Stroke([
          outline
            ? loopPath(outline.map((point) => Vec2.of(point.x, point.y)))
            : footprintPath(polygons),
        ]);
      },
      /**
       * The live ink trail some browsers render ahead of the committed stroke.
       * It is round rather than chisel-shaped, which is a visible compromise
       * for the length of one stroke -- but it is what keeps ink under the
       * Pencil instead of trailing it, and the true shape lands the instant
       * the stroke commits.
       */
      /*
       * No `inkTrailStyle`, and its absence is the feature.
       *
       * js-draw turns on the Web Ink API's compositor trail for any builder
       * that offers one -- `if (this.builder.inkTrailStyle)` in Pen.onPointerDown
       * -- and that trail is fed the raw DOM event, `event.isTrusted` and all.
       * It never passes through the input mapper, so it is drawn to the
       * unfiltered pointer while this stroke is deliberately drawn to the held,
       * smoothed one.
       *
       * The gap between those two is the trailing distance the smoothing
       * accepts on purpose: "a stroke ends a fraction short of where the pen
       * physically left -- and ink that is not there cannot be seen". The
       * compositor was drawing that missing fraction back in, outside anything
       * this app renders, and dropping it a frame or two after the real ink
       * landed. Reported as ink glitching and reaching past the lift, and worse
       * zoomed in, where the trail is thicker and every pixel is magnified.
       *
       * It also draws the raw path, tremor included, which is the jitter the
       * One Euro filter exists to remove.
       *
       * The cost is the latency the trail was hiding. This ink is filtered
       * behind the pen by design, so a trail racing ahead of it was never
       * hiding latency here -- it was contradicting the design.
       */
    };
  };
}
