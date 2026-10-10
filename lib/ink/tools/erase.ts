/**
 * The geometry of Jami Ink's two erasers, pure and DOM-free.
 *
 * The stroke eraser takes whole items: {@link inkItemsTouchedBySweep} says which
 * ones the eraser's path reached. The precision eraser takes only the ink under
 * it: {@link inkPrecisionErase} returns, for each touched item, the pieces that
 * survive, ready for `inkReplaceChange`.
 *
 * The eraser's path is a list of centre points in page units (one point is a
 * stamp, two or more are capsules swept between neighbours) and a radius. Stroked
 * ink is cut exactly against that path. Filled ink is clipped with
 * `polygon-clipping`, whose rings follow the nonzero rule, as the renderer fills
 * them, so a pen outline that crosses itself keeps its overlap.
 */

import polygonClipping from "polygon-clipping";
import type { Pair, Polygon } from "polygon-clipping";
import { inkFlattenPath } from "@/lib/ink/flatten";
import {
  createInkItemId,
  inkBoxesIntersect,
  inkBoxGrow,
  inkItemBounds,
  type InkBox,
  type InkDocument,
  type InkItem,
  type InkOutlineItem,
  type InkPaint,
  type InkPathCommand,
  type InkPoint,
  type InkShapeItem,
} from "@/lib/ink/model";
import { inkShapePath } from "@/lib/ink/shapes";
import {
  getNotebookCircularEraserSweepPoints,
  getNotebookSegmentDistanceSquared,
} from "@/lib/workspace/notebook-eraser";

/** The eraser's centre path in one packet; page units, at least one point. */
export type InkEraserSweep = { points: readonly InkPoint[]; radius: number };

/** Curves are flattened this finely before they are tested or cut. */
const DEFAULT_TOLERANCE = 0.05;
/** A cut shorter than this (page units) is a tangent graze, not an erasure. */
const MIN_CUT_LENGTH = 1e-6;
/** Pieces and polygons smaller than this are numerical dust. */
const MIN_PIECE_LENGTH = 1e-3;
const MIN_PIECE_AREA = 1e-4;
/** The precision clip is circumscribed, so it removes at least the radius. */
const CLIP_TOUCH_MARGIN = 1e-6;

type Polyline = { points: InkPoint[]; closed: boolean };
type Span = { start: number; end: number };

export function inkEraserSweepBox(sweep: InkEraserSweep): InkBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of sweep.points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return inkBoxGrow({ minX, minY, maxX, maxY }, sweep.radius);
}

function isVisibleFill(paint: InkPaint): boolean {
  return paint.fill !== null && paint.fill.a > 0 && paint.opacity > 0;
}

function strokeWidthOf(item: InkOutlineItem | InkShapeItem): number {
  if (item.kind === "shape") return item.color.a > 0 && item.width > 0 ? item.width : 0;
  const stroke = item.paint.stroke;
  return stroke && stroke.color.a > 0 && stroke.width > 0 && item.paint.opacity > 0 ? stroke.width : 0;
}

function pathOf(item: InkOutlineItem | InkShapeItem): InkPathCommand[] {
  return item.kind === "shape" ? inkShapePath(item.shape, item.width) : item.path;
}

/** The sweep as consecutive segments; a lone point is one zero-length segment. */
function sweepSegments(points: readonly InkPoint[]): Array<[InkPoint, InkPoint]> {
  if (points.length === 1) return [[points[0], points[0]]];
  const segments: Array<[InkPoint, InkPoint]> = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1], points[index]]);
  }
  return segments;
}

function segmentsBox(a: InkPoint, b: InkPoint, grow: number): InkBox {
  return {
    minX: Math.min(a.x, b.x) - grow,
    minY: Math.min(a.y, b.y) - grow,
    maxX: Math.max(a.x, b.x) + grow,
    maxY: Math.max(a.y, b.y) + grow,
  };
}

/** Whether the segment a-b comes within `distance` of any segment of the sweep. */
function segmentNearSweep(
  a: InkPoint,
  b: InkPoint,
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  distance: number
): boolean {
  const limit = distance * distance;
  const box = segmentsBox(a, b, distance);
  for (const [from, to] of sweep) {
    if (!inkBoxesIntersect(box, segmentsBox(from, to, 0))) continue;
    if (
      getNotebookSegmentDistanceSquared({
        firstStart: from,
        firstEnd: to,
        secondStart: a,
        secondEnd: b,
      }) <= limit
    ) {
      return true;
    }
  }
  return false;
}

/** Winding number of a point against rings taken together (the nonzero rule). */
function windingNumber(rings: readonly Polyline[], x: number, y: number): number {
  let winding = 0;
  for (const ring of rings) {
    const points = ring.points;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const a = points[previous];
      const b = points[index];
      const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
      if (a.y <= y) {
        if (b.y > y && side > 0) winding += 1;
      } else if (b.y <= y && side < 0) {
        winding -= 1;
      }
    }
  }
  return winding;
}

/** Closed rings of a filled path: every subpath with area to fill. */
function fillRings(path: readonly InkPathCommand[], tolerance: number): Polyline[] {
  return inkFlattenPath(path, tolerance).filter((polyline) => polyline.points.length >= 3);
}

function ringEdgesNear(
  rings: readonly Polyline[],
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  distance: number
): boolean {
  for (const ring of rings) {
    const points = ring.points;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      if (segmentNearSweep(points[previous], points[index], sweep, distance)) return true;
    }
  }
  return false;
}

function fillTouched(
  rings: readonly Polyline[],
  points: readonly InkPoint[],
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  radius: number
): boolean {
  if (rings.length === 0) return false;
  for (const point of points) {
    if (windingNumber(rings, point.x, point.y) !== 0) return true;
  }
  return ringEdgesNear(rings, sweep, radius);
}

function strokeTouched(
  polylines: readonly Polyline[],
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  distance: number
): boolean {
  for (const polyline of polylines) {
    const points = polyline.points;
    if (points.length === 1) {
      if (segmentNearSweep(points[0], points[0], sweep, distance)) return true;
      continue;
    }
    const count = polyline.closed ? points.length : points.length - 1;
    for (let index = 0; index < count; index += 1) {
      if (segmentNearSweep(points[index], points[(index + 1) % points.length], sweep, distance)) return true;
    }
  }
  return false;
}

function isTouched(item: InkItem, sweep: InkEraserSweep, segments: ReadonlyArray<[InkPoint, InkPoint]>): boolean {
  if (item.kind === "unknown") return false;
  const path = pathOf(item);
  if (item.kind === "outline" && isVisibleFill(item.paint)) {
    if (fillTouched(fillRings(path, DEFAULT_TOLERANCE), sweep.points, segments, sweep.radius)) return true;
  }
  const width = strokeWidthOf(item);
  if (width === 0) return false;
  return strokeTouched(inkFlattenPath(path, DEFAULT_TOLERANCE), segments, sweep.radius + width / 2);
}

/**
 * Stroke eraser: the ids, among `candidates`, of the items the eraser's path
 * reached, in document order. A filled outline is reached when the path touches
 * its filled region; stroked ink (and shapes) when it comes within the eraser's
 * radius plus half the stroke width. Items of a kind this build cannot draw are
 * never touched.
 */
export function inkItemsTouchedBySweep(
  doc: InkDocument,
  candidates: Iterable<string>,
  sweep: InkEraserSweep
): string[] {
  if (sweep.points.length === 0) return [];
  const wanted = new Set(candidates);
  const box = inkEraserSweepBox(sweep);
  const segments = sweepSegments(sweep.points);
  const touched: string[] = [];
  for (const item of doc.items) {
    if (!wanted.has(item.id) || item.kind === "unknown") continue;
    if (!inkBoxesIntersect(inkItemBounds(item), box)) continue;
    if (isTouched(item, sweep, segments)) touched.push(item.id);
  }
  return touched;
}

// ---------------------------------------------------------------------------
// Stroked ink: exact cuts

/**
 * The part of the segment p-q (as t in 0-1) that lies within `distance` of the
 * sweep segment a-b: where the line meets the capsule around a-b. The capsule is
 * the union of its two end discs and its middle rectangle, and is convex, so the
 * line's intersection is one span from the earliest start to the latest end of
 * the three.
 */
function capsuleSpan(
  p: InkPoint,
  q: InkPoint,
  a: InkPoint,
  b: InkPoint,
  distance: number
): Span | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let start = Infinity;
  let end = -Infinity;
  const include = (lo: number, hi: number) => {
    if (lo > hi) return;
    if (lo < start) start = lo;
    if (hi > end) end = hi;
  };

  const disc = (c: InkPoint) => {
    const fx = p.x - c.x;
    const fy = p.y - c.y;
    const qa = dx * dx + dy * dy;
    const qc = fx * fx + fy * fy - distance * distance;
    if (qa === 0) {
      if (qc <= 0) include(0, 1);
      return;
    }
    const qb = 2 * (dx * fx + dy * fy);
    const discriminant = qb * qb - 4 * qa * qc;
    if (discriminant < 0) return;
    const root = Math.sqrt(discriminant);
    include((-qb - root) / (2 * qa), (-qb + root) / (2 * qa));
  };
  disc(a);

  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length > 0) {
    disc(b);
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const pu = (p.x - a.x) * ux + (p.y - a.y) * uy;
    const pv = -(p.x - a.x) * uy + (p.y - a.y) * ux;
    const du = dx * ux + dy * uy;
    const dv = -dx * uy + dy * ux;
    let lo = -Infinity;
    let hi = Infinity;
    const slab = (origin: number, rate: number, min: number, max: number) => {
      if (rate === 0) {
        if (origin < min || origin > max) hi = -Infinity;
        return;
      }
      const first = (min - origin) / rate;
      const second = (max - origin) / rate;
      lo = Math.max(lo, Math.min(first, second));
      hi = Math.min(hi, Math.max(first, second));
    };
    slab(pu, du, 0, length);
    slab(pv, dv, -distance, distance);
    include(lo, hi);
  }

  if (end < start) return null;
  start = Math.max(0, start);
  end = Math.min(1, end);
  return end > start ? { start, end } : null;
}

/** The merged spans of p-q that fall inside the sweep's reach. */
function removedSpans(
  p: InkPoint,
  q: InkPoint,
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  distance: number
): Span[] {
  const box = segmentsBox(p, q, distance);
  const spans: Span[] = [];
  for (const [a, b] of sweep) {
    if (!inkBoxesIntersect(box, segmentsBox(a, b, 0))) continue;
    const span = capsuleSpan(p, q, a, b, distance);
    if (span) spans.push(span);
  }
  if (spans.length < 2) return spans;
  spans.sort((left, right) => left.start - right.start);
  const merged: Span[] = [spans[0]];
  for (let index = 1; index < spans.length; index += 1) {
    const last = merged[merged.length - 1];
    if (spans[index].start <= last.end) last.end = Math.max(last.end, spans[index].end);
    else merged.push(spans[index]);
  }
  return merged;
}

function lerp(p: InkPoint, q: InkPoint, t: number): InkPoint {
  return t <= 0 ? p : t >= 1 ? q : { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

function runLength(points: readonly InkPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

type CutResult = { cut: boolean; pieces: Polyline[] };

/** Cuts one flattened subpath against the sweep. */
function cutPolyline(
  polyline: Polyline,
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  distance: number
): CutResult {
  const source = polyline.points;
  // A dot is a subpath that never leaves its start, however many points it lists.
  if (source.length === 1 || runLength(source) === 0) {
    return segmentNearSweep(source[0], source[0], sweep, distance)
      ? { cut: true, pieces: [] }
      : { cut: false, pieces: [polyline] };
  }
  const points = polyline.closed && source.length > 2 ? [...source, source[0]] : source;
  const runs: InkPoint[][] = [];
  let run: InkPoint[] | null = null;
  let cut = false;
  let startsCut = false;
  let endsCut = false;

  for (let index = 1; index < points.length; index += 1) {
    const p = points[index - 1];
    const q = points[index];
    const spans = removedSpans(p, q, sweep, distance).filter((span) => (span.end - span.start) * Math.hypot(q.x - p.x, q.y - p.y) > MIN_CUT_LENGTH);
    if (spans.length > 0) cut = true;
    // The visible parts of the segment are what lies between the removed spans.
    let cursor = 0;
    const visible: Span[] = [];
    for (const span of spans) {
      if (span.start > cursor) visible.push({ start: cursor, end: span.start });
      cursor = span.end;
    }
    if (cursor < 1) visible.push({ start: cursor, end: 1 });

    if (index === 1) startsCut = visible.length === 0 || visible[0].start > 0;
    endsCut = visible.length === 0 || visible[visible.length - 1].end < 1;

    for (const part of visible) {
      if (part.start === 0 && run) {
        run.push(lerp(p, q, part.end));
      } else {
        if (run) runs.push(run);
        run = [lerp(p, q, part.start), lerp(p, q, part.end)];
      }
      if (part.end < 1) {
        runs.push(run);
        run = null;
      }
    }
    if (visible.length === 0 && run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);

  if (!cut) return { cut: false, pieces: [polyline] };
  // A closed subpath cut once has its seam inside the surviving run: join the
  // run that ends at the seam to the run that starts there.
  if (polyline.closed && !startsCut && !endsCut && runs.length > 1) {
    const last = runs.pop() as InkPoint[];
    const first = runs.shift() as InkPoint[];
    runs.push([...last, ...first.slice(1)]);
  }
  const pieces = runs
    .filter((points) => runLength(points) > MIN_PIECE_LENGTH)
    .map((points): Polyline => ({ points, closed: false }));
  return { cut: true, pieces };
}

function polylinePath(polyline: Polyline): InkPathCommand[] {
  const path: InkPathCommand[] = polyline.points.map(
    (point, index): InkPathCommand => ({ op: index === 0 ? "M" : "L", x: point.x, y: point.y })
  );
  if (polyline.closed) path.push({ op: "Z" });
  return path;
}

function shapePaint(item: InkShapeItem): InkPaint {
  return {
    fill: null,
    stroke: { color: item.color, width: item.width, cap: "round", join: "round" },
    opacity: 1,
  };
}

function eraseStroked(
  item: InkOutlineItem | InkShapeItem,
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  distance: number,
  tolerance: number
): InkItem[] | null {
  const paint = item.kind === "shape" ? shapePaint(item) : item.paint;
  let anyCut = false;
  const pieces: Polyline[] = [];
  for (const polyline of inkFlattenPath(pathOf(item), tolerance)) {
    const result = cutPolyline(polyline, sweep, distance);
    if (result.cut) anyCut = true;
    pieces.push(...result.pieces);
  }
  if (!anyCut) return null;
  return pieces.map((piece): InkOutlineItem => ({
    kind: "outline",
    id: createInkItemId(),
    layer: item.layer,
    path: polylinePath(piece),
    paint,
  }));
}

// ---------------------------------------------------------------------------
// Filled ink: polygon clipping

function signedArea(points: readonly InkPoint[]): number {
  let area = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    area += (points[previous].x - points[index].x) * (points[previous].y + points[index].y);
  }
  return area / 2;
}

function cross(o: InkPoint, a: InkPoint, b: InkPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Andrew's monotone chain; the sweep helper hands back two discs' vertices. */
function convexHull(input: readonly InkPoint[]): InkPoint[] {
  const points = input.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (points.length < 3) return points;
  const build = (ordered: readonly InkPoint[]): InkPoint[] => {
    const chain: InkPoint[] = [];
    for (const point of ordered) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...build(points), ...build(points.slice().reverse())];
}

function toRing(points: readonly InkPoint[]): Pair[] {
  const ring = points.map((point): Pair => [point.x, point.y]);
  ring.push([points[0].x, points[0].y]);
  return ring;
}

/** One convex polygon for each stamp or swept capsule that can reach `bounds`. */
function sweepPolygons(
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  radius: number,
  bounds: InkBox
): Polygon[] {
  const polygons: Polygon[] = [];
  for (const [from, to] of sweep) {
    if (!inkBoxesIntersect(segmentsBox(from, to, radius * 1.05), bounds)) continue;
    const hull = convexHull(getNotebookCircularEraserSweepPoints({ from, to, radius }));
    polygons.push([toRing(hull)]);
  }
  return polygons;
}

/** The pieces of a clipped region, outer rings positive and holes negative. */
function polygonsToOutlines(result: ReturnType<typeof polygonClipping.difference>, item: InkOutlineItem): InkItem[] {
  const pieces: InkItem[] = [];
  for (const polygon of result) {
    const path: InkPathCommand[] = [];
    let outerArea = 0;
    polygon.forEach((ring, ringIndex) => {
      let points = ring.slice(0, -1).map(([x, y]): InkPoint => ({ x, y }));
      if (points.length < 3) return;
      const area = signedArea(points);
      // Holes wind against their outer ring, so the nonzero fill leaves them empty.
      if (ringIndex === 0 ? area < 0 : area > 0) points = points.reverse();
      if (ringIndex === 0) outerArea = Math.abs(area);
      path.push(...polylinePath({ points, closed: true }));
    });
    if (path.length === 0 || outerArea < MIN_PIECE_AREA) continue;
    pieces.push({ kind: "outline", id: createInkItemId(), layer: item.layer, path, paint: item.paint });
  }
  return pieces;
}

/**
 * Subtracts the sweep from a filled outline. Subpaths wound against the
 * dominant direction are holes (a letter's counter); the rest are united, so
 * the clipper sees the same region the nonzero fill draws. The paint is kept as
 * it was: an item that also has a stroke gets that stroke along its new edges.
 */
function eraseFilled(
  item: InkOutlineItem,
  rings: readonly Polyline[],
  sweep: ReadonlyArray<[InkPoint, InkPoint]>,
  radius: number
): InkItem[] | null {
  const areas = rings.map((ring) => signedArea(ring.points));
  let dominant = 0;
  for (const area of areas) if (Math.abs(area) > Math.abs(dominant)) dominant = area;
  if (dominant === 0) return null;
  const positives: Polygon[] = [];
  const holes: Polygon[] = [];
  rings.forEach((ring, index) => {
    if (areas[index] === 0) return;
    (areas[index] * dominant > 0 ? positives : holes).push([toRing(ring.points)]);
  });
  const clips = sweepPolygons(sweep, radius, inkItemBounds(item));
  if (clips.length === 0) return null;
  try {
    const subject = positives.length > 1 ? polygonClipping.union(positives[0], ...positives.slice(1)) : positives[0];
    return polygonsToOutlines(polygonClipping.difference(subject, ...holes, ...clips), item);
  } catch {
    // The clipper can reject numerically degenerate input; leave that ink be.
    return null;
  }
}

/**
 * Precision eraser: for each touched item, the pieces that survive, to hand to
 * `inkReplaceChange` (an empty array means the item was wholly erased).
 * Untouched items, and items the path merely grazes, are not in the map.
 * Pieces get new ids and keep the item's layer and paint. Filled outlines
 * become one outline per resulting polygon; stroked outlines and shapes are
 * cut exactly at radius plus half the stroke width, and shapes come back as
 * stroked outlines with round caps and joins.
 */
export function inkPrecisionErase(
  doc: InkDocument,
  candidates: Iterable<string>,
  sweep: InkEraserSweep,
  tolerance: number = DEFAULT_TOLERANCE
): Map<string, InkItem[]> {
  const replacements = new Map<string, InkItem[]>();
  if (sweep.points.length === 0) return replacements;
  const wanted = new Set(candidates);
  const box = inkEraserSweepBox(sweep);
  const segments = sweepSegments(sweep.points);
  for (const item of doc.items) {
    if (!wanted.has(item.id) || item.kind === "unknown") continue;
    if (!inkBoxesIntersect(inkItemBounds(item), box)) continue;

    let pieces: InkItem[] | null = null;
    if (item.kind === "outline" && isVisibleFill(item.paint)) {
      const rings = fillRings(item.path, tolerance);
      // Test a hair inside the radius so a graze that clips nothing is skipped.
      if (fillTouched(rings, sweep.points, segments, Math.max(0, sweep.radius - CLIP_TOUCH_MARGIN))) {
        pieces = eraseFilled(item, rings, segments, sweep.radius);
      }
    } else {
      const width = strokeWidthOf(item);
      if (width > 0) pieces = eraseStroked(item, segments, sweep.radius + width / 2, tolerance);
    }
    if (pieces) replacements.set(item.id, pieces);
  }
  return replacements;
}
