/**
 * Turns path commands into polylines: each curve is split until a straight
 * chord stands in for it within a tolerance. For work that only needs to walk
 * along a path (coverage, hit tests, clipping), not for drawing it.
 */

import type { InkPathCommand, InkPoint } from "@/lib/ink/model";

export type InkPolyline = { points: InkPoint[]; closed: boolean };

/**
 * A curve is split at most this many times in a row, so a pathological
 * tolerance cannot make one curve into millions of segments.
 */
const MAX_DEPTH = 12;
/** A tolerance this small is as good as exact; it also keeps 0 and NaN safe. */
const MIN_TOLERANCE = 1e-6;

/** Distance from (px, py) to the segment a-b, not the infinite line through it. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function flattenQuadratic(
  out: InkPoint[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tolerance: number,
  depth: number
): void {
  // A quadratic strays from its chord by at most half its control point's
  // distance, so testing the control point itself is the safe side of that.
  if (depth >= MAX_DEPTH || distanceToSegment(x1, y1, x0, y0, x2, y2) <= tolerance) {
    out.push({ x: x2, y: y2 });
    return;
  }
  const ax = (x0 + x1) / 2;
  const ay = (y0 + y1) / 2;
  const bx = (x1 + x2) / 2;
  const by = (y1 + y2) / 2;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  flattenQuadratic(out, x0, y0, ax, ay, mx, my, tolerance, depth + 1);
  flattenQuadratic(out, mx, my, bx, by, x2, y2, tolerance, depth + 1);
}

function flattenCubic(
  out: InkPoint[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tolerance: number,
  depth: number
): void {
  // A cubic strays from its chord by at most three quarters of its farthest
  // control point, so testing the control points themselves is the safe side.
  if (
    depth >= MAX_DEPTH ||
    (distanceToSegment(x1, y1, x0, y0, x3, y3) <= tolerance &&
      distanceToSegment(x2, y2, x0, y0, x3, y3) <= tolerance)
  ) {
    out.push({ x: x3, y: y3 });
    return;
  }
  const ax = (x0 + x1) / 2;
  const ay = (y0 + y1) / 2;
  const bx = (x1 + x2) / 2;
  const by = (y1 + y2) / 2;
  const cx = (x2 + x3) / 2;
  const cy = (y2 + y3) / 2;
  const dx = (ax + bx) / 2;
  const dy = (ay + by) / 2;
  const ex = (bx + cx) / 2;
  const ey = (by + cy) / 2;
  const mx = (dx + ex) / 2;
  const my = (dy + ey) / 2;
  flattenCubic(out, x0, y0, ax, ay, dx, dy, mx, my, tolerance, depth + 1);
  flattenCubic(out, mx, my, ex, ey, cx, cy, x3, y3, tolerance, depth + 1);
}

/**
 * One polyline per subpath. A moveto starts a subpath and a close ends it
 * (`closed`; the start point is not repeated at the end). A subpath that is
 * only a moveto is a single point. Drawing commands before any moveto have no
 * start to draw from and are skipped.
 */
export function inkFlattenPath(path: readonly InkPathCommand[], tolerance: number): InkPolyline[] {
  const limit = tolerance > MIN_TOLERANCE ? tolerance : MIN_TOLERANCE;
  const polylines: InkPolyline[] = [];
  let current: InkPolyline | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;

  for (const command of path) {
    if (command.op === "M") {
      current = { points: [{ x: command.x, y: command.y }], closed: false };
      polylines.push(current);
      x = startX = command.x;
      y = startY = command.y;
      hasStart = true;
      continue;
    }
    if (command.op === "Z") {
      if (current) current.closed = true;
      current = null;
      x = startX;
      y = startY;
      continue;
    }
    if (!current) {
      if (!hasStart) continue;
      // Drawing after a close carries on from the subpath's start, as SVG does.
      current = { points: [{ x: startX, y: startY }], closed: false };
      polylines.push(current);
    }
    switch (command.op) {
      case "L":
        current.points.push({ x: command.x, y: command.y });
        break;
      case "Q":
        flattenQuadratic(current.points, x, y, command.x1, command.y1, command.x, command.y, limit, 0);
        break;
      case "C":
        flattenCubic(
          current.points,
          x,
          y,
          command.x1,
          command.y1,
          command.x2,
          command.y2,
          command.x,
          command.y,
          limit,
          0
        );
        break;
    }
    x = command.x;
    y = command.y;
  }
  return polylines;
}
