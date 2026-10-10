import type {
  Color4,
  ComponentBuilder,
  ComponentBuilderFactory,
  Point2,
  RenderablePathSpec,
  StrokeDataPoint,
  Viewport,
} from "js-draw";
import {
  createInkPenBuilder,
  type InkPenGeometry,
} from "@/lib/ink/geometry/pen";
import type { JsDrawModule } from "@/lib/workspace/notebook-js-draw";
import {
  getNotebookPenFeel,
  NOTEBOOK_PEN_SMOOTHING_DEFAULT,
  type NotebookPenFeel,
} from "@/lib/workspace/notebook-pen-feel";
import {
  penSampleFrom,
  renderablePathFrom,
} from "@/lib/workspace/notebook-stroke-builder-adapter";

/**
 * The pen, as js-draw draws it.
 *
 * What the line looks like -- the Catmull-Rom spline through the samples, the
 * corners, the pressure taper, the straightening -- is
 * `lib/ink/geometry/pen.ts`, which knows nothing of js-draw. This is the
 * ComponentBuilder around it: samples in, js-draw paths out, and the colour,
 * which the geometry does not carry.
 *
 * It offers no `inkTrailStyle`, deliberately: see
 * `notebook-stroke-builder-adapter.ts`.
 */

/** The end of the line being written, as the predicted tip needs it. */
export type NotebookPenLiveTip = {
  point: Point2;
  /** In canvas units, like every other width js-draw is given. */
  width: number;
  color: Color4;
};

type NotebookSmoothPenBuilder = ComponentBuilder & {
  liveTip(): NotebookPenLiveTip | null;
};

/**
 * The live tip of whatever stroke `pen` is building, if its builder is this
 * one. js-draw keeps the builder on a protected field, so it is reached for
 * and checked rather than assumed: the highlighter's builder has no tip to
 * offer, and neither does a pen between strokes.
 */
export function readNotebookPenLiveTip(pen: object): NotebookPenLiveTip | null {
  const builder = (pen as { builder?: unknown }).builder;
  if (typeof builder !== "object" || builder === null) return null;
  const liveTip = (builder as { liveTip?: unknown }).liveTip;
  if (typeof liveTip !== "function") return null;
  const tip: unknown = liveTip.call(builder);
  if (typeof tip !== "object" || tip === null) return null;
  const { point, width, color } = tip as Partial<NotebookPenLiveTip>;
  if (!point || !color || typeof width !== "number" || !(width > 0)) {
    return null;
  }
  return { point, width, color };
}

export function createNotebookSmoothPenStrokeFactory(
  jsDraw: JsDrawModule,
  feel: NotebookPenFeel = getNotebookPenFeel(NOTEBOOK_PEN_SMOOTHING_DEFAULT)
): ComponentBuilderFactory {
  const { Color4, Rect2, Stroke, Vec2 } = jsDraw;

  return (
    startPoint: StrokeDataPoint,
    viewport: Viewport
  ): NotebookSmoothPenBuilder => {
    const color: Color4 = startPoint.color;
    const pen = createInkPenBuilder(penSampleFrom(startPoint), {
      feel,
      pixelSize: viewport.getSizeOfPixelOnCanvas(),
    });

    const specOf = ({ path, paint }: InkPenGeometry): RenderablePathSpec =>
      renderablePathFrom(
        jsDraw,
        path,
        paint.kind === "fill"
          ? { fill: color }
          : { fill: Color4.transparent, stroke: { color, width: paint.width } }
      );

    return {
      liveTip(): NotebookPenLiveTip | null {
        const tip = pen.liveTip();
        return tip
          ? { point: Vec2.of(tip.x, tip.y), width: tip.width, color }
          : null;
      },
      getBBox() {
        const { points, margin } = pen.extent();
        return Rect2.bboxOf(points.map((point) => Vec2.of(point.x, point.y))).grownBy(
          margin
        );
      },
      addPoint(newPoint: StrokeDataPoint) {
        pen.addPoint(penSampleFrom(newPoint));
      },
      preview(renderer) {
        renderer.drawPath(specOf(pen.geometry()));
      },
      build() {
        return new Stroke([specOf(pen.geometry())]);
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
        const line = pen.straighten();
        return line ? new Stroke([specOf(line)]) : null;
      },
    };
  };
}
