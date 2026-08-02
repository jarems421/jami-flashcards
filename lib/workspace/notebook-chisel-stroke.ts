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
 * A chisel-tip stroke builder, for the highlighter.
 *
 * A pen's outline is offset *perpendicular to the direction of travel*, which
 * is why it stays the same width whichever way it moves and ends in a round
 * cap. A chisel nib is a flat edge held at a fixed angle, so its outline is
 * offset along a *fixed vector* regardless of direction. That one difference
 * produces the whole highlighter character: broad horizontal strokes, slanted
 * ends, and a stroke that narrows as it turns towards the nib's own axis.
 *
 * js-draw ships no calligraphic pen, so this implements its ComponentBuilder
 * interface directly. Nothing about the saved format changes -- the result is
 * an ordinary filled path -- so existing notebooks are untouched and strokes
 * drawn here open anywhere the old ones do.
 */

/**
 * The angle of the flat edge, measured from horizontal.
 *
 * Steep enough that ordinary left-to-right highlighting keeps nearly the full
 * thickness (sin 65 degrees is about 0.91) while still slanting the ends
 * enough to read as a chisel rather than a rectangle. This is the one number
 * worth tuning if the shape feels wrong.
 */
const NIB_ANGLE_DEGREES = 65;

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
  jsDraw: JsDrawModule
): ComponentBuilderFactory {
  const { PathCommandType, Rect2, Stroke, Vec2 } = jsDraw;
  const angle = (NIB_ANGLE_DEGREES * Math.PI) / 180;

  return (startPoint: StrokeDataPoint, viewport: Viewport): ComponentBuilder => {
    const color: Color4 = startPoint.color;
    const halfWidth = Math.max(startPoint.width, 0.1) / 2;
    const nib = Vec2.of(Math.cos(angle), Math.sin(angle)).times(halfWidth);
    // Across the nib's width, and across its thickness.
    const narrow = Vec2.of(-Math.sin(angle), Math.cos(angle)).times(
      halfWidth * NIB_NARROW_RATIO
    );
    /** The four corners of the tip, placed at a point on the path. */
    const tipAt = (centre: Point2) => [
      centre.plus(nib).plus(narrow),
      centre.plus(nib).minus(narrow),
      centre.minus(nib).minus(narrow),
      centre.minus(nib).plus(narrow),
    ];
    const minimumStep = Math.max(
      viewport.getSizeOfPixelOnCanvas() * 0.65,
      halfWidth * GUIDE_STEP_RATIO
    );

    const points = [Vec2.of(startPoint.pos.x, startPoint.pos.y)];

    /**
     * Eases the tremor out of the sampled path before it is swept.
     *
     * The steadying happens here, on the centre line, rather than on the
     * outline. Smoothing the outline instead only makes the edges prettier
     * while leaving the shape doing whatever the hand did.
     */
    const steadied = (raw: Point2[]) => {
      if (raw.length < 3) return raw;

      const smoothed = [raw[0]];
      for (let index = 1; index < raw.length - 1; index += 1) {
        smoothed.push(
          raw[index - 1]
            .plus(raw[index].times(2))
            .plus(raw[index + 1])
            .times(0.25)
        );
      }
      smoothed.push(raw[raw.length - 1]);
      return smoothed;
    };

    const renderablePath = (): RenderablePathSpec => {
      const style = { fill: color };

      if (points.length === 1) {
        // A tap leaves the tip's own footprint.
        const corners = tipAt(points[0]);
        return {
          startPoint: corners[0],
          commands: corners.slice(1).map(
            (point): PathCommand => ({ kind: PathCommandType.LineTo, point })
          ),
          style,
        };
      }

      /*
       * One swept footprint per step, rather than one outline around the whole
       * stroke.
       *
       * A single outline is only valid while the path stays on one side of the
       * nib's axis and never turns tighter than the nib reaches. Cross either
       * limit and the outline folds back through itself; the crossed region
       * takes a winding number of zero and is punched out of the fill. That
       * was the stroke breaking mid-curve, and the mesh of holes where one
       * motion doubled back over itself.
       *
       * Sweeping each step separately removes the possibility rather than
       * handling the cases. Every footprint is convex and cannot fold, and
       * wound the same way they can only ever add: a point covered by five of
       * them has a winding number of five, not one or zero. It costs more
       * points in the saved path, which is the right trade for a highlighter
       * that never eats a hole in itself.
       */
      const path = steadied(points);
      const commands: PathCommand[] = [];
      let pathStart: Point2 | null = null;

      for (let index = 1; index < path.length; index += 1) {
        // The area a rectangular tip covers sliding from one point to the next
        // is the hull of its footprint at both ends. Sweeping the tip rather
        // than a bare edge is what keeps the stroke alive when it turns to run
        // along the nib, where an edge would sweep nothing at all.
        const corners = convexHull([
          ...tipAt(path[index - 1]),
          ...tipAt(path[index]),
        ]);
        if (corners.length < 3) continue;

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
        startPoint: pathStart ?? points[0].plus(nib),
        commands,
        style,
      };
    };

    return {
      getBBox() {
        return Rect2.bboxOf(points).grownBy(halfWidth);
      },
      addPoint(newPoint: StrokeDataPoint) {
        const next = Vec2.of(newPoint.pos.x, newPoint.pos.y);
        if (next.distanceTo(points[points.length - 1]) < minimumStep) return;
        points.push(next);
      },
      preview(renderer) {
        renderer.drawPath(renderablePath());
      },
      build() {
        return new Stroke([renderablePath()]);
      },
      /**
       * The live ink trail some browsers render ahead of the committed stroke.
       * It is round rather than chisel-shaped, which is a visible compromise
       * for the length of one stroke -- but it is what keeps ink under the
       * Pencil instead of trailing it, and the true shape lands the instant
       * the stroke commits.
       */
      inkTrailStyle() {
        return { color, width: halfWidth * 2 };
      },
    };
  };
}
