import type {
  Color4,
  ComponentBuilder,
  ComponentBuilderFactory,
  StrokeDataPoint,
  Viewport,
} from "js-draw";
import {
  createInkChiselBuilder,
  type InkChiselGeometry,
} from "@/lib/ink/geometry/chisel";
import type { JsDrawModule } from "@/lib/workspace/notebook-js-draw";
import { NIB_ANGLE_DEFAULT } from "@/lib/workspace/notebook-nib-angle";
import { renderablePathFrom } from "@/lib/workspace/notebook-stroke-builder-adapter";

/**
 * A chisel-tip stroke builder, for the highlighter, as js-draw draws it.
 *
 * The shape of the stroke -- the nib swept along the path, one footprint per
 * step, and their union at the lift -- is `lib/ink/geometry/chisel.ts`, which
 * knows nothing of js-draw. This is the ComponentBuilder around it: samples in,
 * js-draw paths out, and the colour, which the geometry does not carry.
 *
 * Nothing about the saved format changes -- the result is an ordinary filled
 * path -- so existing notebooks are untouched and strokes drawn here open
 * anywhere the old ones do.
 *
 * It offers no `inkTrailStyle`, deliberately: see
 * `notebook-stroke-builder-adapter.ts`. The compositor trail some browsers
 * render ahead of a stroke would be round rather than chisel-shaped.
 */
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
  const { Rect2, Stroke, Vec2 } = jsDraw;

  return (startPoint: StrokeDataPoint, viewport: Viewport): ComponentBuilder => {
    const color: Color4 = startPoint.color;
    const sampleOf = (point: StrokeDataPoint) => ({
      x: point.pos.x,
      y: point.pos.y,
      width: point.width,
    });
    const chisel = createInkChiselBuilder(sampleOf(startPoint), {
      pixelSize: viewport.getSizeOfPixelOnCanvas(),
      nibAngle,
    });
    const specOf = ({ path }: InkChiselGeometry) =>
      renderablePathFrom(jsDraw, path, { fill: color });

    return {
      getBBox() {
        const { points, margin } = chisel.extent();
        return Rect2.bboxOf(points.map((point) => Vec2.of(point.x, point.y))).grownBy(
          margin
        );
      },
      addPoint(newPoint: StrokeDataPoint) {
        chisel.addPoint(sampleOf(newPoint));
      },
      preview(renderer) {
        renderer.drawPath(specOf(chisel.preview()));
      },
      build() {
        return new Stroke([specOf(chisel.build())]);
      },
    };
  };
}
