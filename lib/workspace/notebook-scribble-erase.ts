/**
 * Recognising a scribble-out.
 *
 * Scribbling over a word to delete it is a gesture people already know, but it
 * is destructive and it lives on the pen -- the tool used for everything else.
 * A false positive deletes work nobody asked to delete, so the question is not
 * "could this be a scribble?" but "could this be anything else?".
 *
 * Six signals have to agree. Individually each has a plausible innocent
 * explanation: `w` and `m` reverse direction, shading retraces a band, a fast
 * flick covers ground quickly. Together they describe a motion that handwriting
 * does not make.
 *
 * Samples arrive in **page coordinates**, and the thresholds split by what they
 * actually measure. Size is a property of the content: "a scribble is about as
 * wide as a word" means a word on the page, whatever the zoom. Speed and tremor
 * are properties of the hand, which does not know what the zoom is -- so those
 * are converted back through `viewportScale` and judged on screen. Measuring
 * everything one way or the other makes the gesture easier to trigger at one
 * end of the zoom range and impossible at the other. The page is 900 across.
 */

export type NotebookScribblePoint = { x: number; y: number };
export type NotebookScribbleSample = NotebookScribblePoint & { time: number };

/**
 * A `w` has three legs and an `m` has three, so both reverse twice; a word
 * crossed out with two passes reverses once. Three reversals means four legs,
 * which clears all of them.
 *
 * Measured against scribbles as a hand actually makes them, four reversals --
 * five passes -- was simply more than people do. Most scribble-outs are three
 * or four passes, and requiring five is why the gesture did not fire.
 */
const MIN_REVERSALS = 3;
/**
 * How far the pen must travel back before a reversal counts.
 *
 * Without hysteresis, tremor at the turn of each leg registers as a flurry of
 * reversals and any slow deliberate stroke can reach four.
 */
const REVERSAL_HYSTERESIS_ON_SCREEN = 8;
/** Legs of a scribble run parallel; the strokes of a letter do not. */
const MAX_LEG_DEVIATION_DEGREES = 25;
/**
 * Path length against bounding-box diagonal: retracing, not progressing.
 *
 * A four-pass scribble measures about 2.8, so this is a floor rather than a
 * discriminator. Overlap below is the gate that actually separates retracing
 * from advancing, and it does so far more precisely.
 */
const MIN_RETRACE_RATIO = 2.5;
/**
 * Consecutive legs must cover each other, which shading and hatching do not.
 *
 * With leg deviation, one of the two load-bearing signals: a real scribble
 * measures ~1.0 against this and ~4 degrees against that, while `www` written
 * quickly fails both by a wide margin. The looser thresholds above lean on it.
 */
const MIN_LEG_OVERLAP = 0.6;
/** Smaller than this and a hurried `zz` would qualify. Roughly a word wide. */
const MIN_MAJOR_EXTENT_ON_PAGE = 48;
/**
 * How thick the gesture may be across its own direction, as a fraction of its
 * length. A scribble-out is a *band* laid over some writing; a letter is a
 * blob about as tall as it is wide.
 *
 * This is what keeps a `w` out. Its legs are parallel and they retrace each
 * other perfectly, so leg deviation and overlap both read it as a scribble --
 * and once the principal axis comes out vertical, as it does for a square
 * shape, nothing about the direction of travel distinguishes the two. Measured:
 * real scribbles land between 0.12 and 0.38, while `w`, `m`, `z` and hatching
 * all sit above 0.6.
 */
const MAX_BAND_ASPECT = 0.5;
/**
 * Scribbles are brisk. Deliberate drawing is not.
 *
 * The weakest of the six, and deliberately kept low. Ordinary scribble-outs
 * measure 0.5 to 0.9 and the original 1.2 rejected nearly all of them; a
 * relaxed one is still a scribble. Shading, which this was originally meant to
 * catch, is excluded far more convincingly by overlap and band aspect. What is
 * left for speed is the genuinely slow movement of someone drawing rather than
 * striking something out.
 */
const MIN_MEAN_SPEED_ON_SCREEN_PER_MS = 0.35;
/** Below this a stroke has too little shape to judge. */
const MIN_SAMPLES = 8;
/** Samples closer together than this are the same place. */
const MIN_SAMPLE_SPACING_ON_SCREEN = 1;

export type NotebookScribbleBand = {
  /** Convex hull of the gesture, grown by the nib, wound counter-clockwise. */
  hull: NotebookScribblePoint[];
  bounds: { maxX: number; maxY: number; minX: number; minY: number };
};

export type NotebookScribble = {
  band: NotebookScribbleBand;
  legs: number;
  reversals: number;
};

function distance(first: NotebookScribblePoint, second: NotebookScribblePoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function thinned(
  samples: readonly NotebookScribbleSample[],
  minSpacing: number
) {
  const kept: NotebookScribbleSample[] = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
    const previous = kept[kept.length - 1];
    if (previous && distance(previous, sample) < minSpacing) continue;
    kept.push(sample);
  }
  return kept;
}

/** The direction the gesture mostly runs in, by principal component. */
function principalAxis(points: readonly NotebookScribblePoint[]) {
  const centroidX =
    points.reduce((total, point) => total + point.x, 0) / points.length;
  const centroidY =
    points.reduce((total, point) => total + point.y, 0) / points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.x - centroidX;
    const dy = point.y - centroidY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  // Leading eigenvector of the 2x2 covariance matrix.
  const trace = xx + yy;
  const determinant = xx * yy - xy * xy;
  const discriminant = Math.sqrt(
    Math.max(0, (trace * trace) / 4 - determinant)
  );
  const eigenvalue = trace / 2 + discriminant;
  const axisX = Math.abs(xy) > 1e-9 ? eigenvalue - yy : xx >= yy ? 1 : 0;
  const axisY = Math.abs(xy) > 1e-9 ? xy : xx >= yy ? 0 : 1;
  const length = Math.hypot(axisX, axisY);
  if (length < 1e-9) return { x: 1, y: 0 };
  return { x: axisX / length, y: axisY / length };
}

/** Runs of travel between direction changes, as index ranges. */
function legsAlongAxis(along: readonly number[], hysteresis: number) {
  const legs: Array<{ end: number; start: number }> = [];
  let legStart = 0;
  let direction = 0;
  let extreme = along[0];

  for (let index = 1; index < along.length; index += 1) {
    const value = along[index];
    if (direction === 0) {
      if (Math.abs(value - extreme) >= hysteresis) {
        direction = Math.sign(value - extreme);
        extreme = value;
      }
      continue;
    }
    if (Math.sign(value - extreme) === direction) {
      extreme = value;
      continue;
    }
    // Moving against the run. Only a real retreat ends the leg.
    if (Math.abs(value - extreme) < hysteresis) continue;
    legs.push({ start: legStart, end: index - 1 });
    legStart = index - 1;
    direction = -direction;
    extreme = value;
  }

  legs.push({ start: legStart, end: along.length - 1 });
  return legs;
}

/** Monotone chain, counter-clockwise. */
function convexHull(points: readonly NotebookScribblePoint[]) {
  const sorted = [...points].sort((left, right) =>
    left.x === right.x ? left.y - right.y : left.x - right.x
  );
  const turn = (
    origin: NotebookScribblePoint,
    from: NotebookScribblePoint,
    to: NotebookScribblePoint
  ) =>
    (from.x - origin.x) * (to.y - origin.y) -
    (from.y - origin.y) * (to.x - origin.x);

  const chain = (ordered: NotebookScribblePoint[]) => {
    const side: NotebookScribblePoint[] = [];
    for (const candidate of ordered) {
      while (
        side.length >= 2 &&
        turn(side[side.length - 2], side[side.length - 1], candidate) <= 0
      ) {
        side.pop();
      }
      side.push(candidate);
    }
    side.pop();
    return side;
  };

  return [...chain(sorted), ...chain([...sorted].reverse())];
}

/**
 * Grows a hull outward from its centroid.
 *
 * The band has to cover the ink the scribble was drawn over, and the pen's own
 * width is the honest allowance. Scaling from the centroid is approximate where
 * a true offset would be exact, but the coverage threshold is a proportion of a
 * stroke's length, not a hairline decision.
 */
function grownHull(hull: NotebookScribblePoint[], margin: number) {
  if (hull.length < 3 || margin <= 0) return hull;
  const centroidX = hull.reduce((total, point) => total + point.x, 0) / hull.length;
  const centroidY = hull.reduce((total, point) => total + point.y, 0) / hull.length;

  return hull.map((point) => {
    const dx = point.x - centroidX;
    const dy = point.y - centroidY;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return point;
    return {
      x: point.x + (dx / length) * margin,
      y: point.y + (dy / length) * margin,
    };
  });
}

function boundsOf(points: readonly NotebookScribblePoint[]) {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function detectNotebookScribble(
  rawSamples: readonly NotebookScribbleSample[],
  options: { strokeWidth?: number; viewportScale?: number } = {}
): NotebookScribble | null {
  // Page units per screen pixel, for the thresholds that describe the hand
  // rather than the page.
  const scale =
    Number.isFinite(options.viewportScale) && (options.viewportScale ?? 0) > 0
      ? (options.viewportScale as number)
      : 1;
  const samples = thinned(rawSamples, MIN_SAMPLE_SPACING_ON_SCREEN / scale);
  if (samples.length < MIN_SAMPLES) return null;

  const axis = principalAxis(samples);
  const along = samples.map((sample) => sample.x * axis.x + sample.y * axis.y);
  const majorExtent = Math.max(...along) - Math.min(...along);
  if (majorExtent < MIN_MAJOR_EXTENT_ON_PAGE) return null;

  const across = samples.map((sample) => sample.x * -axis.y + sample.y * axis.x);
  const minorExtent = Math.max(...across) - Math.min(...across);
  if (minorExtent / majorExtent > MAX_BAND_ASPECT) return null;

  const legs = legsAlongAxis(along, REVERSAL_HYSTERESIS_ON_SCREEN / scale);
  const reversals = legs.length - 1;
  if (reversals < MIN_REVERSALS) return null;

  let pathLength = 0;
  for (let index = 1; index < samples.length; index += 1) {
    pathLength += distance(samples[index - 1], samples[index]);
  }
  const bounds = boundsOf(samples);
  const diagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (diagonal < 1e-9 || pathLength / diagonal < MIN_RETRACE_RATIO) return null;

  const elapsed = samples[samples.length - 1].time - samples[0].time;
  if (
    elapsed <= 0 ||
    (pathLength * scale) / elapsed < MIN_MEAN_SPEED_ON_SCREEN_PER_MS
  ) {
    return null;
  }

  // Legs of a scribble lie along the same line. Folded to a quarter turn,
  // because a leg running backwards along the axis is just as parallel.
  const deviations = legs.map((leg) => {
    const from = samples[leg.start];
    const to = samples[leg.end];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return 90;
    const cosine = Math.abs((dx * axis.x + dy * axis.y) / length);
    return (Math.acos(Math.min(1, cosine)) * 180) / Math.PI;
  });
  const meanDeviation =
    deviations.reduce((total, value) => total + value, 0) / deviations.length;
  if (meanDeviation > MAX_LEG_DEVIATION_DEGREES) return null;

  // Consecutive legs must retrace each other. Hatching advances instead, so
  // its legs share little of their extent with the leg before.
  const overlaps: number[] = [];
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1];
    const current = legs[index];
    const previousRange = [along[previous.start], along[previous.end]].sort(
      (left, right) => left - right
    );
    const currentRange = [along[current.start], along[current.end]].sort(
      (left, right) => left - right
    );
    const shared =
      Math.min(previousRange[1], currentRange[1]) -
      Math.max(previousRange[0], currentRange[0]);
    const shorter = Math.min(
      previousRange[1] - previousRange[0],
      currentRange[1] - currentRange[0]
    );
    overlaps.push(shorter < 1e-9 ? 0 : Math.max(0, shared) / shorter);
  }
  const meanOverlap =
    overlaps.reduce((total, value) => total + value, 0) / overlaps.length;
  if (meanOverlap < MIN_LEG_OVERLAP) return null;

  const hull = grownHull(
    convexHull(samples),
    Math.max(0, options.strokeWidth ?? 0) / 2
  );
  if (hull.length < 3) return null;

  return { band: { hull, bounds: boundsOf(hull) }, legs: legs.length, reversals };
}

/**
 * The portion of a segment inside a convex band, as parameters along it.
 *
 * Cyrus-Beck: clip the interval against each edge's outward half-plane.
 */
function clipSegmentToBand(
  from: NotebookScribblePoint,
  to: NotebookScribblePoint,
  hull: readonly NotebookScribblePoint[]
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let entering = 0;
  let leaving = 1;

  for (let index = 0; index < hull.length; index += 1) {
    const edgeFrom = hull[index];
    const edgeTo = hull[(index + 1) % hull.length];
    // Counter-clockwise winding puts the interior on the left of each edge, so
    // the outward normal is the right normal.
    const normalX = edgeTo.y - edgeFrom.y;
    const normalY = -(edgeTo.x - edgeFrom.x);
    const denominator = normalX * dx + normalY * dy;
    const numerator =
      normalX * (from.x - edgeFrom.x) + normalY * (from.y - edgeFrom.y);

    if (Math.abs(denominator) < 1e-12) {
      if (numerator > 0) return null;
      continue;
    }
    const parameter = -numerator / denominator;
    if (denominator < 0) {
      entering = Math.max(entering, parameter);
    } else {
      leaving = Math.min(leaving, parameter);
    }
    if (entering > leaving) return null;
  }

  return { entering, leaving };
}

/**
 * How much of a polyline the scribble actually covers, by length.
 *
 * Whole strokes are deleted, so this is what stops a scribble over one word
 * taking the underline running beneath it as well.
 */
export function getNotebookScribbleCoverage(
  band: NotebookScribbleBand,
  points: readonly NotebookScribblePoint[]
) {
  if (points.length === 0) return 0;
  if (points.length === 1) {
    return clipSegmentToBand(points[0], points[0], band.hull) ? 1 : 0;
  }

  let totalLength = 0;
  let coveredLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = distance(from, to);
    if (length < 1e-12) continue;
    totalLength += length;
    const clipped = clipSegmentToBand(from, to, band.hull);
    if (clipped) coveredLength += (clipped.leaving - clipped.entering) * length;
  }

  if (totalLength < 1e-12) {
    // A stroke with no length at all is a dot: covered if its point is inside.
    return clipSegmentToBand(points[0], points[0], band.hull) ? 1 : 0;
  }
  return coveredLength / totalLength;
}

/** A stroke this thoroughly covered is one the scribble was aimed at. */
export const NOTEBOOK_SCRIBBLE_MIN_COVERAGE = 0.6;
