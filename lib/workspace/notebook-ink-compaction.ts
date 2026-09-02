/**
 * Thinning the points out of ink that was recorded before the pen thinned them.
 *
 * Strokes written before the smooth pen landed are stored as closed outlines
 * holding every input sample: `M x y L x y L x y ... Z`, at two decimal places
 * on a 900x1240 page. One real page measured 106 strokes, 152KB and 9,540 path
 * commands, with a worst stroke of 404. Nothing produces ink like that any more
 * -- the pen thins by curvature as it draws -- but pages written back then keep
 * their density forever, and js-draw redraws every one of those segments on
 * every full re-render, with its display cache deliberately switched off.
 *
 * So the cost of an old page never comes down on its own. This brings it down
 * once.
 *
 * Two things happen, both lossy only in ways the screen cannot show:
 *
 *  - Ramer-Douglas-Peucker drops points that sit within `epsilon` of the line
 *    between their neighbours. On an outline whose pen is two to four units
 *    wide, a quarter-unit tolerance moves no edge anyone can see.
 *  - Coordinates round to one decimal place. A tenth of a unit on a 900-unit
 *    page is well under a device pixel at any zoom the notebook allows.
 *
 * Paths using anything other than M, L and Z are returned untouched. The smooth
 * pen emits curves, and a curve's control points are not on the outline, so
 * running a polyline simplifier over them would pull the shape about.
 */

/** How far a point may sit from the line between its neighbours and be dropped. */
export const NOTEBOOK_INK_COMPACTION_EPSILON = 0.25;

/** Decimal places kept on a coordinate. A tenth of a page unit is sub-pixel. */
export const NOTEBOOK_INK_COMPACTION_PRECISION = 1;

type Point = { x: number; y: number };

export type NotebookInkCompactionResult = {
  svg: string;
  /** Paths that were simplified, and paths left alone because they curve. */
  simplifiedPaths: number;
  skippedPaths: number;
  pointsBefore: number;
  pointsAfter: number;
  bytesBefore: number;
  bytesAfter: number;
};

function perpendicularDistance(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - from.x, point.y - from.y);
  }

  // The projection of `point` onto the segment, clamped to it, is the closest
  // point on that segment -- clamped because an outline doubles back on itself
  // and an unclamped projection would measure to a line that is not there.
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared
    )
  );
  return Math.hypot(
    point.x - (from.x + t * dx),
    point.y - (from.y + t * dy)
  );
}

/**
 * Ramer-Douglas-Peucker, iteratively rather than recursively.
 *
 * A stroke can carry several hundred points and this runs over every path on a
 * page; recursion here is a stack depth set by someone else's handwriting.
 */
export function simplifyPoints(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2 || epsilon <= 0) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    let furthest = -1;
    let furthestDistance = epsilon;

    for (let index = start + 1; index < end; index += 1) {
      const distance = perpendicularDistance(
        points[index],
        points[start],
        points[end]
      );
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthest = index;
      }
    }

    if (furthest === -1) continue;

    keep[furthest] = true;
    stack.push([start, furthest], [furthest, end]);
  }

  return points.filter((_, index) => keep[index]);
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  // `+ 0` turns -0 back into 0, which would otherwise be written as "-0".
  return Math.round(value * factor) / factor + 0;
}

function formatNumber(value: number, precision: number) {
  return String(roundTo(value, precision));
}

/**
 * Simplifies one `M ... L ... Z` path, or returns null if it is not one.
 *
 * Returning null rather than throwing is what lets a page hold both old
 * polyline strokes and new curved ones and have only the first kind rewritten.
 */
export function simplifyPolylinePath(
  d: string,
  epsilon: number,
  precision: number
): { d: string; pointsBefore: number; pointsAfter: number } | null {
  const commands = d.match(/[A-Za-z]/g) ?? [];
  if (!commands.length) return null;
  if (commands.some((command) => !"MLZmlz".includes(command))) return null;

  const closed = /[Zz]\s*$/.test(d.trim());
  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  if (numbers.length < 4 || numbers.length % 2 !== 0) return null;

  const points: Point[] = [];
  for (let index = 0; index < numbers.length; index += 2) {
    const x = Number(numbers[index]);
    const y = Number(numbers[index + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }

  const simplified = simplifyPoints(points, epsilon);
  // A closed outline that thins below a triangle has no area left to draw, so
  // it keeps whatever it had rather than becoming an invisible sliver.
  if (closed && simplified.length < 3) {
    return { d, pointsBefore: points.length, pointsAfter: points.length };
  }

  const parts = simplified.map(
    (point, index) =>
      `${index === 0 ? "M" : "L"} ${formatNumber(point.x, precision)} ${formatNumber(point.y, precision)}`
  );

  return {
    d: `${parts.join(" ")}${closed ? " Z" : ""}`,
    pointsBefore: points.length,
    pointsAfter: simplified.length,
  };
}

/**
 * Rewrites every polyline path in an ink SVG, leaving everything else alone.
 *
 * Only the `d` attribute of each `<path>` is touched: colour, width, fill rule
 * and the surrounding document are copied through untouched, so the result is
 * the same drawing with fewer points in it.
 */
export function compactNotebookInkSvg(
  svg: string,
  options?: { epsilon?: number; precision?: number }
): NotebookInkCompactionResult {
  const epsilon = options?.epsilon ?? NOTEBOOK_INK_COMPACTION_EPSILON;
  const precision = options?.precision ?? NOTEBOOK_INK_COMPACTION_PRECISION;

  let simplifiedPaths = 0;
  let skippedPaths = 0;
  let pointsBefore = 0;
  let pointsAfter = 0;

  const next = svg.replace(
    /(<path\b[^>]*?\sd=")([^"]*)(")/g,
    (whole, prefix: string, d: string, suffix: string) => {
      const result = simplifyPolylinePath(d, epsilon, precision);
      if (!result) {
        skippedPaths += 1;
        return whole;
      }
      simplifiedPaths += 1;
      pointsBefore += result.pointsBefore;
      pointsAfter += result.pointsAfter;
      return `${prefix}${result.d}${suffix}`;
    }
  );

  return {
    svg: next,
    simplifiedPaths,
    skippedPaths,
    pointsBefore,
    pointsAfter,
    bytesBefore: Buffer.byteLength(svg, "utf8"),
    bytesAfter: Buffer.byteLength(next, "utf8"),
  };
}
