import { getStroke } from "perfect-freehand";
import type { NotebookStrokeTool } from "@/lib/workspace/notebooks";

export type TimedInkPoint = {
  x: number;
  y: number;
  pressure?: number;
  time?: number;
};

export type FreehandPoint = {
  x: number;
  y: number;
  pressure: number;
  time: number;
};

export type StrokeOutlinePoint = [number, number];

const DEFAULT_INTERPOLATION_DISTANCE = 7.5;
const MAX_POINT_TIME = 10 * 60 * 1_000;

export function normalizeInkPressure(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function normalizeInkTime(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return Math.max(0, Math.min(MAX_POINT_TIME, Math.round(fallback)));
  }
  return Math.max(0, Math.min(MAX_POINT_TIME, Math.round(value)));
}

export function normalizeTimedInkPoint(point: TimedInkPoint, fallbackTime = 0): FreehandPoint {
  return {
    x: point.x,
    y: point.y,
    pressure: normalizeInkPressure(point.pressure),
    time: normalizeInkTime(point.time, fallbackTime),
  };
}

export function getInkPointDistance(first: Pick<TimedInkPoint, "x" | "y">, second: Pick<TimedInkPoint, "x" | "y">) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function interpolateInkPoints(
  points: TimedInkPoint[],
  maxDistance = DEFAULT_INTERPOLATION_DISTANCE
): FreehandPoint[] {
  if (points.length === 0) return [];

  const normalized = points.map((point, index) => normalizeTimedInkPoint(point, index * 16));
  const nextPoints: FreehandPoint[] = [normalized[0]];

  for (let index = 1; index < normalized.length; index += 1) {
    const previousPoint = nextPoints[nextPoints.length - 1];
    const currentPoint = normalized[index];
    const distance = getInkPointDistance(previousPoint, currentPoint);
    const steps = Math.max(1, Math.ceil(distance / maxDistance));

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      nextPoints.push({
        x: previousPoint.x + (currentPoint.x - previousPoint.x) * progress,
        y: previousPoint.y + (currentPoint.y - previousPoint.y) * progress,
        pressure:
          previousPoint.pressure + (currentPoint.pressure - previousPoint.pressure) * progress,
        time: Math.round(previousPoint.time + (currentPoint.time - previousPoint.time) * progress),
      });
    }
  }

  return nextPoints;
}

export function getFreehandOutline(input: {
  points: TimedInkPoint[];
  tool: Exclude<NotebookStrokeTool, "eraser">;
  width: number;
}): StrokeOutlinePoint[] {
  const points = interpolateInkPoints(
    input.points,
    input.tool === "highlighter" ? 10 : DEFAULT_INTERPOLATION_DISTANCE
  );
  if (points.length === 0) return [];

  const outline = getStroke(points, {
    size: Math.max(1, input.width),
    thinning: input.tool === "highlighter" ? 0.16 : 0.58,
    smoothing: input.tool === "highlighter" ? 0.58 : 0.72,
    streamline: input.tool === "highlighter" ? 0.32 : 0.42,
    simulatePressure: false,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    last: true,
  });

  return outline.map((point) => [point[0], point[1]]);
}

export function getSvgPathFromStrokeOutline(outline: StrokeOutlinePoint[]) {
  if (outline.length === 0) return "";
  const [firstPoint, ...remainingPoints] = outline;
  const path = [`M ${firstPoint[0].toFixed(2)} ${firstPoint[1].toFixed(2)}`];
  for (const point of remainingPoints) {
    path.push(`L ${point[0].toFixed(2)} ${point[1].toFixed(2)}`);
  }
  path.push("Z");
  return path.join(" ");
}
