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
 *
 * This was a quarter of a pixel, which is below the digitiser's own noise, so
 * the test was reading jitter rather than shape and almost nothing was thinned.
 * Measured against a hand wobbling half a pixel, a slow ruled line kept 150
 * curves and the drawn line still sat 0.64px off true -- it was faithfully
 * reproducing the wobble. Just above the noise it keeps 35 and sits 0.99px off:
 * a quarter of the work for a tenth of a pixel, and a visibly steadier line.
 *
 * The ceiling is the small round letter. At half a pixel an 'o' loses its shape
 * (0.85px off true here, 2.52px there), which is the flattening the span rule
 * below also guards against. This sits under that.
 */
const SHAPE_TOLERANCE_RATIO = 0.4;

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

/**
 * How much of a segment each control arm takes, as a fraction of that
 * segment's own length.
 *
 * A third either side is the classic Catmull-Rom arm for evenly spaced points,
 * and it keeps a cubic inside the two points it joins. The arm has to be
 * measured against *this* segment: thinning leaves points very unevenly
 * spaced, so an arm sized from the span between a point's neighbours can come
 * out longer than the short segment it belongs to, and the curve then bulges
 * past where the pen went.
 */
const TANGENT_SCALE = 1 / 3;

/**
 * How far a point may be eased towards the line between its neighbours.
 *
 * The lightest possible guidance, and deliberately spatial rather than
 * temporal. Smoothing the input harder would ease curves too, but by holding
 * the ink back in time -- which is felt immediately as the pen being dragged,
 * and was the magnetic complaint. Nudging the shape instead costs nothing in
 * time: the ink is still drawn the instant the sample arrives, just a fraction
 * kinder about where the hand wobbled.
 *
 * Kept small enough not to be noticed except side by side. Two points are
 * exempt on principle: the newest, so the line always ends exactly under the
 * pen, and any corner, so a deliberate point stays a point.
 */
const EASE_TOWARDS_NEIGHBOURS = 0.34;

/**
 * How far a stroke may wander from the straight line between its ends and
 * still be taken as an attempt at one, as a fraction of that line's length.
 *
 * Holding still at the end of a stroke snaps it straight. This used to be
 * strict, on the reasoning that straightening something the hand did not mean
 * as a line overwrites a finished drawing -- but it was strict enough that only
 * an already-straight line qualified, which is the one case that needs no help.
 * A ruled line drawn freehand wanders, and a rough one is exactly what somebody
 * holding their pen still is asking to have tidied.
 *
 * What guards this is not the tolerance but the gesture: nobody stops dead at
 * the end of ordinary writing, they lift. And the result can now be adjusted
 * before it commits, so a snap that came out wrong is redirected rather than
 * redrawn.
 */
const STRAIGHTEN_TOLERANCE = 0.22;

/**
 * How far a stroke may run backwards along its own line and still be taken as
 * an attempt at one, as a fraction of that line's length.
 *
 * Sideways wandering is what a rough line does; coming back on itself is what a
 * `v`, an `n` or a zigzag does. Allowing the first generously while still
 * refusing the second is what stops the loose tolerance above straightening
 * shapes that only happen to start and end far apart.
 */
const STRAIGHTEN_MAXIMUM_BACKTRACK = 0.12;

/** Shorter than this and there is not enough of a line to be sure. */
const STRAIGHTEN_MINIMUM_SPAN_RATIO = 8;

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

/**
 * The shortest run the angle above may be measured over, in screen pixels.
 *
 * An angle between two segments a pixel long is mostly the digitiser's noise:
 * half a pixel of wobble either side swings it through tens of degrees, so a
 * slowly drawn straight line arrives full of corners that were never made. That
 * is expensive twice over -- a corner is kept rather than thinned, and corners
 * are exempt from easing, so the wobble that invented it is then preserved on
 * purpose. Measured on a small 'o', ignoring these took it from 79 curves to 44
 * *and* moved the drawn line closer to the true shape.
 *
 * A step and a half of travel, so it can only ever suppress an angle there was
 * not enough movement to measure. A corner drawn deliberately clears it
 * immediately, and one drawn slowly is kept by the offset test regardless,
 * since sitting far off the line between its neighbours is what a corner is.
 */
const MINIMUM_CORNER_ARM_RATIO = MINIMUM_STEP_RATIO * 1.5;

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
    const minimumCornerArm =
      viewport.getSizeOfPixelOnCanvas() * MINIMUM_CORNER_ARM_RATIO;
    /** Below this, the line has turned far enough to count as a corner. */
    const cornerCosine = Math.cos((CORNER_DEGREES * Math.PI) / 180);
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
    /**
     * Set once the stroke has snapped straight, after which the stroke *is*
     * this line and the pen is aiming it rather than drawing.
     *
     * Snapping used to be the end of it: the line appeared, and any further
     * movement threw it away and went back to the freehand path, so getting the
     * angle right meant drawing it again until it landed. Keeping the line and
     * letting its far end follow the pen turns that into aiming -- swing to
     * pivot, come back along it to shorten, lift when it looks right. The near
     * end stays where the stroke began, which is the end the hand has already
     * committed to.
     */
    let straightened: { from: Point2; to: Point2 } | null = null;

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

    /**
     * Eases each interior point a fraction towards the line between its
     * neighbours, so a curve drawn by hand comes out a little rounder.
     *
     * The first and last are left exactly where they were: the last is under
     * the pen right now, and moving it is what would be felt as lag. Corners
     * are left alone too, since easing one is the same as rounding it off.
     */
    const easedShape = (shape: Point2[]) => {
      if (shape.length < 3) return shape;

      const eased: Point2[] = [shape[0]];
      for (let index = 1; index < shape.length - 1; index += 1) {
        const previous = shape[index - 1];
        const here = shape[index];
        const next = shape[index + 1];
        const arriving = here.minus(previous);
        const leaving = next.minus(here);
        const isCorner =
          arriving.magnitude() > 0 &&
          leaving.magnitude() > 0 &&
          arriving.normalized().dot(leaving.normalized()) < cornerCosine;

        eased.push(
          isCorner
            ? here
            : here.plus(
                previous
                  .plus(next)
                  .times(0.5)
                  .minus(here)
                  .times(EASE_TOWARDS_NEIGHBOURS)
              )
        );
      }
      eased.push(shape[shape.length - 1]);
      return eased;
    };

    /** Whichever straight line the stroke has been aimed at so far. */
    const straightLineSpec = (
      from: Point2,
      to: Point2
    ): RenderablePathSpec => ({
      startPoint: from,
      commands: [{ kind: PathCommandType.LineTo, point: to }],
      style: {
        fill: jsDraw.Color4.transparent,
        stroke: { color, width: strokeWidth() },
      },
    });

    /**
     * The line this stroke would snap to, or null if it is not a line.
     *
     * Judged on the eased shape rather than the raw samples, so the same points
     * decide it that would have been drawn.
     */
    const straightenedShape = () => {
      const shape = easedShape(shapePoints());
      if (shape.length < 3) return null;

      const from = shape[0];
      const to = shape[shape.length - 1];
      const span = to.distanceTo(from);
      if (span < strokeWidth() * STRAIGHTEN_MINIMUM_SPAN_RATIO) return null;

      const along = to.minus(from).times(1 / span);
      let worstStray = 0;
      let furthestAlong = 0;
      let worstBacktrack = 0;
      for (const point of shape) {
        worstStray = Math.max(worstStray, strayFromLine(point, from, to));
        const travelled = point.minus(from).dot(along);
        worstBacktrack = Math.max(worstBacktrack, furthestAlong - travelled);
        furthestAlong = Math.max(furthestAlong, travelled);
      }

      if (worstStray > span * STRAIGHTEN_TOLERANCE) return null;
      if (worstBacktrack > span * STRAIGHTEN_MAXIMUM_BACKTRACK) return null;
      return { from, to };
    };

    const renderablePath = (): RenderablePathSpec => {
      if (straightened) {
        return straightLineSpec(straightened.from, straightened.to);
      }

      const width = strokeWidth();
      const stroked = {
        fill: jsDraw.Color4.transparent,
        stroke: { color, width },
      };

      const shape = easedShape(shapePoints());

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
        // Direction from the neighbours, length from this segment alone.
        const reach = to.distanceTo(from) * TANGENT_SCALE;
        const armOut = tangentAt(index, true);
        const armIn = tangentAt(index + 1, false);
        commands.push({
          kind: PathCommandType.CubicBezierTo,
          controlPoint1:
            armOut.magnitude() > 0
              ? from.plus(armOut.normalized().times(reach))
              : from,
          controlPoint2:
            armIn.magnitude() > 0
              ? to.minus(armIn.normalized().times(reach))
              : to,
          endPoint: to,
        });
      }

      return { startPoint: shape[0], commands, style: stroked };
    };

    return {
      getBBox() {
        const shape = straightened
          ? [straightened.from, straightened.to]
          : shapePoints();
        return Rect2.bboxOf(shape).grownBy(strokeWidth() / 2);
      },
      addPoint(newPoint: StrokeDataPoint) {
        const next = Vec2.of(newPoint.pos.x, newPoint.pos.y);
        // Already a line: the pen is aiming its far end, not adding to a path.
        if (straightened) {
          if (next.distanceTo(straightened.to) >= minimumStep) {
            straightened = { from: straightened.from, to: next };
          }
          return;
        }
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
        /*
         * How far the line turns at the held sample.
         *
         * Sideways offset alone is not enough to decide this. Where a stroke
         * doubles back -- up the stem of an 'l' and down it again, round the
         * top of an 'e' -- the point before the turn and the point after it
         * lie on the same line, so the far end has no offset from that line
         * whatsoever. Judged on offset it looks like a sample carrying no
         * shape, and dropping it pulls the ink back short of where the pen
         * actually went. Anywhere the line turns enough to be drawn as a
         * corner has to be kept for the same reason.
         */
        const arriving = pending.minus(lastKept);
        const leaving = next.minus(pending);
        const turns =
          arriving.magnitude() > minimumCornerArm &&
          leaving.magnitude() > minimumCornerArm &&
          arriving.normalized().dot(leaving.normalized()) < cornerCosine;

        if (
          turns ||
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
      /**
       * Called when the pen is held still, to offer a tidied version of what
       * has been drawn. Returning null leaves the stroke exactly as drawn.
       *
       * The line is returned so it appears the moment it snaps, and kept so the
       * pen can go on aiming it. js-draw discards what it was shown as soon as
       * the pen moves again and falls back to asking the builder what it built
       * -- which by then is the aimed line. It restores the snapped version only
       * if the pen lifts within a few hundred milliseconds of first twitching,
       * which is the accidental nudge that guard is there for, not an
       * adjustment.
       */
      async autocorrectShape() {
        if (straightened) return null;
        const line = straightenedShape();
        if (!line) return null;

        straightened = line;
        return new Stroke([straightLineSpec(line.from, line.to)]);
      },
    };
  };
}
