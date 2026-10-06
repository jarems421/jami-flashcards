import {
  MAX_POLYGON_POINTS,
  MIN_SHAPE_FRACTION,
  clampPoint,
  clampShape,
  type OcclusionLabel,
  type OcclusionPoint,
  type OcclusionPointer,
  type OcclusionShape,
} from "@/lib/study/image-occlusion";

/*
 * The shapes a diagram's labels are covered with, as the editor draws, moves,
 * resizes and crops them. Every point is a fraction of the picture, so a shape
 * means the same thing at any size the picture is shown.
 */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** An outline's corners in fractions of the picture. */
function polygonPoints(shape: OcclusionShape): OcclusionPoint[] {
  return (shape.points ?? []).map((point) => ({
    x: shape.x + point.x * shape.width,
    y: shape.y + point.y * shape.height,
  }));
}

function pointInPolygon(point: OcclusionPoint, polygon: readonly OcclusionPoint[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function nearestPointOnSegment(point: OcclusionPoint, a: OcclusionPoint, b: OcclusionPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * The line from a label's box to what it points at, in fractions of the
 * picture, or null when the line would start inside the box.
 *
 * It leaves the box's edge rather than its middle, as a printed leader line
 * does, heading for the bend when there is one. Worked out in pixels, because
 * an oval on a wide picture is only round on screen.
 */
export function getPointerLine(
  shape: OcclusionShape,
  pointer: OcclusionPointer,
  imageWidth: number,
  imageHeight: number
) {
  const toPixels = (point: OcclusionPoint) => ({ x: point.x * imageWidth, y: point.y * imageHeight });
  const aim = toPixels(pointer.bend ?? pointer);
  const left = shape.x * imageWidth;
  const top = shape.y * imageHeight;
  const width = shape.width * imageWidth;
  const height = shape.height * imageHeight;
  let start: OcclusionPoint;

  if (shape.kind === "ellipse") {
    const centre = { x: left + width / 2, y: top + height / 2 };
    const dx = aim.x - centre.x;
    const dy = aim.y - centre.y;
    const reach = Math.hypot(dx / (width / 2), dy / (height / 2));
    if (reach <= 1) return null;
    start = { x: centre.x + dx / reach, y: centre.y + dy / reach };
  } else if (shape.kind === "polygon") {
    const outline = polygonPoints(shape).map(toPixels);
    if (outline.length < 3 || pointInPolygon(aim, outline)) return null;
    let best = outline[0];
    let bestDistance = Infinity;
    for (let index = 0; index < outline.length; index += 1) {
      const candidate = nearestPointOnSegment(aim, outline[index], outline[(index + 1) % outline.length]);
      const distance = Math.hypot(candidate.x - aim.x, candidate.y - aim.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    start = best;
  } else {
    // The nearest point of the box: straight out from the side facing the aim.
    start = { x: clamp(aim.x, left, left + width), y: clamp(aim.y, top, top + height) };
    if (start.x === aim.x && start.y === aim.y) return null;
  }

  return {
    x1: start.x / imageWidth,
    y1: start.y / imageHeight,
    ...(pointer.bend ? { bend: { x: pointer.bend.x, y: pointer.bend.y } } : {}),
    x2: pointer.x,
    y2: pointer.y,
  };
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

/** The box between two corners, dragged in any direction. */
export function shapeFromPoints(
  kind: "rect" | "ellipse",
  start: OcclusionPoint,
  end: OcclusionPoint
): OcclusionShape {
  const left = clamp(Math.min(start.x, end.x), 0, 1);
  const top = clamp(Math.min(start.y, end.y), 0, 1);
  const right = clamp(Math.max(start.x, end.x), 0, 1);
  const bottom = clamp(Math.max(start.y, end.y), 0, 1);
  return clampShape({ kind, x: left, y: top, width: right - left, height: bottom - top });
}

/**
 * The box a tap makes, centred where the finger landed.
 *
 * Label-shaped: about three times as wide as it is tall on screen, whatever
 * the picture's proportions, because a tap is almost always on a word. On a
 * phone this is the quickest way to cover a label -- tap, then drag a corner
 * if it needs to be bigger.
 */
export function defaultShapeAt(
  kind: "rect" | "ellipse",
  point: OcclusionPoint,
  imageAspect: number
): OcclusionShape {
  const width = 0.16;
  const height = clamp((width * imageAspect) / 3, 0.025, 0.2);
  return clampShape({ kind, x: point.x - width / 2, y: point.y - height / 2, width, height });
}

function distanceToSegment(point: OcclusionPoint, a: OcclusionPoint, b: OcclusionPoint) {
  const nearest = nearestPointOnSegment(point, a, b);
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

/** Ramer-Douglas-Peucker: the fewest corners that stay within `tolerance` of the path. */
function simplifyPath(path: readonly OcclusionPoint[], tolerance: number): OcclusionPoint[] {
  if (path.length <= 2) return [...path];
  let furthest = 0;
  let index = 0;
  for (let position = 1; position < path.length - 1; position += 1) {
    const distance = distanceToSegment(path[position], path[0], path[path.length - 1]);
    if (distance > furthest) {
      furthest = distance;
      index = position;
    }
  }
  if (furthest <= tolerance) return [path[0], path[path.length - 1]];
  const head = simplifyPath(path.slice(0, index + 1), tolerance);
  const tail = simplifyPath(path.slice(index), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/**
 * An outline from a freehand path traced round a part, or null for a scribble
 * too small or too thin to enclose anything.
 *
 * Simplified in on-screen proportions (`imageAspect`), so a wide picture is not
 * over-simplified across and under-simplified down.
 */
export function polygonShapeFromPath(
  path: readonly OcclusionPoint[],
  imageAspect: number
): OcclusionShape | null {
  const inScreenSpace = path.map((point) => ({ x: point.x * imageAspect, y: point.y }));
  let corners = simplifyPath(inScreenSpace, 0.004).map((point) => ({ x: point.x / imageAspect, y: point.y }));
  const first = corners[0];
  const last = corners.at(-1);
  // Closing the loop is implied; a last corner on top of the first is a duplicate.
  if (first && last && corners.length > 3 && Math.hypot(first.x - last.x, first.y - last.y) < 0.01) {
    corners = corners.slice(0, -1);
  }
  if (corners.length < 3) return null;
  if (corners.length > MAX_POLYGON_POINTS) {
    const step = corners.length / MAX_POLYGON_POINTS;
    corners = Array.from({ length: MAX_POLYGON_POINTS }, (_, index) => corners[Math.floor(index * step)]);
  }
  const clamped = corners.map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }));
  const xs = clamped.map((point) => point.x);
  const ys = clamped.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  if (width < MIN_SHAPE_FRACTION * 2 || height < MIN_SHAPE_FRACTION * 2) return null;
  return clampShape({
    kind: "polygon",
    x: left,
    y: top,
    width,
    height,
    points: clamped.map((point) => ({ x: (point.x - left) / width, y: (point.y - top) / height })),
  });
}

export function moveShape(shape: OcclusionShape, dx: number, dy: number): OcclusionShape {
  return clampShape({ ...shape, x: shape.x + dx, y: shape.y + dy });
}

/**
 * Drag one corner; the opposite corner stays where it was. An outline's
 * corners are fractions of its box, so it stretches with the box.
 */
export function resizeShape(
  shape: OcclusionShape,
  handle: ResizeHandle,
  point: OcclusionPoint
): OcclusionShape {
  const anchor = {
    x: handle === "nw" || handle === "sw" ? shape.x + shape.width : shape.x,
    y: handle === "nw" || handle === "ne" ? shape.y + shape.height : shape.y,
  };
  const box = shapeFromPoints("rect", anchor, point);
  return clampShape({ ...shape, x: box.x, y: box.y, width: box.width, height: box.height });
}

export function shapeContainsPoint(shape: OcclusionShape, point: OcclusionPoint) {
  if (shape.kind === "ellipse") {
    const rx = shape.width / 2;
    const ry = shape.height / 2;
    const dx = (point.x - (shape.x + rx)) / rx;
    const dy = (point.y - (shape.y + ry)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  if (shape.kind === "polygon") return pointInPolygon(point, polygonPoints(shape));
  return (
    point.x >= shape.x &&
    point.x <= shape.x + shape.width &&
    point.y >= shape.y &&
    point.y <= shape.y + shape.height
  );
}

/** The topmost box under a point: later boxes are drawn over earlier ones. */
export function findShapeAt(labels: readonly OcclusionLabel[], point: OcclusionPoint) {
  for (let labelIndex = labels.length - 1; labelIndex >= 0; labelIndex -= 1) {
    const label = labels[labelIndex];
    for (let shapeIndex = label.shapes.length - 1; shapeIndex >= 0; shapeIndex -= 1) {
      if (shapeContainsPoint(label.shapes[shapeIndex], point)) {
        return { labelId: label.id, shapeIndex };
      }
    }
  }
  return null;
}

/** A crop, as fractions of the picture before cropping. */
export type OcclusionCrop = { x: number; y: number; width: number; height: number };

function cropPoint(point: OcclusionPoint, crop: OcclusionCrop) {
  return { x: (point.x - crop.x) / crop.width, y: (point.y - crop.y) / crop.height };
}

const onPicture = (point: OcclusionPoint) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

function cropShape(shape: OcclusionShape, crop: OcclusionCrop): OcclusionShape | null {
  const left = Math.max(shape.x, crop.x);
  const top = Math.max(shape.y, crop.y);
  const right = Math.min(shape.x + shape.width, crop.x + crop.width);
  const bottom = Math.min(shape.y + shape.height, crop.y + crop.height);
  if (right <= left || bottom <= top) return null;
  const kept = ((right - left) * (bottom - top)) / (shape.width * shape.height);
  if (kept < 0.5) return null;
  if (shape.kind === "polygon") {
    // Corners past the crop are pulled onto its edge, then the box is refitted.
    const corners = polygonPoints(shape).map((point) => {
      const moved = cropPoint(point, crop);
      return { x: clamp(moved.x, 0, 1), y: clamp(moved.y, 0, 1) };
    });
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(Math.max(...xs) - x, MIN_SHAPE_FRACTION);
    const height = Math.max(Math.max(...ys) - y, MIN_SHAPE_FRACTION);
    return clampShape({
      kind: "polygon",
      x,
      y,
      width,
      height,
      points: corners.map((point) => ({ x: (point.x - x) / width, y: (point.y - y) / height })),
    });
  }
  return clampShape({
    kind: shape.kind,
    x: (left - crop.x) / crop.width,
    y: (top - crop.y) / crop.height,
    width: (right - left) / crop.width,
    height: (bottom - top) / crop.height,
  });
}

/**
 * Labels moved into a cropped picture.
 *
 * A box mostly inside the crop is cut to its edge and kept; one mostly
 * outside is dropped, and so is a label left with no boxes. Mostly means half:
 * less than that and what remains no longer covers the word it was drawn on.
 * A pointer whose tip is cropped away loses its line, and a bend cropped away
 * leaves the line straight; the box stays either way.
 */
export function cropLabels(labels: readonly OcclusionLabel[], crop: OcclusionCrop): OcclusionLabel[] {
  const result: OcclusionLabel[] = [];
  for (const label of labels) {
    const shapes = label.shapes
      .map((shape) => cropShape(shape, crop))
      .filter((shape): shape is OcclusionShape => shape !== null);
    if (shapes.length === 0) continue;
    const { pointer, ...rest } = label;
    const tip = pointer ? cropPoint(pointer, crop) : null;
    const bend = pointer?.bend ? cropPoint(pointer.bend, crop) : null;
    const moved: OcclusionPointer | null =
      tip && onPicture(tip)
        ? { ...clampPoint(tip), ...(bend && onPicture(bend) ? { bend: clampPoint(bend) } : {}) }
        : null;
    result.push({ ...rest, shapes, ...(moved ? { pointer: moved } : {}) });
  }
  return result;
}
