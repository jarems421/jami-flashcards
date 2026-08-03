import type { AbstractComponent, Editor as JsDrawEditor } from "js-draw";
import type { JsDrawModule } from "@/lib/workspace/notebook-js-draw";
import {
  detectNotebookScribble,
  getNotebookScribbleCoverage,
  NOTEBOOK_SCRIBBLE_MIN_COVERAGE,
  type NotebookScribblePoint,
  type NotebookScribbleSample,
} from "@/lib/workspace/notebook-scribble-erase";

export type NotebookScribbleErasePlan = {
  components: AbstractComponent[];
};

/**
 * Decides whether a finished pen stroke was a scribble-out, and what it covered.
 *
 * This runs at release, *before* the pointer reaches js-draw, so a scribble can
 * be answered by cancelling the pen's in-progress stroke rather than committing
 * it and deleting it again afterwards. The scribble therefore never becomes a
 * component and never enters the undo history: one press of undo brings back
 * what was erased, with no stray step where the scribble itself reappears.
 *
 * Returns `null` unless there is something to erase. A scribble over blank
 * paper is not a gesture at all -- it is just ink, and it commits normally.
 */
export function planNotebookScribbleErase(input: {
  editor: JsDrawEditor;
  jsDraw: JsDrawModule;
  /** Screen-space samples, relative to the ink surface. */
  samples: readonly NotebookScribbleSample[];
  strokeWidth: number;
}): NotebookScribbleErasePlan | null {
  const scribble = detectNotebookScribble(input.samples, {
    strokeWidth: input.strokeWidth,
  });
  if (!scribble) return null;

  const toCanvas = (point: NotebookScribblePoint) => {
    const canvasPoint = input.editor.viewport.screenToCanvas(
      input.jsDraw.Vec2.of(point.x, point.y)
    );
    return { x: canvasPoint.x, y: canvasPoint.y };
  };
  const hull = scribble.band.hull.map(toCanvas);
  const bounds = {
    minX: Math.min(...hull.map((point) => point.x)),
    minY: Math.min(...hull.map((point) => point.y)),
    maxX: Math.max(...hull.map((point) => point.x)),
    maxY: Math.max(...hull.map((point) => point.y)),
  };
  const band = { hull, bounds };
  const searchArea = new input.jsDraw.Rect2(
    bounds.minX,
    bounds.minY,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY
  );

  const components: AbstractComponent[] = [];
  for (const component of input.editor.image.getComponentsIntersecting(searchArea)) {
    if (!(component instanceof input.jsDraw.Stroke) || !component.isSelectable()) {
      continue;
    }
    const parts = component.getParts();
    let covered = 0;
    let total = 0;
    for (const part of parts) {
      // The control polygon rather than the rendered curve. Exact geometry
      // matters when deciding where to cut a stroke; this only decides whether
      // most of one lies under the scribble, and it is bounded by the same
      // hull either way.
      const polyline = part.path.polylineApproximation();
      const points: NotebookScribblePoint[] = polyline.length
        ? [
            { x: polyline[0].p1.x, y: polyline[0].p1.y },
            ...polyline.map((segment) => ({
              x: segment.p2.x,
              y: segment.p2.y,
            })),
          ]
        : [{ x: part.startPoint.x, y: part.startPoint.y }];
      let length = 0;
      for (let index = 1; index < points.length; index += 1) {
        length += Math.hypot(
          points[index].x - points[index - 1].x,
          points[index].y - points[index - 1].y
        );
      }
      // A dot has no length of its own, so weight it by the nib instead of
      // letting it drop out of the average entirely.
      const weight = Math.max(length, 1);
      covered += getNotebookScribbleCoverage(band, points) * weight;
      total += weight;
    }

    if (total > 0 && covered / total >= NOTEBOOK_SCRIBBLE_MIN_COVERAGE) {
      components.push(component);
    }
  }

  return components.length > 0 ? { components } : null;
}

/** Applies a plan as one undoable action. */
export function applyNotebookScribbleErase(
  editor: JsDrawEditor,
  jsDraw: JsDrawModule,
  plan: NotebookScribbleErasePlan
) {
  void editor.dispatch(new jsDraw.Erase(plan.components));
}
