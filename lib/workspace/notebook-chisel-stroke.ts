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
 * The nib's narrow dimension, as a fraction of stroke width. Only visible on a
 * tap, where a flat edge would otherwise enclose no area and draw nothing.
 */
const NIB_NARROW_RATIO = 0.16;

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

export function createNotebookChiselStrokeFactory(
  jsDraw: JsDrawModule
): ComponentBuilderFactory {
  const { PathCommandType, Rect2, Stroke, Vec2 } = jsDraw;
  const angle = (NIB_ANGLE_DEGREES * Math.PI) / 180;

  return (startPoint: StrokeDataPoint, viewport: Viewport): ComponentBuilder => {
    const color: Color4 = startPoint.color;
    const halfWidth = Math.max(startPoint.width, 0.1) / 2;
    const nib = Vec2.of(Math.cos(angle), Math.sin(angle)).times(halfWidth);
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
        // A tap. A flat edge encloses no area on its own, so the nib's narrow
        // dimension is what makes the mark visible at all.
        const narrow = Vec2.of(-Math.sin(angle), Math.cos(angle)).times(
          halfWidth * NIB_NARROW_RATIO
        );
        const centre = points[0];
        const corners = [
          centre.plus(nib).plus(narrow),
          centre.plus(nib).minus(narrow),
          centre.minus(nib).minus(narrow),
          centre.minus(nib).plus(narrow),
        ];
        return {
          startPoint: corners[0],
          commands: corners.slice(1).map(
            (point): PathCommand => ({ kind: PathCommandType.LineTo, point })
          ),
          style,
        };
      }

      /*
       * One parallelogram per step, rather than one outline around the whole
       * stroke.
       *
       * A single outline is only valid while the path stays on one side of the
       * nib's axis and never turns tighter than the nib reaches. Cross either
       * limit and the outline folds back through itself; the crossed region
       * takes a winding number of zero and is punched out of the fill. That is
       * the stroke breaking mid-curve, and the mesh of holes where a stroke
       * doubles back over itself in one motion.
       *
       * Sweeping each step separately removes the possibility rather than
       * handling the cases. Every parallelogram is convex and cannot fold, and
       * wound the same way they can only ever add: a point covered by five of
       * them has a winding number of five, not one or zero. It costs more
       * points in the saved path, which is the right trade for a highlighter
       * that never eats a hole in itself.
       */
      const path = steadied(points);
      const commands: PathCommand[] = [];
      let pathStart: Point2 | null = null;

      for (let index = 1; index < path.length; index += 1) {
        const from = path[index - 1];
        const to = path[index];
        const direction = to.minus(from);
        // Winding has to match across every step, so the offset is taken
        // towards whichever side keeps this one turning the same way.
        const cross = nib.x * direction.y - nib.y * direction.x;
        const towards = cross >= 0 ? nib : nib.times(-1);
        const corners = [
          from.plus(towards),
          to.plus(towards),
          to.minus(towards),
          from.minus(towards),
        ];

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
