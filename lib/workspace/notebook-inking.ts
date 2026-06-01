import type { NotebookStroke } from "@/lib/workspace/notebooks";

export type NotebookInkPoint = {
  x: number;
  y: number;
};

export type PointerClientSample = {
  clientX: number;
  clientY: number;
};

const DEFAULT_MIN_POINT_DISTANCE = 1.35;
export const NOTEBOOK_PAGE_SWIPE_THRESHOLD = 64;

export function shouldPointerDraw(pointerType: string, tool: "pen" | "eraser" | "text") {
  if (tool === "text") return false;
  return pointerType === "pen" || pointerType === "mouse";
}

export function shouldPointerSwipePages(pointerType: string) {
  return pointerType === "touch";
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

export function clampInkPoint(
  point: NotebookInkPoint,
  width: number,
  height: number
): NotebookInkPoint {
  return {
    x: Math.max(0, Math.min(width, point.x)),
    y: Math.max(0, Math.min(height, point.y)),
  };
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

export function getPointerClientSamples(event: PointerEvent): PointerClientSample[] {
  const coalescedEvents =
    typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  const samples = coalescedEvents.length > 0 ? coalescedEvents : [event];
  return samples.map((sample) => ({
    clientX: sample.clientX,
    clientY: sample.clientY,
  }));
}

export function shouldAppendInkPoint(
  points: NotebookInkPoint[],
  point: NotebookInkPoint,
  minDistance = DEFAULT_MIN_POINT_DISTANCE
) {
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

export function finalizeInkStroke(stroke: NotebookStroke | null): NotebookStroke | null {
  if (!stroke || stroke.points.length === 0) return null;
  return {
    ...stroke,
    points: stroke.points.slice(0, 1_200),
  };
}
