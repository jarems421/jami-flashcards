import type { NotebookStroke } from "@/lib/workspace/notebooks";
import { normalizeInkPressure, normalizeInkTime } from "@/lib/workspace/notebook-ink-engine";

export type NotebookInkPoint = {
  x: number;
  y: number;
  pressure?: number;
  time?: number;
};

export type PointerClientSample = {
  clientX: number;
  clientY: number;
  pressure: number;
  time: number;
};

const DEFAULT_MIN_POINT_DISTANCE = 1.35;
const DEFAULT_MAX_INTERPOLATED_POINT_DISTANCE = 4.75;
export const NOTEBOOK_INITIAL_POINTS_WITHOUT_DISTANCE_FILTER = 5;
export const NOTEBOOK_NATIVE_COMMIT_IDLE_MS = 750;
export const NOTEBOOK_MAX_PENDING_NATIVE_STROKES = 120;
export const NOTEBOOK_PAGE_SWIPE_THRESHOLD = 64;
// Pulling forward past the last page far enough to fill this fraction of the page
// width (with a px floor) creates a new page. A fast forward flick can shortcut it.
export const NOTEBOOK_CREATE_PAGE_THRESHOLD_RATIO = 0.32;
export const NOTEBOOK_CREATE_PAGE_MIN_THRESHOLD = 96;
export const NOTEBOOK_CREATE_PAGE_FLICK_VELOCITY = 0.6;
export const NOTEBOOK_PAGE_MIN_ZOOM = 0.85;
export const NOTEBOOK_PAGE_MAX_ZOOM = 4;
export const NOTEBOOK_DEFAULT_THICKNESS_PERCENT = 50;
export const NOTEBOOK_PEN_MIN_WIDTH = 2;
export const NOTEBOOK_PEN_MAX_WIDTH = 10;
export const NOTEBOOK_HIGHLIGHTER_MIN_WIDTH = 10;
export const NOTEBOOK_HIGHLIGHTER_MAX_WIDTH = 30;

export function appendPendingNotebookStroke(
  pending: NotebookStroke[],
  stroke: NotebookStroke,
  maxPending = NOTEBOOK_MAX_PENDING_NATIVE_STROKES
) {
  const boundedLimit = Math.max(1, Math.floor(maxPending));
  return [...pending, stroke].slice(-boundedLimit);
}

export function clampNotebookThicknessPercent(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return NOTEBOOK_DEFAULT_THICKNESS_PERCENT;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getWidthFromThicknessPercent(input: {
  value: unknown;
  minWidth: number;
  maxWidth: number;
}) {
  const percent = clampNotebookThicknessPercent(input.value);
  const width = input.minWidth + (percent / 100) * (input.maxWidth - input.minWidth);
  return Math.round(width * 100) / 100;
}

export function getPenWidthFromPercent(value: unknown) {
  return getWidthFromThicknessPercent({
    value,
    minWidth: NOTEBOOK_PEN_MIN_WIDTH,
    maxWidth: NOTEBOOK_PEN_MAX_WIDTH,
  });
}

export function getHighlighterWidthFromPercent(value: unknown) {
  return getWidthFromThicknessPercent({
    value,
    minWidth: NOTEBOOK_HIGHLIGHTER_MIN_WIDTH,
    maxWidth: NOTEBOOK_HIGHLIGHTER_MAX_WIDTH,
  });
}

export function shouldPointerDraw(
  pointerType: string,
  tool: "pen" | "eraser" | "highlighter" | "text" | "select"
) {
  if (tool !== "pen" && tool !== "highlighter") return false;
  return pointerType === "pen" || pointerType === "mouse";
}

export type NotebookPointerDrawEventLike = {
  pointerType: string;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
};

export function shouldPointerDrawEvent(
  event: NotebookPointerDrawEventLike,
  tool: "pen" | "eraser" | "highlighter" | "text" | "select"
) {
  return shouldPointerDraw(event.pointerType, tool);
}

export function shouldPointerSwipePages(pointerType: string) {
  return pointerType === "touch";
}

export function shouldSuppressTouchAfterStylus(input: {
  stylusActive: boolean;
  cooldownUntil: number;
  now: number;
}) {
  return input.stylusActive || input.now < input.cooldownUntil;
}

export function getNotebookSwipeDirection(input: {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  threshold?: number;
}): "next" | "previous" | null {
  const threshold = input.threshold ?? NOTEBOOK_PAGE_SWIPE_THRESHOLD;
  const dx = input.currentX - input.startX;
  const dy = input.currentY - input.startY;
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.15) return null;
  return dx < 0 ? "next" : "previous";
}

export function getNotebookPageIndexAfterSwipe(input: {
  currentIndex: number;
  pageCount: number;
  direction: "next" | "previous";
}) {
  if (input.pageCount <= 0 || input.currentIndex < 0 || input.currentIndex >= input.pageCount) {
    return input.currentIndex;
  }
  const offset = input.direction === "next" ? 1 : -1;
  return Math.max(0, Math.min(input.pageCount - 1, input.currentIndex + offset));
}

export function getNotebookCreatePageThreshold(pageWidth: number) {
  return Math.max(
    NOTEBOOK_CREATE_PAGE_MIN_THRESHOLD,
    Math.max(1, pageWidth) * NOTEBOOK_CREATE_PAGE_THRESHOLD_RATIO
  );
}

// Describes the "pull past the last page to create a new one" gesture. A forward
// pull is a leftward drag, so `totalDx` is negative; `progress` (0..1) drives the
// circular ring, and `resistedOffset` is the rubber-banded page translation (the
// same sqrt curve used for the first/last-page bounce).
export function getNotebookCreatePagePull(input: {
  totalDx: number;
  pageWidth: number;
}): { progress: number; resistedOffset: number } {
  const pull = Math.max(0, -input.totalDx);
  const threshold = getNotebookCreatePageThreshold(input.pageWidth);
  const progress = Math.max(0, Math.min(1, pull / threshold));
  // Track the finger (with a little drag) so the incoming blank page is revealed
  // bit by bit as you pull, capped so it never slides further than the page.
  const resistedOffset =
    pull > 0 ? -Math.min(pull * 0.6, Math.max(1, input.pageWidth) * 0.6) : 0;
  return { progress, resistedOffset };
}

export function shouldCreateNotebookPageOnRelease(input: {
  totalDx: number;
  pageWidth: number;
  velocityX: number;
}): boolean {
  const { progress } = getNotebookCreatePagePull({
    totalDx: input.totalDx,
    pageWidth: input.pageWidth,
  });
  if (progress >= 1) return true;
  // A fast forward flick (leftward → negative velocityX) past a partial pull.
  return (
    progress >= 0.5 && input.velocityX <= -NOTEBOOK_CREATE_PAGE_FLICK_VELOCITY
  );
}

export function clampNotebookPageZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(NOTEBOOK_PAGE_MIN_ZOOM, Math.min(NOTEBOOK_PAGE_MAX_ZOOM, value));
}

export function getPinchDistance(
  first: PointerClientSample,
  second: PointerClientSample
) {
  const dx = first.clientX - second.clientX;
  const dy = first.clientY - second.clientY;
  return Math.hypot(dx, dy);
}

export function getNotebookPageZoomAfterPinch(input: {
  startDistance: number;
  currentDistance: number;
  startZoom: number;
}) {
  if (input.startDistance <= 0) return clampNotebookPageZoom(input.startZoom);
  return clampNotebookPageZoom((input.currentDistance / input.startDistance) * input.startZoom);
}

export function clampInkPoint(
  point: NotebookInkPoint,
  width: number,
  height: number
): NotebookInkPoint {
  const clampedPoint: NotebookInkPoint = {
    x: Math.max(0, Math.min(width, point.x)),
    y: Math.max(0, Math.min(height, point.y)),
  };
  if (point.pressure !== undefined) clampedPoint.pressure = point.pressure;
  if (point.time !== undefined) clampedPoint.time = point.time;
  return clampedPoint;
}

export function mapClientPointToNotebookPage(input: {
  clientX: number;
  clientY: number;
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">;
  width: number;
  height: number;
}): NotebookInkPoint {
  const x = ((input.clientX - input.rect.left) / input.rect.width) * input.width;
  const y = ((input.clientY - input.rect.top) / input.rect.height) * input.height;
  return clampInkPoint({ x, y }, input.width, input.height);
}

export function normalizePointerPressure(value: unknown) {
  return normalizeInkPressure(value);
}

export function getPointerClientSamples(event: PointerEvent): PointerClientSample[] {
  const coalescedEvents =
    typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  const samples = coalescedEvents.length > 0 ? coalescedEvents : [event];
  const fallbackTime = normalizeInkTime(event.timeStamp, 0);
  return samples.map((sample) => ({
    clientX: sample.clientX,
    clientY: sample.clientY,
    pressure: normalizePointerPressure(sample.pressure),
    time: normalizeInkTime(sample.timeStamp, fallbackTime),
  }));
}

export function shouldAppendInkPoint(
  points: NotebookInkPoint[],
  point: NotebookInkPoint,
  minDistance = DEFAULT_MIN_POINT_DISTANCE
) {
  if (points.length < NOTEBOOK_INITIAL_POINTS_WITHOUT_DISTANCE_FILTER) return true;
  const previousPoint = points[points.length - 1];
  if (!previousPoint) return true;
  const dx = point.x - previousPoint.x;
  const dy = point.y - previousPoint.y;
  return dx * dx + dy * dy >= minDistance * minDistance;
}

export function appendInkPoints(
  currentPoints: NotebookInkPoint[],
  incomingPoints: NotebookInkPoint[],
  maxPoints: number,
  minDistance = DEFAULT_MIN_POINT_DISTANCE
) {
  const nextPoints = [...currentPoints];
  for (const point of incomingPoints) {
    if (nextPoints.length >= maxPoints) break;
    if (shouldAppendInkPoint(nextPoints, point, minDistance)) {
      nextPoints.push(point);
    }
  }
  return nextPoints;
}

function interpolateNotebookPoint(
  previousPoint: NotebookInkPoint,
  currentPoint: NotebookInkPoint,
  progress: number
): NotebookInkPoint {
  const previousPressure = normalizePointerPressure(previousPoint.pressure);
  const currentPressure = normalizePointerPressure(currentPoint.pressure);
  const previousTime = normalizeInkTime(previousPoint.time, 0);
  const currentTime = normalizeInkTime(currentPoint.time, previousTime);
  return {
    x: previousPoint.x + (currentPoint.x - previousPoint.x) * progress,
    y: previousPoint.y + (currentPoint.y - previousPoint.y) * progress,
    pressure: previousPressure + (currentPressure - previousPressure) * progress,
    time: Math.round(previousTime + (currentTime - previousTime) * progress),
  };
}

export function interpolateInkSampleGaps(
  points: NotebookInkPoint[],
  maxDistance = DEFAULT_MAX_INTERPOLATED_POINT_DISTANCE
) {
  if (points.length < 2) return points;
  const nextPoints: NotebookInkPoint[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = nextPoints[nextPoints.length - 1];
    const currentPoint = points[index];
    const dx = currentPoint.x - previousPoint.x;
    const dy = currentPoint.y - previousPoint.y;
    const distance = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(distance / maxDistance));

    for (let step = 1; step <= steps; step += 1) {
      nextPoints.push(interpolateNotebookPoint(previousPoint, currentPoint, step / steps));
    }
  }

  return nextPoints;
}

export function finalizeInkStroke(stroke: NotebookStroke | null): NotebookStroke | null {
  if (!stroke || stroke.points.length === 0) return null;
  return {
    ...stroke,
    points: interpolateInkSampleGaps(stroke.points).slice(0, 1_200),
  };
}
