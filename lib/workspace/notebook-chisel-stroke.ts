import type {
  Color4,
  ComponentBuilder,
  ComponentBuilderFactory,
  PathCommand,
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
 * Builds strokes shaped by a flat nib rather than a round one.
 *
 * The outline is one filled polygon: every sample offset by `+nib` on the way
 * out, then the same samples offset by `-nib` on the way back. Areas where a
 * stroke crosses itself fill once under the nonzero winding rule, so scrubbing
 * back and forth over the same words stays one even wash rather than darkening
 * at every crossing.
 */
export function createNotebookChiselStrokeFactory(
  jsDraw: JsDrawModule
): ComponentBuilderFactory {
  const { PathCommandType, Rect2, Stroke, Vec2 } = jsDraw;
  const angle = (NIB_ANGLE_DEGREES * Math.PI) / 180;

  return (startPoint: StrokeDataPoint, viewport: Viewport): ComponentBuilder => {
    const color: Color4 = startPoint.color;
    const halfWidth = Math.max(startPoint.width, 0.1) / 2;
    const nib = Vec2.of(Math.cos(angle), Math.sin(angle)).times(halfWidth);
    // Samples closer together than a pixel cannot change the rendered shape,
    // and each one kept is two more points in the saved path.
    const minimumStep = Math.max(viewport.getSizeOfPixelOnCanvas() * 0.65, 0.01);

    const points = [Vec2.of(startPoint.pos.x, startPoint.pos.y)];

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

      const commands: PathCommand[] = [];
      for (let index = 1; index < points.length; index += 1) {
        commands.push({
          kind: PathCommandType.LineTo,
          point: points[index].plus(nib),
        });
      }
      for (let index = points.length - 1; index >= 0; index -= 1) {
        commands.push({
          kind: PathCommandType.LineTo,
          point: points[index].minus(nib),
        });
      }

      return { startPoint: points[0].plus(nib), commands, style };
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
