import type { InkPenPaint } from "@/lib/ink/geometry/pen";
import type { InkColor, InkPaint } from "@/lib/ink/model";

/**
 * How a pen path is painted: filled as an outline, or stroked at one width with
 * round ends. The same paint is what live ink draws and what the lift keeps.
 *
 * Kept apart from `stroke-color.ts` so the renderer's test harness can use it
 * without pulling in the notebook's colour table.
 */
export function penInkPaint(paint: InkPenPaint, color: InkColor): InkPaint {
  return paint.kind === "fill"
    ? { fill: color, stroke: null, opacity: 1 }
    : { fill: null, stroke: { color, width: paint.width, cap: "round", join: "round" }, opacity: 1 };
}
