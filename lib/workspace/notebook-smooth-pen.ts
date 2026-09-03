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
import {
  getNotebookPenFeel,
  NOTEBOOK_PEN_SMOOTHING_DEFAULT,
  type NotebookPenFeel,
} from "@/lib/workspace/notebook-pen-feel";

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
 * Easing is deliberately spatial rather than temporal. Smoothing the input
 * harder would ease curves too, but by holding the ink back in time -- which is
 * felt immediately as the pen being dragged, and was the magnetic complaint.
 * Nudging the shape instead costs nothing in time: the ink is still drawn the
 * instant the sample arrives, just a fraction kinder about where the hand
 * wobbled.
 *
 * Two points are exempt however far it is turned up: the newest, so the line
 * always ends exactly under the pen, and any corner, so a deliberate point
 * stays a point. How far the rest are eased, and how sharp a turn has to be
 * before it counts as one of those corners, are the reader's to set --
 * see `getNotebookPenFeel`.
 */

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
const STRAIGHTEN_TOLERANCE = 0.38;

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

/**
 * How one-sided the wander may be before it is a curve rather than a wobble.
 *
 * Distance from the line was doing two jobs and could only do one. Loose enough
 * to accept a genuinely squiggly line -- which is the whole gesture, since
 * nobody who could draw it straight would be holding still to have it fixed --
 * and it also accepted a deliberate arc, which is the one shape a person is
 * least likely to want replaced by a chord.
 *
 * Measured on a 300px stroke: a 50px squiggle scores about 0.06 here, a 40px
 * arc about 0.63. Nothing sits near the middle, so the threshold has room to be
 * wrong by a lot and still be right.
 */
const STRAIGHTEN_MAXIMUM_BOW = 0.32;

/**
 * The eight angles a snapped line is drawn towards, and how near it has to be.
 *
 * Every 45 degrees: upright, flat, and the four diagonals.
 *
 * The pull fades to nothing at the edge of the window rather than stopping
 * there. Switching it on at a threshold means the far end of the line jumps the
 * moment the angle crosses it -- twenty-odd pixels on a long line -- and since a
 * held hand wanders either side of any threshold you care to pick, it jumps
 * back and forth. That is not an assist, it is a flicker, and it is worst
 * exactly where the assist was supposed to help.
 *
 * So the correction is a fraction of the error, and the fraction falls away
 * with distance from the guide: full attention right beside it, none at all at
 * the edge, and no step anywhere in between. Squaring the falloff means it also
 * arrives at the edge flat, so there is no seam where the pull stops.
 *
 * The window can be wider than a hard one could be, because being inside it no
 * longer commits to anything.
 */
/**
 * Below this, the two directions through a point have cancelled.
 *
 * The sum of two unit vectors is twice the cosine of half the turn between
 * them, so this is a turn of about 179.5 degrees -- a reversal by any reading,
 * and far past the hundred at which the corner rule stops asking questions.
 */
const REVERSAL_BISECTOR_FLOOR = 0.01;

/**
 * The circle-to-Bezier constant, for a quarter turn.
 *
 * Used for the round caps on a tapered stroke and for the dot, which is the
 * same shape with no length.
 */
const QUARTER_ARC_HANDLE = 0.5522847498;

/**
 * How many samples either side are averaged into a point's width.
 *
 * Pressure off a digitiser is noisy at a scale the eye reads as a ragged edge
 * rather than as pressure, and the outline shows every bit of it: the centreline
 * is smoothed by the spline, but the distance out to the edge is not smoothed by
 * anything. Averaging over a short run keeps the swell of a stroke while losing
 * the tremble in it.
 */
const WIDTH_SMOOTHING_RADIUS = 2;

/**
 * The thinnest a tapered stroke goes, as a fraction of its own average.
 *
 * Apple Pencil reports very little pressure for the first sample or two of a
 * contact, and a taper that honoured it exactly would start every stroke from
 * nothing -- which reads as the pen failing to catch rather than as a
 * calligraphic entry.
 */
const MINIMUM_WIDTH_FRACTION = 0.35;

/**
 * How much a stroke's width must vary before it is worth drawing as an outline.
 *
 * A mouse, a desktop stylus, and an Apple Pencil held at a steady weight all
 * report one width, and for those the old uniform stroked path is the better
 * answer: half the geometry, and identical on screen. The outline is spent only
 * where there is something for it to show.
 */
const WIDTH_VARIATION_FLOOR = 0.08;

const GUIDE_ANGLE_STEP = Math.PI / 4;
const GUIDE_ANGLE_WINDOW = (8 * Math.PI) / 180;

/** Shorter than this and there is not enough of a line to be sure. */
const STRAIGHTEN_MINIMUM_SPAN_RATIO = 8;

/**
 * The corner threshold is the reader's setting, but this is what it does.
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
 *
 * Set it too low and the opposite complaint appears, which is the one this
 * setting exists for: a small letter is a tight curve, tight enough that the
 * line turns several degrees between one kept point and the next, and every one
 * of those plain curves is then drawn as a point. Two corners in a row are
 * joined by a straight chord, so a run of them is a run of chords -- writing
 * that reads as joining up dots rather than flowing.
 */

/**
 * The shortest run the corner angle may be measured over, in screen pixels.
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

/*
 * Why a turn has to stand out from its neighbours before it is a corner, and
 * why that is a setting rather than a rule -- see `cornerDominance`.
 *
 * The angle alone cannot tell a corner from a curve, because it depends on how
 * far apart the points are, and thinning spaces points by curvature: the
 * tighter the curve the further it turns between one kept point and the next. A
 * small 'o' turns about fifty degrees a step, which is over any threshold low
 * enough to catch the cusp between two letters, so every point on it was drawn
 * as a corner -- and two corners in a row put both control arms on the chord
 * between them, so the piece came out as a literal straight line.
 *
 * What separates them is that a corner is local: turning is concentrated at one
 * point and its neighbours are comparatively straight, where on a curve every
 * point turns about the same amount.
 *
 * But that is smoothing, and it does not belong at the faithful end of the
 * slider. Applied there it rounded off turns somebody had explicitly asked to
 * keep, which is what "even on 0 smoothness the ink is forced into a curve" was.
 */

/**
 * The run each side of a point that its turn is measured over, in screen
 * pixels.
 *
 * Longer than the arm that decides which points to keep, and for a second
 * reason. There, a short arm only had to be long enough that the angle was not
 * pure noise. Here the angle is also the yardstick every neighbouring angle is
 * judged against, so noise in it does damage twice: measured over a single
 * step, a straight stroke wobbling half a pixel turns thirty or forty degrees
 * at every point, and a deliberate sixty-degree corner sitting among those no
 * longer stands out from them. It was being rounded off -- the exact opposite
 * of the complaint. Over a couple of pixels the wobble averages out and the
 * corner is again the only thing turning.
 */
const TURN_ARM_RATIO = 2.5;

/**
 * How many points the reach above may cross to find that run.
 *
 * Reaching is meant to step over samples that landed on top of each other, not
 * to step over shape. Where a curve turns hard the points bunch up, and a walk
 * with no limit hops clean across the turn and reports the whole of it as one
 * angle -- a smooth sine wave came back with 114-degree corners at its peaks,
 * which is the fault this was supposed to be fixing.
 */
const TURN_ARM_MAXIMUM_REACH = 2;

/**
 * A turn this sharp is a corner whatever its neighbours are doing, in degrees.
 *
 * The rule above needs somewhere to stand, and a zigzag denies it one: in a 'w'
 * every vertex is a corner, so each has another corner either side and none of
 * them is locally dominant. Nothing in ordinary writing turns this far without
 * meaning to, so past this the question does not need asking.
 */
const UNMISTAKABLE_CORNER_DEGREES = 100;

export function createNotebookSmoothPenStrokeFactory(
  jsDraw: JsDrawModule,
  feel: NotebookPenFeel = getNotebookPenFeel(NOTEBOOK_PEN_SMOOTHING_DEFAULT)
): ComponentBuilderFactory {
  const { PathCommandType, Rect2, Stroke, Vec2 } = jsDraw;

  /**
   * Cubic Beziers through every point, C1 by construction.
   *
   * The same Catmull-Rom the centreline is drawn with, in a form the two edges
   * of a tapered stroke can also use. Their tangents come from their own
   * neighbours rather than the centreline's, because an offset edge turns
   * through a different angle than the line it was offset from -- sharper on
   * the inside of a bend, gentler on the outside.
   */
  const cubicsThrough = (pts: Point2[]): PathCommand[] => {
    const at = (index: number) =>
      pts[Math.min(Math.max(index, 0), pts.length - 1)];
    const direction = (index: number) => {
      const arriving = at(index).minus(at(index - 1));
      const leaving = at(index + 1).minus(at(index));
      if (arriving.magnitude() === 0) return leaving;
      if (leaving.magnitude() === 0) return arriving;
      const bisector = arriving.normalized().plus(leaving.normalized());
      return bisector.magnitude() < REVERSAL_BISECTOR_FLOOR ? leaving : bisector;
    };

    const commands: PathCommand[] = [];
    for (let index = 0; index < pts.length - 1; index += 1) {
      const from = at(index);
      const to = at(index + 1);
      const reach = to.distanceTo(from) * TANGENT_SCALE;
      const armOut = direction(index);
      const armIn = direction(index + 1);
      commands.push({
        kind: PathCommandType.CubicBezierTo,
        controlPoint1:
          armOut.magnitude() > 0
            ? from.plus(armOut.normalized().times(reach))
            : from,
        controlPoint2:
          armIn.magnitude() > 0 ? to.minus(armIn.normalized().times(reach)) : to,
        endPoint: to,
      });
    }
    return commands;
  };

  /**
   * The round end of a stroke: a half circle from one edge to the other, as two
   * quarter-circle cubics.
   *
   * Drawn rather than left to a line cap because a tapered stroke is a filled
   * outline, and an outline has no caps to set -- the ends are simply part of
   * the shape.
   */
  const semicircle = (
    centre: Point2,
    from: Point2,
    outward: Point2,
    radius: number
  ): PathCommand[] => {
    const spoke = from.minus(centre);
    if (radius <= 0 || spoke.magnitude() === 0 || outward.magnitude() === 0) {
      return [];
    }
    const unit = spoke.normalized();
    const away = outward.normalized();
    const handle = radius * QUARTER_ARC_HANDLE;
    const mid = centre.plus(away.times(radius));
    const to = centre.minus(unit.times(radius));
    return [
      {
        kind: PathCommandType.CubicBezierTo,
        controlPoint1: from.plus(away.times(handle)),
        controlPoint2: mid.plus(unit.times(handle)),
        endPoint: mid,
      },
      {
        kind: PathCommandType.CubicBezierTo,
        controlPoint1: mid.minus(unit.times(handle)),
        controlPoint2: to.plus(away.times(handle)),
        endPoint: to,
      },
    ];
  };

  /** Whether this stroke was drawn with enough varying weight to be worth tapering. */
  const widthVaries = (raw: number[]) => {
    if (raw.length < 3) return false;
    let smallest = raw[0];
    let largest = raw[0];
    let total = 0;
    for (const value of raw) {
      if (value < smallest) smallest = value;
      if (value > largest) largest = value;
      total += value;
    }
    const mean = total / raw.length;
    return mean > 0 && (largest - smallest) / mean >= WIDTH_VARIATION_FLOOR;
  };

  /** Half the width at each point, averaged along the stroke and floored. */
  const halfWidthsAlong = (raw: number[], count: number) => {
    const mean = raw.reduce((sum, value) => sum + value, 0) / Math.max(raw.length, 1);
    const floor = mean * MINIMUM_WIDTH_FRACTION;
    const result: number[] = [];

    for (let index = 0; index < count; index += 1) {
      let total = 0;
      let samples = 0;
      for (
        let offset = -WIDTH_SMOOTHING_RADIUS;
        offset <= WIDTH_SMOOTHING_RADIUS;
        offset += 1
      ) {
        const source = index + offset;
        if (source < 0 || source >= raw.length) continue;
        total += raw[source];
        samples += 1;
      }
      result.push(Math.max(samples ? total / samples : mean, floor) / 2);
    }
    return result;
  };
  const { cornerDegrees, cornerDominance, easeTowardsNeighbours } = feel;

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
    /**
     * The width reported at each kept point, in step with `points`.
     *
     * The average above is still what a uniform stroke is drawn at, and what the
     * bounding box is grown by. This is what lets a stroke that was not drawn at
     * one weight be drawn at the weights it was actually made with.
     */
    const widths: number[] = [Math.max(startPoint.width, 0.1)];
    let pendingWidth = widths[0];
    const minimumStep = Math.max(
      viewport.getSizeOfPixelOnCanvas() * MINIMUM_STEP_RATIO,
      0.01
    );
    const shapeTolerance =
      viewport.getSizeOfPixelOnCanvas() * SHAPE_TOLERANCE_RATIO;
    const maximumSpan = viewport.getSizeOfPixelOnCanvas() * MAXIMUM_SPAN_RATIO;
    const minimumCornerArm =
      viewport.getSizeOfPixelOnCanvas() * MINIMUM_CORNER_ARM_RATIO;
    const turnArm = viewport.getSizeOfPixelOnCanvas() * TURN_ARM_RATIO;
    /** Below this, the line has turned far enough to count as a corner. */
    const cornerCosine = Math.cos((cornerDegrees * Math.PI) / 180);
    const cornerRadians = (cornerDegrees * Math.PI) / 180;
    const unmistakableCorner = (UNMISTAKABLE_CORNER_DEGREES * Math.PI) / 180;
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
    const shapeWidths = () => (pending ? [...widths, pendingWidth] : widths);

    /**
     * The neighbours far enough away for a direction through `index` to mean
     * more than one short digitiser wobble.
     *
     * The same reach has to govern both corner detection and curve tangents.
     * Using it only to decide that a short sideways/backwards sample was not a
     * corner, then letting that sample aim the tangent anyway, gives a tiny
     * noisy step control of the much longer cubic beside it. During fast
     * writing that produces an outward lobe for every uneven packet.
     */
    const turnNeighbourIndicesAt = (shape: Point2[], index: number) => {
      const last = shape.length - 1;
      const here = shape[index];
      let back = Math.max(0, index - 1);
      while (
        back > 0 &&
        index - back < TURN_ARM_MAXIMUM_REACH &&
        here.distanceTo(shape[back]) < turnArm
      ) {
        back -= 1;
      }
      let forward = Math.min(last, index + 1);
      while (
        forward < last &&
        forward - index < TURN_ARM_MAXIMUM_REACH &&
        here.distanceTo(shape[forward]) < turnArm
      ) {
        forward += 1;
      }
      return { back, forward };
    };

    /**
     * How far the line turns at each point, in radians. Ends count as none.
     *
     * A turn measured across a run barely longer than the pen's own step is
     * mostly the digitiser's noise -- half a pixel of wobble either side swings
     * it through tens of degrees. The same guard already governs which points
     * are kept; without it here, a plain sine wave at writing scale still came
     * out with one 114-degree corner in it, invented by two kept samples that
     * happened to land a pixel apart.
     *
     * The measurement widens rather than being thrown away. Discarding it
     * silently rounds off any corner that happens to have a kept point sitting
     * close to it -- measured on a deliberate 60-degree bend, the point
     * vanished entirely -- whereas reaching further out for the arm answers the
     * same question over a run long enough for the answer to mean something.
     */
    const turnsAlong = (shape: Point2[]) => {
      const turns = new Array<number>(shape.length).fill(0);
      const last = shape.length - 1;
      for (let index = 1; index < last; index += 1) {
        const here = shape[index];
        const { back, forward } = turnNeighbourIndicesAt(shape, index);
        const arriving = here.minus(shape[back]);
        const leaving = shape[forward].minus(here);
        if (arriving.magnitude() === 0 || leaving.magnitude() === 0) continue;
        const straightness = Math.max(
          -1,
          Math.min(1, arriving.normalized().dot(leaving.normalized()))
        );
        turns[index] = Math.acos(straightness);
      }
      return turns;
    };

    /**
     * Which points the curve is allowed to come to a point at.
     *
     * Sharp enough on its own settles it. Otherwise the turn has to stand out
     * from the ones either side of it, which is what tells a deliberate point
     * from a curve drawn tightly -- see `cornerDominance`.
     */
    const cornersAlong = (shape: Point2[]) => {
      const turns = turnsAlong(shape);
      return turns.map((turn, index) => {
        if (turn >= unmistakableCorner) return true;
        if (turn < cornerRadians) return false;
        const around = Math.max(turns[index - 1] ?? 0, turns[index + 1] ?? 0);
        return turn >= around * cornerDominance;
      });
    };

    /**
     * Eases each interior point a fraction towards the line between its
     * neighbours, so a curve drawn by hand comes out a little rounder.
     *
     * The first and last are left exactly where they were: the last is under
     * the pen right now, and moving it is what would be felt as lag. Corners
     * are left alone too, since easing one is the same as rounding it off.
     */
    const easedShape = (shape: Point2[], corners: boolean[]) => {
      if (shape.length < 3 || easeTowardsNeighbours <= 0) return shape;

      const eased: Point2[] = [shape[0]];
      for (let index = 1; index < shape.length - 1; index += 1) {
        const previous = shape[index - 1];
        const here = shape[index];
        const next = shape[index + 1];

        eased.push(
          corners[index]
            ? here
            : here.plus(
                previous
                  .plus(next)
                  .times(0.5)
                  .minus(here)
                  .times(easeTowardsNeighbours)
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
      const raw = shapePoints();
      const shape = easedShape(raw, cornersAlong(raw));
      if (shape.length < 3) return null;

      const from = shape[0];
      const to = shape[shape.length - 1];
      const span = to.distanceTo(from);
      if (span < strokeWidth() * STRAIGHTEN_MINIMUM_SPAN_RATIO) return null;

      const along = to.minus(from).times(1 / span);
      let worstStray = 0;
      let furthestAlong = 0;
      let worstBacktrack = 0;
      let signedTotal = 0;
      for (const point of shape) {
        const offset = point.minus(from);
        /*
         * Which side of the line, not just how far off it.
         *
         * The distance alone cannot tell a wobble from a curve, and the two
         * want opposite answers: a hand aiming for a line crosses it over and
         * over, so its offsets cancel, while an arc stays out on one side the
         * whole way and its offsets add up. Measured on a 300px stroke, a
         * 50-pixel squiggle and a 40-pixel arc sit within a few pixels of each
         * other on distance and at opposite ends of this.
         */
        signedTotal += along.x * offset.y - along.y * offset.x;
        worstStray = Math.max(worstStray, strayFromLine(point, from, to));
        const travelled = offset.dot(along);
        worstBacktrack = Math.max(worstBacktrack, furthestAlong - travelled);
        furthestAlong = Math.max(furthestAlong, travelled);
      }

      if (worstStray > span * STRAIGHTEN_TOLERANCE) return null;
      if (worstBacktrack > span * STRAIGHTEN_MAXIMUM_BACKTRACK) return null;

      // Averaged over the points, then measured against how far the worst of
      // them strayed: a stroke that never crossed the line scores 1, one that
      // spent equal time either side scores 0.
      const bow = worstStray
        ? Math.abs(signedTotal / shape.length) / worstStray
        : 0;
      if (bow > STRAIGHTEN_MAXIMUM_BOW) return null;
      return { from, to };
    };

    /**
     * Where the aimed end of a snapped line actually goes.
     *
     * Once a line has snapped, swinging it is how the angle gets chosen, and
     * the angles people are reaching for are almost always the same eight:
     * upright, flat, and the diagonals between. Free aiming makes those the
     * hardest to land, because they are the only ones where being a degree out
     * is visible -- a line meant to be vertical and sitting at 89 looks wrong in
     * a way that one at 34 does not.
     *
     * So near one of the eight, the line leans towards it -- by a share of how
     * far off it is, not all the way. Close by, that share is nearly all of it
     * and the line reads as exactly upright; further out it is a nudge; at the
     * edge of the window it is nothing. The angle asked for is always still the
     * angle being drawn, just flattered.
     *
     * The length comes from how far along that direction the pen has reached
     * rather than from the raw distance, so the far end stays level with the
     * hand instead of running past it.
     */
    const aimedAt = (from: Point2, to: Point2) => {
      const reach = to.minus(from);
      const length = reach.magnitude();
      if (length < minimumStep) return to;

      const angle = Math.atan2(reach.y, reach.x);
      const nearest = Math.round(angle / GUIDE_ANGLE_STEP) * GUIDE_ANGLE_STEP;
      const error = angle - nearest;
      const offBy = Math.abs(error) / GUIDE_ANGLE_WINDOW;
      if (offBy >= 1) return to;

      /*
       * Squared twice over, so the well around a guide is deep and its rim is
       * flat. Measured on a 300px line: two degrees off a guide leaves the far
       * end 1.3px from true, which nobody can see, while the line never travels
       * more than 1.8 times as fast as the hand moving it -- fast enough to feel
       * like help, slow enough that there is nothing to catch on.
       *
       * A plain (1 - t) squared was gentler still at 1.3x, but left two degrees
       * sitting 4.6px out, which is visible on a line meant to be upright: soft
       * to the point of not doing the job.
       */
      const pull = (1 - offBy * offBy) * (1 - offBy * offBy);
      const aimed = angle - error * pull;
      const direction = Vec2.of(Math.cos(aimed), Math.sin(aimed));
      return from.plus(direction.times(reach.dot(direction)));
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

      const raw = shapePoints();
      const corners = cornersAlong(raw);
      const shape = easedShape(raw, corners);

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
        const here = at(index);
        const immediatePrevious = at(index - 1);
        const immediateNext = at(index + 1);
        if (corners[index]) {
          const arriving = here.minus(immediatePrevious);
          const leaving = immediateNext.minus(here);
          return outgoing ? leaving : arriving;
        }

        /*
         * Match the wider measurement that decided this was a curve. A point
         * too close to carry a trustworthy angle is also too close to aim a
         * long control arm; otherwise sparse fast input grows a row of loops
         * outside the narrow band the pen visited.
         */
        const { back, forward } = turnNeighbourIndicesAt(raw, index);
        const previous = at(back);
        const next = at(forward);
        const arriving = here.minus(previous);
        const leaving = next.minus(here);
        if (arriving.magnitude() === 0 || leaving.magnitude() === 0) {
          return next.minus(previous);
        }
        /*
         * The direction through the point, taken from the two segments as
         * directions rather than as the chord between the outer points.
         *
         * The chord is the textbook Catmull-Rom tangent and it assumes points
         * are evenly spaced, which thinning guarantees they are not: it keeps
         * points where the line bends and drops them where it does not, so a
         * 20px run regularly meets a 2px one. The chord across that pair points
         * almost entirely along the long side, which swings the short segment's
         * curve out and back -- a kink at exactly the tight turns this is meant
         * to be smoothing. Normalising first weighs the two equally, so the
         * tangent bisects the turn however lopsided the spacing.
         */
        const bisector = arriving.normalized().plus(leaving.normalized());
        /*
         * Two opposite directions cancel, and normalising what is left is
         * normalising rounding error -- the arm then points somewhere arbitrary
         * and the curve leaving the point can set off backwards.
         *
         * A turn that sharp is a reversal, so the strokes either side of it are
         * the honest answer anyway. The guard is here rather than left to the
         * corner rule because the two measure the turn over different runs, and
         * a near-reversal between two points a pixel apart can pass one while
         * degenerating the other.
         */
        if (bisector.magnitude() < REVERSAL_BISECTOR_FLOOR) {
          return outgoing ? leaving : arriving;
        }
        return bisector;
      };

      /*
       * A stroke drawn at varying weight is drawn as its own outline.
       *
       * A stroked path has one width for its whole length, so for as long as
       * the pen was one it could not taper: pressure could only be averaged
       * into a single heavier or lighter line, and an Apple Pencil wrote the
       * same flat mark as a mouse. What gives handwriting its life is the
       * modulation along a stroke -- heavy through the downstroke, fine out of
       * the exit -- and the only way to draw that is to draw both edges.
       *
       * Spent only where there is something to show. Anything reporting one
       * steady width still takes the stroked path above: identical on screen,
       * and half the geometry to store and reparse.
       */
      const sampledWidths = shapeWidths();
      if (widthVaries(sampledWidths)) {
        const halfWidths = halfWidthsAlong(sampledWidths, shape.length);
        const last = shape.length - 1;
        const normalAt = (index: number) => {
          const along = at(Math.min(index + 1, last)).minus(
            at(Math.max(index - 1, 0))
          );
          if (along.magnitude() === 0) return Vec2.of(0, 1);
          const unit = along.normalized();
          return Vec2.of(-unit.y, unit.x);
        };

        const normals = shape.map((_, index) => normalAt(index));
        const left = shape.map((point, index) =>
          point.plus(normals[index].times(halfWidths[index]))
        );
        const right = shape.map((point, index) =>
          point.minus(normals[index].times(halfWidths[index]))
        );

        // Out along one edge, round the end, back along the other, round the
        // start. One closed loop: a stroke made of separate subpaths is welded
        // into a zig-zag by everything downstream that closes a path.
        return {
          startPoint: left[0],
          commands: [
            ...cubicsThrough(left),
            ...semicircle(
              shape[last],
              left[last],
              at(last).minus(at(last - 1)),
              halfWidths[last]
            ),
            ...cubicsThrough([...right].reverse()),
            ...semicircle(
              shape[0],
              right[0],
              at(0).minus(at(1)),
              halfWidths[0]
            ),
          ],
          style: { fill: color },
        };
      }

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
            straightened = {
              from: straightened.from,
              to: aimedAt(straightened.from, next),
            };
          }
          return;
        }
        const newest = pending ?? points[points.length - 1];
        if (next.distanceTo(newest) < minimumStep) return;

        const sampleWidth = Math.max(newPoint.width, 0.1);
        widthTotal += sampleWidth;
        widthSamples += 1;

        if (pending === null) {
          pending = next;
          pendingWidth = sampleWidth;
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
          widths.push(pendingWidth);
        }
        pending = next;
        pendingWidth = sampleWidth;
      },
      preview(renderer) {
        renderer.drawPath(renderablePath());
      },
      build() {
        return new Stroke([renderablePath()]);
      },
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
