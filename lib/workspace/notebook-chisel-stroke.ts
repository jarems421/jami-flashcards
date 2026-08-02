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
     * Smooths one edge of the outline into quadratic curves through the
     * midpoints between samples, with each sample as a control point. Straight
     * segments would show every sample as a corner along the edge, which is
     * what made the stroke look constructed rather than drawn.
     */
    const smoothEdge = (edge: Point2[]): PathCommand[] => {
      if (edge.length < 2) return [];
      if (edge.length === 2) {
        return [{ kind: PathCommandType.LineTo, point: edge[1] }];
      }

      const commands: PathCommand[] = [];
      for (let index = 1; index < edge.length - 1; index += 1) {
        commands.push({
          kind: PathCommandType.QuadraticBezierTo,
          controlPoint: edge[index],
          endPoint: edge[index].lerp(edge[index + 1], 0.5),
        });
      }
      commands.push({
        kind: PathCommandType.LineTo,
        point: edge[edge.length - 1],
      });
      return commands;
    };

    /**
     * Which side of the nib the stroke is currently travelling towards.
     *
     * This is the crux of keeping the stroke continuous. Offsetting every
     * sample by `+nib` and `-nib` only describes the swept area while the path
     * stays on one side of the nib's axis. The moment travel crosses that axis
     * the two edges swap sides, the outline folds into a bowtie, and the
     * crossed lobe cancels itself under the nonzero winding rule -- which is
     * seen as the stroke stopping dead mid-curve and resuming after the turn.
     *
     * Splitting into runs at each crossing keeps every run's outline
     * well-formed. The runs meet where the stroke is momentarily edge-on and
     * genuinely has no width, so they join seamlessly.
     */
    const travelSide = (from: Point2, to: Point2) => {
      const direction = to.minus(from);
      const cross = nib.x * direction.y - nib.y * direction.x;
      return cross >= 0 ? 1 : -1;
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

      // Split the samples into runs that stay on one side of the nib's axis.
      const runs: Point2[][] = [];
      let current = [points[0]];
      let side = travelSide(points[0], points[1]);
      for (let index = 1; index < points.length; index += 1) {
        const nextSide = travelSide(points[index - 1], points[index]);
        if (nextSide !== side && current.length > 1) {
          current.push(points[index - 1]);
          runs.push(current);
          // The new run restarts from the turn, so the two share a point and
          // meet without a seam.
          current = [points[index - 1]];
          side = nextSide;
        }
        current.push(points[index]);
      }
      if (current.length > 1) runs.push(current);

      const commands: PathCommand[] = [];
      let pathStart: Point2 | null = null;

      for (const run of runs) {
        // Keeping every run wound the same way matters: two subpaths of
        // opposite winding would cancel where they overlap and reopen the
        // hole this split exists to close.
        const towards = travelSide(run[0], run[1]) > 0 ? nib : nib.times(-1);
        const outward = run.map((point) => point.plus(towards));
        const back = run.map((point) => point.minus(towards)).reverse();

        if (pathStart === null) {
          pathStart = outward[0];
        } else {
          commands.push({ kind: PathCommandType.MoveTo, point: outward[0] });
        }
        commands.push(...smoothEdge(outward));
        commands.push({ kind: PathCommandType.LineTo, point: back[0] });
        commands.push(...smoothEdge(back));
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
