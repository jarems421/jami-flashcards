import type { NotebookStroke } from "@/lib/workspace/notebooks";

export type NotebookEraserMode = "stroke" | "precision";
export type NotebookEraserSize = "small" | "medium" | "large";

export const NOTEBOOK_ERASER_THICKNESS_BY_SIZE: Record<
  NotebookEraserSize,
  number
> = {
  small: 36,
  medium: 56,
  large: 76,
};

const NOTEBOOK_PRECISION_ERASER_CURSOR_SCALE = 0.4;
const NOTEBOOK_PRECISION_ERASER_MIN_CURSOR_DIAMETER = 12;
export const NOTEBOOK_PRECISION_ERASER_POLYGON_SIDES = 24;
export const NOTEBOOK_PRECISION_ERASER_CONTACT_EPSILON_PX = 0.25;

export function getNotebookEraserModeValue(mode: NotebookEraserMode) {
  return mode === "stroke" ? "full-stroke" : "partial-stroke";
}

function normalizeNotebookEraserThickness(thickness: number) {
  if (!Number.isFinite(thickness)) return 1;
  return Math.max(1, Math.min(200, thickness));
}

/**
 * The precision cursor is intentionally smaller than the broad stroke eraser.
 * This keeps each pass gradual instead of making the two modes feel alike.
 */
export function getNotebookEraserCursorDiameter(
  mode: NotebookEraserMode,
  thickness: number
) {
  const normalized = normalizeNotebookEraserThickness(thickness);
  return mode === "precision"
    ? Math.max(
        NOTEBOOK_PRECISION_ERASER_MIN_CURSOR_DIAMETER,
        normalized * NOTEBOOK_PRECISION_ERASER_CURSOR_SCALE
      )
    : normalized;
}

/**
 * Precision mode now uses a circular runtime eraser, so its configured size is
 * the visible diameter. Stroke mode keeps js-draw's broad square tip.
 */
export function getNotebookEraserToolThickness(
  mode: NotebookEraserMode,
  thickness: number
) {
  return getNotebookEraserCursorDiameter(mode, thickness);
}

export type NotebookEraserPoint = { x: number; y: number };
export type NotebookEraserPointerSample = {
  clientX: number;
  clientY: number;
  timeStamp: number;
};

export const NOTEBOOK_PRECISION_ERASER_MAX_PATH_ERROR_PX = 0.5;

/**
 * Converts the visible precision radius into page coordinates and grows it by
 * half the ink width. The small screen-space epsilon makes anti-aliased edge
 * contact register immediately instead of requiring visible overlap.
 */
export function getNotebookPrecisionEraserContactRadiusOnCanvas(input: {
  cursorDiameter: number;
  strokeWidth?: number;
  viewportScale: number;
}) {
  const viewportScale =
    Number.isFinite(input.viewportScale) && input.viewportScale > 0
      ? input.viewportScale
      : 1;
  const cursorDiameter = Math.max(1, input.cursorDiameter);
  const strokeWidth = Math.max(0, input.strokeWidth ?? 0);
  return (
    cursorDiameter / (2 * viewportScale) +
    strokeWidth / 2 +
    NOTEBOOK_PRECISION_ERASER_CONTACT_EPSILON_PX / viewportScale
  );
}

/**
 * Returns a circumscribed polygon for a circle, or the convex capsule swept
 * between two circles. Circumscribing makes the polygon edges tangent to the
 * requested radius; 24 sides keep the maximum overshoot below 0.14 screen px
 * at the largest notebook precision size.
 */
export function getNotebookCircularEraserSweepPoints(input: {
  from: NotebookEraserPoint;
  radius: number;
  sides?: number;
  to: NotebookEraserPoint;
}) {
  const sides = Math.max(
    8,
    Math.min(
      64,
      Math.round(input.sides ?? NOTEBOOK_PRECISION_ERASER_POLYGON_SIDES)
    )
  );
  const radius = Math.max(0.01, input.radius);
  const vertexRadius = radius / Math.cos(Math.PI / sides);
  const centers =
    input.from.x === input.to.x && input.from.y === input.to.y
      ? [input.to]
      : [input.from, input.to];
  const points: NotebookEraserPoint[] = [];

  for (const center of centers) {
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * vertexRadius,
        y: center.y + Math.sin(angle) * vertexRadius,
      });
    }
  }

  return points;
}

function crossProduct(
  first: NotebookEraserPoint,
  second: NotebookEraserPoint,
  third: NotebookEraserPoint
) {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function pointWithinSegmentBounds(
  point: NotebookEraserPoint,
  start: NotebookEraserPoint,
  end: NotebookEraserPoint
) {
  const epsilon = 1e-9;
  return (
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  );
}

function segmentsIntersect(
  firstStart: NotebookEraserPoint,
  firstEnd: NotebookEraserPoint,
  secondStart: NotebookEraserPoint,
  secondEnd: NotebookEraserPoint
) {
  const firstSideStart = crossProduct(firstStart, firstEnd, secondStart);
  const firstSideEnd = crossProduct(firstStart, firstEnd, secondEnd);
  const secondSideStart = crossProduct(secondStart, secondEnd, firstStart);
  const secondSideEnd = crossProduct(secondStart, secondEnd, firstEnd);
  const epsilon = 1e-9;
  if (
    firstSideStart * firstSideEnd < -epsilon &&
    secondSideStart * secondSideEnd < -epsilon
  ) {
    return true;
  }
  if (
    Math.abs(firstSideStart) <= epsilon &&
    pointWithinSegmentBounds(secondStart, firstStart, firstEnd)
  ) {
    return true;
  }
  if (
    Math.abs(firstSideEnd) <= epsilon &&
    pointWithinSegmentBounds(secondEnd, firstStart, firstEnd)
  ) {
    return true;
  }
  if (
    Math.abs(secondSideStart) <= epsilon &&
    pointWithinSegmentBounds(firstStart, secondStart, secondEnd)
  ) {
    return true;
  }
  return (
    Math.abs(secondSideEnd) <= epsilon &&
    pointWithinSegmentBounds(firstEnd, secondStart, secondEnd)
  );
}

export function getNotebookSegmentDistanceSquared(input: {
  firstEnd: NotebookEraserPoint;
  firstStart: NotebookEraserPoint;
  secondEnd: NotebookEraserPoint;
  secondStart: NotebookEraserPoint;
}) {
  if (
    segmentsIntersect(
      input.firstStart,
      input.firstEnd,
      input.secondStart,
      input.secondEnd
    )
  ) {
    return 0;
  }
  return Math.min(
    pointToSegmentDistanceSquared(
      input.firstStart,
      input.secondStart,
      input.secondEnd
    ),
    pointToSegmentDistanceSquared(
      input.firstEnd,
      input.secondStart,
      input.secondEnd
    ),
    pointToSegmentDistanceSquared(
      input.secondStart,
      input.firstStart,
      input.firstEnd
    ),
    pointToSegmentDistanceSquared(
      input.secondEnd,
      input.firstStart,
      input.firstEnd
    )
  );
}

export function doesNotebookPolylineTouchCircularEraserSweep(input: {
  contactRadius: number;
  eraserFrom: NotebookEraserPoint;
  eraserTo: NotebookEraserPoint;
  strokeSegments: ReadonlyArray<{
    end: NotebookEraserPoint;
    start: NotebookEraserPoint;
  }>;
}) {
  const radiusSquared = input.contactRadius * input.contactRadius;
  return input.strokeSegments.some(
    (segment) =>
      getNotebookSegmentDistanceSquared({
        firstStart: input.eraserFrom,
        firstEnd: input.eraserTo,
        secondStart: segment.start,
        secondEnd: segment.end,
      }) <= radiusSquared
  );
}

/**
 * Keeps the complete confirmed pointer path for the eraser. Pen preview
 * sampling is deliberately bounded elsewhere, but a precision eraser needs
 * every coalesced bend so a fast curved pass cannot become one destructive
 * straight chord.
 */
export function getContinuousNotebookEraserSamples(
  event: NotebookEraserPointerSample & {
    getCoalescedEvents?: () => NotebookEraserPointerSample[];
  },
  previous?: NotebookEraserPointerSample
) {
  let coalesced: NotebookEraserPointerSample[] = [];
  try {
    coalesced = event.getCoalescedEvents?.() ?? [];
  } catch {
    coalesced = [];
  }

  const isValidSample = (sample: NotebookEraserPointerSample) =>
    Number.isFinite(sample.clientX) &&
    Number.isFinite(sample.clientY) &&
    Number.isFinite(sample.timeStamp);
  const validCoalesced = coalesced.filter(isValidSample);
  const previousAnchorIndex = previous
    ? validCoalesced.findLastIndex(
        (sample) =>
          sample.clientX === previous.clientX &&
          sample.clientY === previous.clientY &&
          sample.timeStamp === previous.timeStamp
      )
    : -1;
  const candidates = validCoalesced
    .slice(previousAnchorIndex + 1)
    .filter(
      (sample) =>
        (!previous || sample.timeStamp >= previous.timeStamp) &&
        sample.timeStamp <= event.timeStamp
    )
    .sort((left, right) => left.timeStamp - right.timeStamp);
  // Some WebKit builds repeat already-delivered coalesced history. Ignore that
  // confirmed-old history, but always finish at the actual event endpoint.
  if (
    isValidSample(event) &&
    (!previous || event.timeStamp >= previous.timeStamp)
  ) {
    candidates.push(event);
  }
  const result: NotebookEraserPointerSample[] = [];
  let last = previous;

  for (const sample of candidates) {
    if (
      last &&
      last.clientX === sample.clientX &&
      last.clientY === sample.clientY
    ) {
      continue;
    }
    const next = {
      clientX: sample.clientX,
      clientY: sample.clientY,
      timeStamp: sample.timeStamp,
    };
    result.push(next);
    last = next;
  }

  return result;
}

/**
 * Spatially simplifies a confirmed pointer packet without turning a curved
 * Pencil pass into a destructive long chord. Every omitted point remains at
 * most `maxPathErrorPx` screen pixels from the retained path, while the real
 * packet endpoint and every sharper bend are preserved.
 *
 * The calculation deliberately happens in screen space. Its error budget is
 * therefore stable at every notebook zoom level and matches the visible
 * precision-erasing cursor rather than the page's backing coordinates.
 */
export function getSpatiallySimplifiedNotebookEraserSamples(
  samples: readonly NotebookEraserPointerSample[],
  previous: NotebookEraserPointerSample,
  maxPathErrorPx = NOTEBOOK_PRECISION_ERASER_MAX_PATH_ERROR_PX
) {
  const maxError = Number.isFinite(maxPathErrorPx)
    ? Math.max(0, maxPathErrorPx)
    : NOTEBOOK_PRECISION_ERASER_MAX_PATH_ERROR_PX;
  const points = [previous, ...samples].filter(
    (sample, index, allSamples) =>
      index === 0 ||
      sample.clientX !== allSamples[index - 1].clientX ||
      sample.clientY !== allSamples[index - 1].clientY
  );
  if (points.length <= 2 || maxError === 0) return points.slice(1);

  const retained = new Uint8Array(points.length);
  retained[0] = 1;
  retained[points.length - 1] = 1;
  const pendingRanges: Array<{ end: number; start: number }> = [
    { start: 0, end: points.length - 1 },
  ];
  const maxErrorSquared = maxError * maxError;

  while (pendingRanges.length > 0) {
    const range = pendingRanges.pop();
    if (!range || range.end - range.start <= 1) continue;
    const start = {
      x: points[range.start].clientX,
      y: points[range.start].clientY,
    };
    const end = {
      x: points[range.end].clientX,
      y: points[range.end].clientY,
    };
    let furthestIndex = -1;
    let furthestDistanceSquared = maxErrorSquared;

    for (let index = range.start + 1; index < range.end; index += 1) {
      const distanceSquared = pointToSegmentDistanceSquared(
        { x: points[index].clientX, y: points[index].clientY },
        start,
        end
      );
      if (distanceSquared > furthestDistanceSquared) {
        furthestDistanceSquared = distanceSquared;
        furthestIndex = index;
      }
    }

    if (furthestIndex === -1) continue;
    retained[furthestIndex] = 1;
    pendingRanges.push(
      { start: range.start, end: furthestIndex },
      { start: furthestIndex, end: range.end }
    );
  }

  return points.filter((_, index) => index > 0 && retained[index] === 1);
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
