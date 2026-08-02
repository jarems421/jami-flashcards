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

/**
 * A pen that draws the line the hand actually made.
 *
 * js-draw fits a stroke by growing one quadratic at a time and cutting it as
 * soon as a sample falls outside tolerance -- and every new piece starts with
 * a control arm only half a pen width long, so it leaves the join almost
 * straight. On a long curve that reads as a chain of flat chords.
 *
 * Measured on a noisy half-arc, no amount of input smoothing fixes it: from
 * beta 0.3 down to 0.015 (a lag of half a pixel out to ten) the fitter still
 * carved the same curve into 13 pieces down to 8, and the deviation stayed
 * pinned at its 3-pixel ceiling the whole way. The chords are the fitter, not
 * the input.
 *
 * So there is no fitting here. The samples are joined by a Catmull-Rom spline
 * written out as cubic Béziers, which passes through every point and is
 * C1-continuous by construction: consecutive pieces share a tangent, so no
 * join can show. What is drawn is what was sampled, smoothed on the way in.
 */

/**
 * How far the pen must travel before a sample is considered at all, as a
 * fraction of a screen pixel. Stops a resting pen filling the path with
 * duplicates.
 */
const MINIMUM_STEP_RATIO = 0.6;

/**
 * How far a sample may sit from the line between its neighbours before it is
 * worth keeping, in screen pixels.
 *
 * A spline through every sample is smooth but enormous -- a long stroke came
 * out at 300 curves against the fitter's 11, and every one of those is stored
 * and reparsed on every load. Being C1, the spline is exactly as smooth
 * through sparse points as dense ones, so the samples that sit on the line
 * their neighbours already describe carry no shape and can go. Curvature is
 * where the points are kept.
 */
const SHAPE_TOLERANCE_RATIO = 0.25;

/**
 * The furthest apart two kept points may be, in screen pixels.
 *
 * The test above only ever compares one held sample against the chord it sits
 * on, so on a long gentle curve the error accumulates unchecked: each sample
 * looks near enough to the line, and the line quietly grows. Small round
 * letters are what suffer -- an 'o' is a long gentle curve at that scale, and
 * it comes back flattened. Forcing a point at least this often bounds how far
 * that can run.
 */
const MAXIMUM_SPAN_RATIO = 24;

/** Catmull-Rom tension. A sixth is the uniform, non-overshooting form. */
const TANGENT_SCALE = 1 / 6;

/**
 * How sharply the line must turn at a point before it is treated as a corner
 * rather than a curve, in degrees.
 *
 * A Catmull-Rom spline is smooth *everywhere*, which sounds like what a pen
 * wants until you write joined-up. Handwriting is full of deliberate corners
 * -- the point of a 'v', the cusp where one letter joins the next, the turn
 * back down at the top of an 'a' -- and a curve that cannot make a corner
 * rounds every one of them off. That reads as the pen being magnetic: it
 * refuses to go exactly where it was taken.
 *
 * At a corner the two tangents are taken from the strokes either side instead
 * of from the line through them, which lets the join come to a point. Curves
 * below the threshold are untouched, so a genuine curve stays seamless.
 */
const CORNER_DEGREES = 35;

export function createNotebookSmoothPenStrokeFactory(
  jsDraw: JsDrawModule
): ComponentBuilderFactory {
  const { PathCommandType, Rect2, Stroke, Vec2 } = jsDraw;

  return (startPoint: StrokeDataPoint, viewport: Viewport): ComponentBuilder => {
    const color: Color4 = startPoint.color;
    /*
     * One width for the whole stroke, averaged over its samples.
     *
     * A stroked path cannot taper, so pressure can no longer thin and thicken
     * a line along its length. Averaging keeps what is left of it meaningful:
     * press harder and the whole stroke comes out heavier. Taking the first
     * sample instead would let however lightly the pen happened to land decide
     * the weight of everything after it.
     */
    let widthTotal = Math.max(startPoint.width, 0.1);
    let widthSamples = 1;
    const strokeWidth = () => widthTotal / widthSamples;
    const minimumStep = Math.max(
      viewport.getSizeOfPixelOnCanvas() * MINIMUM_STEP_RATIO,
      0.01
    );
    const shapeTolerance =
      viewport.getSizeOfPixelOnCanvas() * SHAPE_TOLERANCE_RATIO;
    const maximumSpan = viewport.getSizeOfPixelOnCanvas() * MAXIMUM_SPAN_RATIO;
    const points: Point2[] = [Vec2.of(startPoint.pos.x, startPoint.pos.y)];
    /**
     * The newest sample, held back one step.
     *
     * It is only committed once a further sample proves it carries shape --
     * that it does not simply lie on the line between what came before and
     * what came after. Held rather than decided immediately because that
     * cannot be known until the next sample arrives.
     */
    let pending: Point2 | null = null;

    /** Perpendicular distance from `point` to the line `from`-`to`. */
    const strayFromLine = (point: Point2, from: Point2, to: Point2) => {
      const along = to.minus(from);
      const length = along.magnitude();
      if (length === 0) return point.distanceTo(from);
      const offset = point.minus(from);
      return Math.abs(along.x * offset.y - along.y * offset.x) / length;
    };

    /** Every point that shapes the curve, including the one still held. */
    const shapePoints = () => (pending ? [...points, pending] : points);

    const renderablePath = (): RenderablePathSpec => {
      const width = strokeWidth();
      const stroked = {
        fill: jsDraw.Color4.transparent,
        stroke: { color, width },
      };

      const shape = shapePoints();

      if (shape.length === 1) {
        // A dot. Round caps make a zero-length stroke visible on canvas but
        // not in exported SVG, so this is drawn as a filled disc instead --
        // four cubics, the usual circle approximation.
        const centre = shape[0];
        const radius = width / 2;
        const handle = radius * 0.5522847498;
        const around = [
          Vec2.of(radius, 0),
          Vec2.of(0, radius),
          Vec2.of(-radius, 0),
          Vec2.of(0, -radius),
        ];
        const commands: PathCommand[] = around.map((_, index) => {
          const from = around[index];
          const to = around[(index + 1) % 4];
          const fromTangent = Vec2.of(-from.y, from.x).times(handle / radius);
          const toTangent = Vec2.of(-to.y, to.x).times(handle / radius);
          return {
            kind: PathCommandType.CubicBezierTo,
            controlPoint1: centre.plus(from).plus(fromTangent),
            controlPoint2: centre.plus(to).minus(toTangent),
            endPoint: centre.plus(to),
          };
        });
        return {
          startPoint: centre.plus(around[0]),
          commands,
          style: { fill: color },
        };
      }

      // Catmull-Rom through every sample, as cubic Béziers. The tangent at a
      // point is set by its neighbours, so the curve leaving a point matches
      // the curve arriving at it and the seam is invisible.
      const at = (index: number) =>
        shape[Math.min(Math.max(index, 0), shape.length - 1)];
      const cornerCosine = Math.cos((CORNER_DEGREES * Math.PI) / 180);

      /**
       * The direction the curve should leave `index` in.
       *
       * Normally the line through its neighbours, which is what makes the
       * join seamless. At a corner it is the outgoing stroke alone, so the
       * curve arrives and leaves along the two strokes that meet there and
       * the point survives.
       */
      const tangentAt = (index: number, outgoing: boolean) => {
        const previous = at(index - 1);
        const here = at(index);
        const next = at(index + 1);
        const arriving = here.minus(previous);
        const leaving = next.minus(here);
        if (arriving.magnitude() === 0 || leaving.magnitude() === 0) {
          return next.minus(previous);
        }
        // How straight the path is through this point. Turning back on itself
        // approaches -1; carrying straight on approaches 1.
        const straightness = arriving
          .normalized()
          .dot(leaving.normalized());
        if (straightness > cornerCosine) return next.minus(previous);
        return outgoing ? leaving : arriving;
      };

      const commands: PathCommand[] = [];
      for (let index = 0; index < shape.length - 1; index += 1) {
        const from = at(index);
        const to = at(index + 1);
        commands.push({
          kind: PathCommandType.CubicBezierTo,
          controlPoint1: from.plus(tangentAt(index, true).times(TANGENT_SCALE)),
          controlPoint2: to.minus(tangentAt(index + 1, false).times(TANGENT_SCALE)),
          endPoint: to,
        });
      }

      return { startPoint: shape[0], commands, style: stroked };
    };

    return {
      getBBox() {
        return Rect2.bboxOf(shapePoints()).grownBy(strokeWidth() / 2);
      },
      addPoint(newPoint: StrokeDataPoint) {
        const next = Vec2.of(newPoint.pos.x, newPoint.pos.y);
        const newest = pending ?? points[points.length - 1];
        if (next.distanceTo(newest) < minimumStep) return;

        widthTotal += Math.max(newPoint.width, 0.1);
        widthSamples += 1;

        if (pending === null) {
          pending = next;
          return;
        }
        // The held sample earns its place only if dropping it would change
        // the line. Otherwise the newer sample takes its place.
        const lastKept = points[points.length - 1];
        if (
          strayFromLine(pending, lastKept, next) >= shapeTolerance ||
          next.distanceTo(lastKept) >= maximumSpan
        ) {
          points.push(pending);
        }
        pending = next;
      },
      preview(renderer) {
        renderer.drawPath(renderablePath());
      },
      build() {
        return new Stroke([renderablePath()]);
      },
      inkTrailStyle() {
        return { color, width: strokeWidth() };
      },
    };
  };
}
