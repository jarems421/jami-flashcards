import {
  MAX_LINES_PER_CONSTELLATION,
  normalizeConstellationLines,
  type ConstellationLine,
} from "@/lib/constellation/constellations";
import {
  getEffectiveStarVisualSize,
  type NormalizedStar,
  type StarPosition,
} from "@/lib/constellation/stars";
import { findStarMap, type StarMap } from "@/lib/constellation/star-maps";

/**
 * Turning a drawing into a constellation, with however many stars there are.
 *
 * Jami used to place each star by id, and it was bad at it in two ways that
 * were really one: a picture came out as a scatter that only resembled the
 * request, and a request needing more stars than the sky held fell apart.
 * Counting and spatial bookkeeping are exactly what a language model is
 * weakest at. So Jami only draws -- strokes on a square canvas -- and
 * everything numeric happens here.
 *
 * Fewer stars than points is the case that matters, and it is decided stroke
 * by stroke rather than point by point. An earlier pass ranked every point in
 * the drawing on one scale, and a cat's whisker tips and eyes outranked the
 * outline of its head: six stars made a stray cross. Now:
 *
 * - The biggest strokes are kept first, and a stroke with a mirror twin -- two
 *   ears, two wings -- is kept or dropped with it, so a small sky gives a
 *   simple symmetric picture rather than a lopsided detailed one.
 * - Within a stroke, points go in the order Visvalingam's method removes them:
 *   the gentlest bends first, the sharp corners and tips last. A five-star
 *   heart keeps its point.
 * - Stars are only shared where strokes genuinely meet, and lines only follow
 *   strokes, so no line is ever invented between two parts of a picture.
 *
 * With more stars than points, long strokes gain points along their length up
 * to a sensible density, and the rest are scattered around the picture as sky.
 */

export type SkyDrawingPoint = [number, number];
export type SkyDrawingStroke = { points: SkyDrawingPoint[]; closed: boolean };

export type SkyDrawing = {
  /** Empty when the picture is a real constellation. */
  strokes: SkyDrawingStroke[];
  /** Where the picture sits, as the centre in sky percentages and a size from 0.3 to 1. */
  area: { x: number; y: number; size: number };
  /** A real constellation's key, drawn from its star map instead of strokes. */
  constellation?: string;
};

export type SkyArrangement = {
  positions: Record<string, StarPosition>;
  lines: ConstellationLine[];
  /** How many stars ended up in the picture rather than scattered around it. */
  figureStarCount: number;
};

const MAX_STROKES = 16;
const MAX_POINTS_PER_STROKE = 60;
/** Canvas points closer than this are one point: where two strokes meet. */
const MERGE_DISTANCE = 1.5;
/** Kept in from the edge, so no star is drawn half off the sky. */
const EDGE_MARGIN = 6;
/** Of the sky, kept clear around the picture when fitting it. */
const FIT_MARGIN = 0.1;
/** Closer than this, in screen units, and two stars read as one. */
const MIN_SEPARATION = 3.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readPoint(value: unknown): SkyDrawingPoint | null {
  let x: unknown;
  let y: unknown;
  if (Array.isArray(value)) {
    const pair: unknown[] = value;
    [x, y] = pair;
  } else if (typeof value === "object" && value !== null) {
    ({ x, y } = value as { x?: unknown; y?: unknown });
  }
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [clamp(x, 0, 100), clamp(y, 0, 100)];
}

function readStroke(value: unknown): SkyDrawingStroke | null {
  let rawPoints: unknown;
  let closed = false;
  if (Array.isArray(value)) {
    rawPoints = value;
  } else if (typeof value === "object" && value !== null) {
    const stroke = value as { points?: unknown; closed?: unknown };
    rawPoints = stroke.points;
    closed = stroke.closed === true;
  }
  if (!Array.isArray(rawPoints)) return null;
  const entries: unknown[] = rawPoints;
  const points = entries
    .slice(0, MAX_POINTS_PER_STROKE)
    .map(readPoint)
    .filter((point): point is SkyDrawingPoint => point !== null);
  return points.length > 0 ? { points, closed: closed && points.length > 2 } : null;
}

/** Reads a drawing from Jami's reply, or from the page sending the last one back. */
export function readSkyDrawing(value: unknown): SkyDrawing | null {
  if (typeof value !== "object" || value === null) return null;
  const { strokes, area, constellation } = value as {
    strokes?: unknown;
    area?: unknown;
    constellation?: unknown;
  };
  // A constellation this app has no map of falls back to whatever was drawn.
  const starMap = typeof constellation === "string" ? findStarMap(constellation) : null;
  const entries: unknown[] = !starMap && Array.isArray(strokes) ? strokes : [];
  const readStrokes = entries
    .slice(0, MAX_STROKES)
    .map(readStroke)
    .filter((stroke): stroke is SkyDrawingStroke => stroke !== null);
  if (!starMap && readStrokes.length === 0) return null;

  const { x, y, size } =
    typeof area === "object" && area !== null
      ? (area as { x?: unknown; y?: unknown; size?: unknown })
      : {};
  const finite = (input: unknown): input is number =>
    typeof input === "number" && Number.isFinite(input);

  return {
    strokes: readStrokes,
    ...(starMap ? { constellation: starMap.key } : {}),
    area: {
      x: finite(x) ? clamp(x, 15, 85) : 50,
      y: finite(y) ? clamp(y, 15, 85) : 50,
      // Accepted as a fraction or a percentage, since both are natural to write.
      size: finite(size) ? clamp(size > 1 ? size / 100 : size, 0.3, 1) : 0.9,
    },
  };
}

type Point = { x: number; y: number };

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundsOf(points: Point[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function toPoint([x, y]: SkyDrawingPoint): Point {
  return { x, y };
}

function strokeLength(stroke: SkyDrawingStroke) {
  let length = 0;
  for (let index = 1; index < stroke.points.length; index += 1) {
    length += distance(toPoint(stroke.points[index - 1]), toPoint(stroke.points[index]));
  }
  if (stroke.closed) {
    length += distance(toPoint(stroke.points[stroke.points.length - 1]), toPoint(stroke.points[0]));
  }
  return length;
}

/** The fewest points a stroke can keep and still be itself. */
function minimumPoints(stroke: SkyDrawingStroke) {
  if (stroke.points.length === 1) return 1;
  return stroke.closed ? 3 : 2;
}

function triangleArea(a: Point, b: Point, c: Point) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/**
 * How much each point matters to its stroke, by Visvalingam-Whyatt.
 *
 * Points are removed smallest triangle first, and each is scored by the area it
 * took with it, never less than the point removed before it. The ones that
 * survive to the end -- a line's two ends, a closed shape's last three -- are
 * the stroke itself and score Infinity.
 */
function pointWeights(stroke: SkyDrawingStroke) {
  const points = stroke.points.map(toPoint);
  const weights = points.map(() => Infinity);
  const alive = points.map((_, index) => index);
  const keep = minimumPoints(stroke);
  let floor = 0;

  while (alive.length > keep) {
    let weakest = -1;
    let weakestArea = Infinity;
    for (let position = 0; position < alive.length; position += 1) {
      const isEnd = position === 0 || position === alive.length - 1;
      if (!stroke.closed && isEnd) continue;
      const previous = alive[(position - 1 + alive.length) % alive.length];
      const next = alive[(position + 1) % alive.length];
      const area = triangleArea(points[previous], points[alive[position]], points[next]);
      if (area < weakestArea) {
        weakest = position;
        weakestArea = area;
      }
    }
    if (weakest < 0) break;
    floor = Math.max(floor, weakestArea);
    weights[alive[weakest]] = floor;
    alive.splice(weakest, 1);
  }
  return weights;
}

type StrokeUnit = { strokes: number[]; significance: number; minimum: number };

/**
 * Groups each stroke with its mirror twin, if it has one.
 *
 * Two strokes of about the same length, level with each other and either side
 * of the picture's centre are a pair -- ears, eyes, wings, whiskers -- and a
 * picture that keeps one of a pair looks broken, not simple.
 */
function strokeUnits(strokes: SkyDrawingStroke[]): StrokeUnit[] {
  const all = strokes.flatMap((stroke) => stroke.points.map(toPoint));
  const bounds = boundsOf(all);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const diagonal = Math.max(1, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY));
  const tolerance = diagonal * 0.06;

  const info = strokes.map((stroke) => {
    const box = boundsOf(stroke.points.map(toPoint));
    return {
      // A lone point still deserves a place, but after anything with a shape.
      length: stroke.points.length === 1 ? diagonal * 0.08 : strokeLength(stroke),
      centreX: (box.minX + box.maxX) / 2,
      centreY: (box.minY + box.maxY) / 2,
      minimum: minimumPoints(stroke),
    };
  });

  const paired = new Set<number>();
  const units: StrokeUnit[] = [];
  info.forEach((stroke, index) => {
    if (paired.has(index)) return;
    const twin = info.findIndex(
      (other, otherIndex) =>
        otherIndex > index &&
        !paired.has(otherIndex) &&
        other.minimum === stroke.minimum &&
        Math.min(other.length, stroke.length) / Math.max(other.length, stroke.length) > 0.8 &&
        Math.abs(stroke.centreY - other.centreY) < tolerance &&
        Math.abs(stroke.centreX - other.centreX) > tolerance &&
        Math.abs(stroke.centreX + other.centreX - 2 * centreX) < tolerance
    );
    paired.add(index);
    if (twin >= 0) {
      paired.add(twin);
      units.push({
        strokes: [index, twin],
        significance: stroke.length + info[twin].length,
        minimum: stroke.minimum + info[twin].minimum,
      });
    } else {
      units.push({ strokes: [index], significance: stroke.length, minimum: stroke.minimum });
    }
  });
  return units.sort((a, b) => b.significance - a.significance);
}

type FigureNode = Point & { priority: number };

type Figure = { nodes: FigureNode[]; edges: [number, number][] };

/**
 * Chooses the points of the drawing that become stars, and the lines between them.
 */
function buildFigure(strokes: SkyDrawingStroke[], starCount: number): Figure {
  const units = strokeUnits(strokes);
  const weights = strokes.map(pointWeights);
  const unitRank = new Map<number, number>();
  units.forEach((unit, rank) => unit.strokes.forEach((stroke) => unitRank.set(stroke, rank)));

  // Whole strokes first, biggest first, pairs together, until the stars run out.
  const included: number[] = [];
  const minimumOf = new Map<number, number>();
  let budget = starCount;
  for (const unit of units) {
    if (unit.minimum <= budget) {
      for (const stroke of unit.strokes) {
        included.push(stroke);
        minimumOf.set(stroke, minimumPoints(strokes[stroke]));
      }
      budget -= unit.minimum;
    }
  }
  // Not even the biggest stroke fits: draw as much of it as there are stars.
  if (included.length === 0) {
    const stroke = units[0].strokes[0];
    included.push(stroke);
    minimumOf.set(stroke, Math.min(starCount, strokes[stroke].points.length));
  }

  const chosen = new Map<number, Set<number>>(included.map((stroke) => [stroke, new Set<number>()]));
  const byWeight = (stroke: number) =>
    strokes[stroke].points
      .map((_, vertex) => vertex)
      .sort((a, b) => weights[stroke][b] - weights[stroke][a] || a - b);
  for (const stroke of included) {
    for (const vertex of byWeight(stroke).slice(0, minimumOf.get(stroke))) {
      chosen.get(stroke)?.add(vertex);
    }
  }

  // Every other point of the kept strokes, most important first.
  const extras = included
    .flatMap((stroke) =>
      strokes[stroke].points.map((_, vertex) => ({ stroke, vertex, weight: weights[stroke][vertex] }))
    )
    .filter(({ stroke, vertex }) => !chosen.get(stroke)?.has(vertex))
    .sort((a, b) => b.weight - a.weight || (unitRank.get(a.stroke) ?? 0) - (unitRank.get(b.stroke) ?? 0));

  const assemble = (): Figure => {
    const nodes: FigureNode[] = [];
    const nodeAt = (point: Point, priority: number) => {
      const existing = nodes.findIndex((node) => distance(node, point) <= MERGE_DISTANCE);
      if (existing >= 0) {
        nodes[existing].priority = Math.max(nodes[existing].priority, priority);
        return existing;
      }
      nodes.push({ ...point, priority });
      return nodes.length - 1;
    };
    const edges: [number, number][] = [];
    const addEdge = (a: number, b: number) => {
      if (a === b) return;
      const [low, high] = a < b ? [a, b] : [b, a];
      if (!edges.some(([x, y]) => x === low && y === high)) edges.push([low, high]);
    };

    for (const stroke of included) {
      const vertices = [...(chosen.get(stroke) ?? [])].sort((a, b) => a - b);
      const rank = unitRank.get(stroke) ?? 0;
      const ids = vertices.map((vertex) => {
        const weight = weights[stroke][vertex];
        // Lone points are the eyes and noses: they take the brightest stars.
        const priority = strokes[stroke].points.length === 1
          ? 3e12
          : Number.isFinite(weight)
            ? weight
            : 2e12 - rank;
        return nodeAt(toPoint(strokes[stroke].points[vertex]), priority);
      });
      for (let index = 1; index < ids.length; index += 1) addEdge(ids[index - 1], ids[index]);
      if (strokes[stroke].closed && ids.length > 2) addEdge(ids[ids.length - 1], ids[0]);
    }
    return { nodes, edges };
  };

  // Strokes that meet share a star, which frees one: spend it on the next point.
  let figure = assemble();
  while (figure.nodes.length < starCount && extras.length > 0) {
    const room = starCount - figure.nodes.length;
    for (const { stroke, vertex } of extras.splice(0, room)) chosen.get(stroke)?.add(vertex);
    figure = assemble();
  }
  return figure;
}

/**
 * Adds points along the longest lines, but only while they are long.
 *
 * A picture that is all evenly spaced stars stops looking like a constellation
 * and starts looking like a dotted outline, so stars beyond this go to the sky
 * around the picture instead.
 */
function densify(figure: Figure, starCount: number) {
  if (figure.nodes.length === 0) return;
  const bounds = boundsOf(figure.nodes);
  const longEnough = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.22;

  while (figure.nodes.length < starCount && figure.edges.length > 0) {
    let longest = 0;
    let longestLength = 0;
    figure.edges.forEach(([a, b], index) => {
      const length = distance(figure.nodes[a], figure.nodes[b]);
      if (length > longestLength) {
        longest = index;
        longestLength = length;
      }
    });
    if (longestLength <= longEnough) return;

    const [a, b] = figure.edges[longest];
    figure.nodes.push({
      x: (figure.nodes[a].x + figure.nodes[b].x) / 2,
      y: (figure.nodes[a].y + figure.nodes[b].y) / 2,
      priority: 0,
    });
    const middle = figure.nodes.length - 1;
    figure.edges.splice(longest, 1, [a, middle], [b, middle]);
  }
}

/**
 * From the square canvas to sky percentages, keeping the picture's proportions
 * on screen: the sky is `aspectRatio` times as wide as it is tall, so a
 * percentage across is a longer distance than a percentage down.
 */
function fitToSky(points: Point[], area: SkyDrawing["area"], aspectRatio: number): StarPosition[] {
  const bounds = boundsOf(points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const usableWidth = 100 * aspectRatio * (1 - 2 * FIT_MARGIN);
  const usableHeight = 100 * (1 - 2 * FIT_MARGIN);
  const fitted = Math.min(
    width > 0.001 ? usableWidth / width : Infinity,
    height > 0.001 ? usableHeight / height : Infinity
  );
  const scale = Number.isFinite(fitted) ? fitted * area.size : 0;

  const middleX = (bounds.minX + bounds.maxX) / 2;
  const middleY = (bounds.minY + bounds.maxY) / 2;
  const centreX = area.x * aspectRatio;
  const centreY = area.y;

  return points.map((point) => ({
    x: clamp((centreX + (point.x - middleX) * scale) / aspectRatio, EDGE_MARGIN, 100 - EDGE_MARGIN),
    y: clamp(centreY + (point.y - middleY) * scale, EDGE_MARGIN, 100 - EDGE_MARGIN),
  }));
}

function screenDistance(a: StarPosition, b: StarPosition, aspectRatio: number) {
  return Math.hypot((a.x - b.x) * aspectRatio, a.y - b.y);
}

/** A fixed wobble per slot, so the scattered stars do not sit on a visible grid. */
function jitter(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

/**
 * Places the stars the picture does not use, spread out and clear of it.
 *
 * Each goes wherever is furthest from every star already placed, which fills
 * the empty sky evenly rather than crowding the picture or stacking in a corner.
 */
function scatterAround(count: number, figure: StarPosition[], aspectRatio: number) {
  const candidates: StarPosition[] = [];
  const columns = 12;
  const rows = 8;
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const seed = column * rows + row + 1;
      candidates.push({
        x: clamp(9 + (column / (columns - 1)) * 82 + jitter(seed) * 5, EDGE_MARGIN, 100 - EDGE_MARGIN),
        y: clamp(9 + (row / (rows - 1)) * 82 + jitter(seed * 7) * 5, EDGE_MARGIN, 100 - EDGE_MARGIN),
      });
    }
  }

  const placed = [...figure];
  const scattered: StarPosition[] = [];
  for (let index = 0; index < count; index += 1) {
    let best = candidates[index % candidates.length];
    let bestGap = -1;
    for (const candidate of candidates) {
      const gap = placed.length
        ? Math.min(...placed.map((position) => screenDistance(position, candidate, aspectRatio)))
        : Infinity;
      if (gap > bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }
    scattered.push(best);
    placed.push(best);
  }
  return scattered;
}

function isCrowded(position: StarPosition, placed: StarPosition[], aspectRatio: number) {
  return placed.some((other) => screenDistance(other, position, aspectRatio) < MIN_SEPARATION);
}

/** Nudges apart stars that landed on top of each other, which would hide one. */
function separate(positions: StarPosition[], aspectRatio: number) {
  const placed: StarPosition[] = [];
  return positions.map((start) => {
    let position = start;
    for (let attempt = 0; attempt < 10 && isCrowded(position, placed, aspectRatio); attempt += 1) {
      const angle = attempt * 2.4;
      const reach = MIN_SEPARATION * (1 + attempt * 0.3);
      position = {
        x: clamp(start.x + (Math.cos(angle) * reach) / aspectRatio, EDGE_MARGIN, 100 - EDGE_MARGIN),
        y: clamp(start.y + Math.sin(angle) * reach, EDGE_MARGIN, 100 - EDGE_MARGIN),
      };
    }
    placed.push(position);
    return position;
  });
}

/**
 * A real constellation, with as many of its stars as the sky can give it.
 *
 * Nothing is added along its lines -- a star that is not there is not part of
 * Orion -- and with too few stars the faintest go first. A removed star's lines
 * are handed to its nearest neighbour, so the figure fades rather than breaking:
 * losing Mintaka still leaves Rigel and Bellatrix joined to the belt.
 */
function starMapFigure(map: StarMap, starCount: number): Figure {
  const indexOf = new Map(map.stars.map((star, index) => [star.id, index]));
  const links = map.stars.map(() => new Set<number>());
  for (const [a, b] of map.lines) {
    const from = indexOf.get(a);
    const to = indexOf.get(b);
    if (from === undefined || to === undefined) continue;
    links[from].add(to);
    links[to].add(from);
  }

  const alive = new Set(map.stars.map((_, index) => index));
  while (alive.size > starCount) {
    const faintest = [...alive].reduce((a, b) =>
      map.stars[b].magnitude > map.stars[a].magnitude ? b : a
    );
    const neighbours = [...links[faintest]];
    for (const neighbour of neighbours) links[neighbour].delete(faintest);
    links[faintest].clear();
    alive.delete(faintest);
    if (neighbours.length >= 2) {
      const hub = neighbours.reduce((a, b) =>
        distance(map.stars[b], map.stars[faintest]) < distance(map.stars[a], map.stars[faintest]) ? b : a
      );
      for (const neighbour of neighbours) {
        if (neighbour === hub) continue;
        links[neighbour].add(hub);
        links[hub].add(neighbour);
      }
    }
  }

  const kept = [...alive].sort((a, b) => a - b);
  const nodeOf = new Map(kept.map((index, order) => [index, order]));
  const edges: [number, number][] = [];
  for (const index of kept) {
    for (const link of links[index]) {
      const a = nodeOf.get(index);
      const b = nodeOf.get(link);
      if (link > index && a !== undefined && b !== undefined) edges.push([a, b]);
    }
  }
  return {
    // Brighter stars in the sky, brighter stars in the sky a student earned.
    nodes: kept.map((index) => ({
      x: map.stars[index].x,
      y: map.stars[index].y,
      priority: -map.stars[index].magnitude,
    })),
    edges,
  };
}

export function arrangeStarsToDrawing(input: {
  stars: NormalizedStar[];
  drawing: SkyDrawing;
  aspectRatio: number;
}): SkyArrangement {
  const starCount = input.stars.length;
  const starMap = input.drawing.constellation ? findStarMap(input.drawing.constellation) : null;
  let figure: Figure;
  if (starMap) {
    figure = starMapFigure(starMap, starCount);
  } else {
    figure = buildFigure(input.drawing.strokes, starCount);
    densify(figure, starCount);
  }

  // The points that matter most first, so the brightest stars land on them.
  const order = figure.nodes
    .map((_, index) => index)
    .sort((a, b) => figure.nodes[b].priority - figure.nodes[a].priority || a - b)
    .slice(0, starCount);
  const figurePositions = fitToSky(
    order.map((index) => figure.nodes[index]),
    input.drawing.area,
    input.aspectRatio
  );
  const scattered = scatterAround(starCount - order.length, figurePositions, input.aspectRatio);
  const allPositions = separate([...figurePositions, ...scattered], input.aspectRatio);

  // Ties break on id, so the same request gives the same sky.
  const byBrightness = [...input.stars].sort(
    (a, b) =>
      getEffectiveStarVisualSize(b) - getEffectiveStarVisualSize(a) || a.id.localeCompare(b.id)
  );

  const positions: Record<string, StarPosition> = {};
  const starForNode = new Map<number, string>();
  byBrightness.forEach((star, rank) => {
    const position = allPositions[rank];
    positions[star.id] = { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10 };
    if (rank < order.length) starForNode.set(order[rank], star.id);
  });

  const lines: ConstellationLine[] = [];
  for (const [a, b] of figure.edges) {
    const starA = starForNode.get(a);
    const starB = starForNode.get(b);
    if (starA && starB) lines.push({ a: starA, b: starB });
  }

  return {
    positions,
    lines: normalizeConstellationLines(lines).slice(0, MAX_LINES_PER_CONSTELLATION),
    figureStarCount: order.length,
  };
}

/**
 * What to say when the sky is short of stars for the picture asked for.
 *
 * Said here rather than left to Jami, because Jami never sees the arithmetic
 * and was either silent about it or confidently wrong.
 */
export function describeStarShortage(starCount: number, idealStars: number | null) {
  if (!idealStars || starCount >= Math.ceil(idealStars * 0.75)) return null;
  return `You have ${starCount} stars, so this is a simpler version. It will look fuller with about ${idealStars}.`;
}
