import type { NotebookStroke } from "@/lib/workspace/notebooks";

export type NotebookEraserMode = "stroke" | "precision";

export function getNotebookEraserModeValue(mode: NotebookEraserMode) {
  return mode === "stroke" ? "full-stroke" : "partial-stroke";
}

function pointDistanceSquared(
  first: { x: number; y: number },
  second: { x: number; y: number }
) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function pointToSegmentDistanceSquared(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return pointDistanceSquared(point, start);
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };
  return pointDistanceSquared(point, projected);
}

function pointToSegmentProjection(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  return Math.max(0, Math.min(1, rawT));
}

function pointTouchesEraserPath(input: {
  point: { x: number; y: number };
  previousPoint?: { x: number; y: number };
  eraserPoints: Array<{ x: number; y: number }>;
  radiusSquared: number;
}) {
  return input.eraserPoints.some((eraserPoint) => {
    if (pointDistanceSquared(input.point, eraserPoint) <= input.radiusSquared) {
      return true;
    }
    if (!input.previousPoint) return false;
    const projection = pointToSegmentProjection(eraserPoint, input.previousPoint, input.point);
    return (
      projection > 0.35 &&
      pointToSegmentDistanceSquared(eraserPoint, input.previousPoint, input.point) <=
        input.radiusSquared
    );
  });
}

export function strokeTouchesEraserPath(
  stroke: Pick<NotebookStroke, "points">,
  eraser: Pick<NotebookStroke, "points" | "width">
) {
  const radius = Math.max(12, eraser.width * 1.2);
  const radiusSquared = radius * radius;
  return stroke.points.some((strokePoint) =>
    eraser.points.some((eraserPoint) => pointDistanceSquared(strokePoint, eraserPoint) <= radiusSquared)
  );
}

export function applyStrokeEraser(
  strokes: NotebookStroke[],
  eraser: NotebookStroke
) {
  return strokes.filter((stroke) => !strokeTouchesEraserPath(stroke, eraser));
}

export function applyPrecisionEraser(
  strokes: NotebookStroke[],
  eraser: NotebookStroke
) {
  const radius = Math.max(12, eraser.width * 1.2);
  const radiusSquared = radius * radius;
  const nextStrokes: NotebookStroke[] = [];

  for (const stroke of strokes) {
    let currentRun: NotebookStroke["points"] = [];

    const flushRun = () => {
      if (currentRun.length > 0) {
        nextStrokes.push({ ...stroke, points: currentRun });
        currentRun = [];
      }
    };

    for (let index = 0; index < stroke.points.length; index += 1) {
      const point = stroke.points[index];
      const previousPoint = index > 0 ? stroke.points[index - 1] : undefined;
      const erased = pointTouchesEraserPath({
        point,
        previousPoint,
        eraserPoints: eraser.points,
        radiusSquared,
      });
      if (erased) {
        flushRun();
      } else {
        currentRun.push(point);
      }
    }

    flushRun();
  }

  return nextStrokes;
}

export function applyNotebookEraser(input: {
  strokes: NotebookStroke[];
  eraser: NotebookStroke;
  mode: NotebookEraserMode;
}) {
  return input.mode === "precision"
    ? applyPrecisionEraser(input.strokes, input.eraser)
    : applyStrokeEraser(input.strokes, input.eraser);
}
