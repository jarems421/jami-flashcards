import type {
  PathCommand,
  Point2,
  RenderablePathSpec,
  StrokeDataPoint,
} from "js-draw";
import type { InkPathCommand } from "@/lib/ink/model";
import type { JsDrawModule } from "@/lib/workspace/notebook-js-draw";

/**
 * What the pen and highlighter builders share, now that their geometry lives
 * in `lib/ink/geometry/` and they are only the js-draw side of it.
 *
 * Neither builder offers an `inkTrailStyle`, and its absence is the feature.
 *
 * js-draw turns on the Web Ink API's compositor trail for any builder that
 * offers one -- `if (this.builder.inkTrailStyle)` in Pen.onPointerDown -- and
 * that trail is fed the raw DOM event, `event.isTrusted` and all. It never
 * passes through the input mapper, so it is drawn to the unfiltered pointer
 * while this stroke is deliberately drawn to the held, smoothed one.
 *
 * The gap between those two is the trailing distance the smoothing accepts on
 * purpose: "a stroke ends a fraction short of where the pen physically left --
 * and ink that is not there cannot be seen". The compositor was drawing that
 * missing fraction back in, outside anything this app renders, and dropping it
 * a frame or two after the real ink landed. Reported as ink glitching and
 * reaching past the lift, and worse zoomed in, where the trail is thicker and
 * every pixel is magnified.
 *
 * It also draws the raw path, tremor included, which is the jitter the One
 * Euro filter exists to remove.
 *
 * The cost is the latency the trail was hiding. This ink is filtered behind
 * the pen by design, so a trail racing ahead of it was never hiding latency
 * here -- it was contradicting the design.
 */

/** The geometry's path as js-draw draws it. */
export function renderablePathFrom(
  jsDraw: JsDrawModule,
  path: readonly InkPathCommand[],
  style: RenderablePathSpec["style"]
): RenderablePathSpec {
  const { PathCommandType, Vec2 } = jsDraw;
  const [first, ...rest] = path;
  const startPoint = first?.op === "M" ? Vec2.of(first.x, first.y) : Vec2.of(0, 0);
  let subpathStart: Point2 = startPoint;

  const commands = rest.map((command): PathCommand => {
    switch (command.op) {
      case "M":
        subpathStart = Vec2.of(command.x, command.y);
        return { kind: PathCommandType.MoveTo, point: subpathStart };
      case "L":
        return { kind: PathCommandType.LineTo, point: Vec2.of(command.x, command.y) };
      case "C":
        return {
          kind: PathCommandType.CubicBezierTo,
          controlPoint1: Vec2.of(command.x1, command.y1),
          controlPoint2: Vec2.of(command.x2, command.y2),
          endPoint: Vec2.of(command.x, command.y),
        };
      case "Q":
        return {
          kind: PathCommandType.QuadraticBezierTo,
          controlPoint: Vec2.of(command.x1, command.y1),
          endPoint: Vec2.of(command.x, command.y),
        };
      case "Z":
        return { kind: PathCommandType.LineTo, point: subpathStart };
    }
  });
  return { startPoint, commands, style };
}

/** A js-draw sample as the geometry reads it. */
export function penSampleFrom(point: StrokeDataPoint) {
  return { x: point.pos.x, y: point.pos.y, width: point.width, time: point.time };
}
