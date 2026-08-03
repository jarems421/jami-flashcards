/**
 * The outline of a set of overlapping convex polygons.
 *
 * A highlighter stroke is drawn as one convex footprint per step of the nib.
 * That is what makes it impossible for the shape to fold through itself and eat
 * a hole -- but it means the saved path is a dozen separate subpaths joined by
 * `MoveTo`, and js-draw's eraser cannot survive that. `Path.asClosed()`, which
 * every erased piece passes through, replaces each `MoveTo` with a `LineTo`:
 * the footprints get welded into one zig-zag polygon that bridges between them
 * and bulges outside the original wash. The splitting logic above it is worse
 * still, because it pairs split pieces on the assumption that the path is a
 * single closed loop.
 *
 * Tracing the union once, at commit, turns the same region into one simple
 * closed loop. Nothing about the saved format changes -- it is still an
 * ordinary filled path -- but the eraser now sees the shape it expects, and a
 * highlighter divides exactly like a pen stroke does.
 *
 * This is not a general boolean-op library and does not need to be: every input
 * is convex, which makes "is this edge inside another polygon?" a sign test.
 */

export type NotebookUnionPoint = { x: number; y: number };

/**
 * Points closer than this are the same point.
 *
 * Footprints share a whole edge wherever the nib barely moved, so the tolerance
 * has to be loose enough to weld those together and tight enough to keep a
 * genuine corner. Canvas units; a notebook page is 900 across.
 */
const WELD_EPSILON = 1e-6;
/** Below this a traced loop is a sliver rather than a shape. */
const MIN_UNION_AREA = 1e-9;

type Edge = {
  from: NotebookUnionPoint;
  to: NotebookUnionPoint;
};

type Bounds = { maxX: number; maxY: number; minX: number; minY: number };

function boundsOf(points: readonly NotebookUnionPoint[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(first: Bounds, second: Bounds) {
  return (
    first.minX <= second.maxX + WELD_EPSILON &&
    first.maxX >= second.minX - WELD_EPSILON &&
    first.minY <= second.maxY + WELD_EPSILON &&
    first.maxY >= second.minY - WELD_EPSILON
  );
}

function boundsContain(bounds: Bounds, point: NotebookUnionPoint) {
  return (
    point.x >= bounds.minX - WELD_EPSILON &&
    point.x <= bounds.maxX + WELD_EPSILON &&
    point.y >= bounds.minY - WELD_EPSILON &&
    point.y <= bounds.maxY + WELD_EPSILON
  );
}

function cross(
  origin: NotebookUnionPoint,
  first: NotebookUnionPoint,
  second: NotebookUnionPoint
) {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

function samePoint(first: NotebookUnionPoint, second: NotebookUnionPoint) {
  return (
    Math.abs(first.x - second.x) <= WELD_EPSILON &&
    Math.abs(first.y - second.y) <= WELD_EPSILON
  );
}

export function getNotebookPolygonArea(points: readonly NotebookUnionPoint[]) {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

/** Counter-clockwise winding, so every polygon here agrees on which way is out. */
function withPositiveWinding(points: NotebookUnionPoint[]) {
  return getNotebookPolygonArea(points) < 0 ? [...points].reverse() : points;
}

/**
 * Strictly inside, by a margin.
 *
 * Edges that merely graze another polygon's boundary -- which every shared
 * footprint edge does -- must survive, or the trace loses the loop.
 */
function isStrictlyInsideConvex(
  point: NotebookUnionPoint,
  polygon: readonly NotebookUnionPoint[],
  margin: number
) {
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    const edgeLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (edgeLength <= WELD_EPSILON) continue;
    // Positive winding puts the interior on the left of every edge.
    if (cross(from, to, point) / edgeLength <= margin) return false;
  }
  return true;
}

/**
 * Where a segment crosses a polygon's boundary, as parameters along it.
 *
 * Only proper crossings count. A segment that touches a vertex or runs along an
 * edge is left whole: splitting there produces zero-length fragments that the
 * trace then has to reason about.
 */
function getEdgeSplitParameters(edge: Edge, polygon: readonly NotebookUnionPoint[]) {
  const parameters: number[] = [];
  const edgeDx = edge.to.x - edge.from.x;
  const edgeDy = edge.to.y - edge.from.y;

  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    const otherDx = to.x - from.x;
    const otherDy = to.y - from.y;
    const denominator = edgeDx * otherDy - edgeDy * otherDx;
    if (Math.abs(denominator) <= WELD_EPSILON) continue;
    const originDx = from.x - edge.from.x;
    const originDy = from.y - edge.from.y;
    const parameter = (originDx * otherDy - originDy * otherDx) / denominator;
    const otherParameter = (originDx * edgeDy - originDy * edgeDx) / denominator;
    if (
      parameter > WELD_EPSILON &&
      parameter < 1 - WELD_EPSILON &&
      otherParameter > WELD_EPSILON &&
      otherParameter < 1 - WELD_EPSILON
    ) {
      parameters.push(parameter);
    }
  }

  return parameters;
}

/**
 * Where another polygon's corners land on this edge.
 *
 * Crossings alone are not enough. Two footprints frequently share part of an
 * edge rather than cutting across it, and a shared run has no proper
 * intersection to find -- so the pieces never line up, the trace reaches a
 * vertex with nowhere to go, and the whole union is abandoned. Splitting at the
 * corners that sit on the edge gives both polygons the same breakpoints.
 */
function getVertexSplitParameters(edge: Edge, polygon: readonly NotebookUnionPoint[]) {
  const parameters: number[] = [];
  const edgeDx = edge.to.x - edge.from.x;
  const edgeDy = edge.to.y - edge.from.y;
  const lengthSquared = edgeDx * edgeDx + edgeDy * edgeDy;
  if (lengthSquared <= WELD_EPSILON) return parameters;
  const length = Math.sqrt(lengthSquared);

  for (const vertex of polygon) {
    const parameter =
      ((vertex.x - edge.from.x) * edgeDx + (vertex.y - edge.from.y) * edgeDy) /
      lengthSquared;
    if (parameter <= WELD_EPSILON || parameter >= 1 - WELD_EPSILON) continue;
    const distance =
      Math.abs(
        edgeDx * (vertex.y - edge.from.y) - edgeDy * (vertex.x - edge.from.x)
      ) / length;
    if (distance <= WELD_EPSILON) parameters.push(parameter);
  }

  return parameters;
}

/**
 * Traces the outer boundary of a union of convex polygons.
 *
 * Every edge is cut at its crossings with the other polygons, so each resulting
 * piece is either wholly inside another polygon or wholly outside it. The
 * inside ones are dropped, and the survivors are walked into a loop.
 *
 * Starting from the leftmost point guarantees the trace begins on the outer
 * boundary. At each junction it takes the most clockwise turn available, which
 * keeps it on that boundary rather than wandering into an interior hole -- so a
 * highlighter drawn as a closed ring comes back filled rather than hollow. That
 * is deliberate: a highlighter is not a stencil.
 *
 * Returns `null` rather than a wrong shape whenever the trace cannot be
 * trusted. Callers keep their existing geometry in that case.
 */
export function unionOfConvexPolygons(
  polygons: ReadonlyArray<readonly NotebookUnionPoint[]>
): NotebookUnionPoint[] | null {
  const shapes = polygons
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => withPositiveWinding([...polygon]))
    .filter((polygon) => Math.abs(getNotebookPolygonArea(polygon)) > MIN_UNION_AREA);
  if (shapes.length === 0) return null;
  if (shapes.length === 1) return shapes[0];

  // Footprints overlap their neighbours and nothing else, so comparing every
  // pair would do quadratic work for a linear result. Bounds keep it to the
  // polygons that can actually interact.
  const shapeBounds = shapes.map(boundsOf);
  const boundaryEdges: Edge[] = [];
  for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
    const shape = shapes[shapeIndex];
    for (let index = 0; index < shape.length; index += 1) {
      const from = shape[index];
      const to = shape[(index + 1) % shape.length];
      if (samePoint(from, to)) continue;

      const edgeBounds = boundsOf([from, to]);
      const neighbours: number[] = [];
      for (let other = 0; other < shapes.length; other += 1) {
        if (other === shapeIndex) continue;
        if (boundsOverlap(edgeBounds, shapeBounds[other])) neighbours.push(other);
      }

      const parameters = new Set<number>();
      for (const other of neighbours) {
        for (const parameter of getEdgeSplitParameters({ from, to }, shapes[other])) {
          parameters.add(parameter);
        }
        for (const parameter of getVertexSplitParameters({ from, to }, shapes[other])) {
          parameters.add(parameter);
        }
      }

      const cuts = [0, ...[...parameters].sort((left, right) => left - right), 1];
      for (let cut = 0; cut < cuts.length - 1; cut += 1) {
        const startParameter = cuts[cut];
        const endParameter = cuts[cut + 1];
        if (endParameter - startParameter <= WELD_EPSILON) continue;
        const pointAt = (parameter: number) => ({
          x: from.x + (to.x - from.x) * parameter,
          y: from.y + (to.y - from.y) * parameter,
        });
        const midpoint = pointAt((startParameter + endParameter) / 2);
        const swallowed = neighbours.some(
          (other) =>
            boundsContain(shapeBounds[other], midpoint) &&
            isStrictlyInsideConvex(midpoint, shapes[other], WELD_EPSILON)
        );
        if (swallowed) continue;
        boundaryEdges.push({
          from: pointAt(startParameter),
          to: pointAt(endParameter),
        });
      }
    }
  }

  if (boundaryEdges.length < 3) return null;

  let startEdgeIndex = 0;
  for (let index = 1; index < boundaryEdges.length; index += 1) {
    const candidate = boundaryEdges[index].from;
    const current = boundaryEdges[startEdgeIndex].from;
    if (
      candidate.x < current.x ||
      (candidate.x === current.x && candidate.y < current.y)
    ) {
      startEdgeIndex = index;
    }
  }

  const used = new Uint8Array(boundaryEdges.length);
  const startEdge = boundaryEdges[startEdgeIndex];
  const outline: NotebookUnionPoint[] = [startEdge.from];
  let currentEdge = startEdge;
  used[startEdgeIndex] = 1;

  // One visit per edge is the hard bound: the boundary cannot be longer than
  // the edges it is made of, and a trace that needs more has gone wrong.
  for (let step = 0; step < boundaryEdges.length; step += 1) {
    if (samePoint(currentEdge.to, startEdge.from) && outline.length >= 3) {
      const area = Math.abs(getNotebookPolygonArea(outline));
      return area > MIN_UNION_AREA ? outline : null;
    }

    const incomingX = currentEdge.to.x - currentEdge.from.x;
    const incomingY = currentEdge.to.y - currentEdge.from.y;
    let bestIndex = -1;
    let bestAngle = Number.POSITIVE_INFINITY;

    for (let index = 0; index < boundaryEdges.length; index += 1) {
      if (used[index]) continue;
      const candidate = boundaryEdges[index];
      if (!samePoint(candidate.from, currentEdge.to)) continue;
      const outgoingX = candidate.to.x - candidate.from.x;
      const outgoingY = candidate.to.y - candidate.from.y;
      // Turn measured clockwise from the incoming direction, so the smallest
      // value hugs the outside of the union.
      const angle =
        Math.atan2(
          incomingX * outgoingY - incomingY * outgoingX,
          incomingX * outgoingX + incomingY * outgoingY
        ) + Math.PI;
      if (angle < bestAngle) {
        bestAngle = angle;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) return null;
    used[bestIndex] = 1;
    currentEdge = boundaryEdges[bestIndex];
    outline.push(currentEdge.from);
  }

  return null;
}
