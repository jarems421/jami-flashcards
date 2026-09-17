/**
 * What the ink pipeline costs, measured rather than felt.
 *
 * Every constant in `notebook-ink-smoothing.ts` was chosen against numbers --
 * the beta table in that file is real work -- but the numbers were produced
 * once, by hand, and thrown away. Nothing since has been able to say whether a
 * change made the ink better or worse, which is the position anyone arrives at
 * who wants to add prediction: it is a change whose entire purpose is latency,
 * and there was no latency to compare it against.
 *
 * So this replays strokes shaped like handwriting through the real filter and
 * reports four numbers. It is deterministic: same stroke, same seed, same
 * result, so a difference in the output is a difference in the pipeline.
 *
 * **What it does not measure.** The browser's own latency -- the time from the
 * glass to a `pointerevent`, and from a paint call to a lit pixel -- is most of
 * what a hand actually feels, and none of it is visible from here. This
 * measures the part Jami owns and can change. A device is still the judge of
 * whether a stroke feels right; this is how a change stops being a guess before
 * it gets to the device.
 */

import {
  NOTEBOOK_INK_SMOOTHING,
  NotebookInkSmoother,
  type NotebookInkSample,
  type NotebookInkSmoothingOptions,
} from "@/lib/workspace/notebook-ink-smoothing";

export type InkPoint = { x: number; y: number };

export type InkStroke = {
  name: string;
  /** Where the pen truly was, before any sensor noise. */
  truth: (NotebookInkSample & InkPoint)[];
  /** What the sensor reported, which is what the filter is fed. */
  sampled: NotebookInkSample[];
};

export type InkLatencyMetrics = {
  stroke: string;
  samples: number;
  /**
   * Mean distance, in pixels, between the ink and where the pen actually was.
   *
   * The headline number. This is the gap a hand reads as the ink being dragged
   * behind the nib, and the gap prediction exists to close.
   */
  meanLagPx: number;
  /** The worst that gap gets, which is where the eye catches it. */
  worstLagPx: number;
  /**
   * How far the finished stroke stops short of where the pen left the glass.
   *
   * Signed the way it is felt: positive means the ink ended behind the pen.
   * The smoothing holds its filter at the lift deliberately, so some of this is
   * bought, not lost -- see the note in `makePrecisePenInputMapper`. It is here
   * because the amount matters even when the direction is intended.
   */
  trailAtLiftPx: number;
  /**
   * How much sensor noise survives into the drawn line, in pixels RMS.
   *
   * Measured by running the same true path twice, once with noise and once
   * without, and comparing the two outputs. What the noise did is then exactly
   * the difference between them, with the path's own shape cancelled out.
   *
   * This is the number that stops lag being optimised for on its own: every
   * knob that reduces lag raises this, and a grainy line is the cost.
   */
  survivingJitterPx: number;
};

/** A small deterministic PRNG, so a measurement can be repeated exactly. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

export type InkStrokeShape = {
  name: string;
  /** Where the pen is at a given moment, in seconds from the touch down. */
  at: (seconds: number) => InkPoint;
  durationSeconds: number;
};

/**
 * Strokes shaped like the ones that go wrong.
 *
 * Not a sampling of handwriting -- a set of the cases the filter is in tension
 * over. Ordinary writing is where noise must not survive; a flick is where lag
 * shows at the lift; a corner is where over-smoothing rounds off a shape the
 * hand made on purpose; a crawl is where the filter clamps down hardest.
 */
export const INK_STROKE_SHAPES: InkStrokeShape[] = [
  {
    // Cursive at an ordinary pace: about 220 px/s, the speed the smoothing
    // constants were tuned against.
    name: "writing",
    durationSeconds: 1.2,
    at: (seconds) => ({
      x: seconds * 180,
      y: 100 + Math.sin(seconds * 18) * 14,
    }),
  },
  {
    // A short, fast flick -- a cross bar, an underline. Ends abruptly, which is
    // where trailing ink is most visible because it is a large share of a small
    // stroke.
    name: "fast flick",
    durationSeconds: 0.18,
    at: (seconds) => ({ x: seconds * 1500, y: 100 }),
  },
  {
    // A deliberate right angle. The turn is instant; anything that rounds it
    // is the filter, not the hand.
    name: "sharp corner",
    durationSeconds: 0.6,
    at: (seconds) =>
      seconds < 0.3
        ? { x: 100 + seconds * 400, y: 100 }
        : { x: 220, y: 100 + (seconds - 0.3) * 400 },
  },
  {
    // Drawing slowly and carefully, where the cutoff sits near its floor and
    // the filter has its strongest hold on the line.
    name: "slow curve",
    durationSeconds: 1.5,
    at: (seconds) => ({
      x: 100 + Math.cos(seconds * 1.6) * 60,
      y: 100 + Math.sin(seconds * 1.6) * 60,
    }),
  },
];

export type InkStrokeOptions = {
  /** Reports per second. Apple Pencil runs near 240; most styluses near 120. */
  sampleRateHz?: number;
  /** Peak sensor noise in pixels, applied per axis. */
  noisePx?: number;
  seed?: number;
};

export function buildInkStroke(
  shape: InkStrokeShape,
  options: InkStrokeOptions = {}
): InkStroke {
  const sampleRateHz = options.sampleRateHz ?? 240;
  const noisePx = options.noisePx ?? 0.5;
  const random = seededRandom(options.seed ?? 1);

  const step = 1 / sampleRateHz;
  const truth: (NotebookInkSample & InkPoint)[] = [];
  const sampled: NotebookInkSample[] = [];

  for (let seconds = 0; seconds <= shape.durationSeconds; seconds += step) {
    const point = shape.at(seconds);
    const time = seconds * 1000;
    truth.push({ ...point, time });
    sampled.push({
      x: point.x + (random() * 2 - 1) * noisePx,
      y: point.y + (random() * 2 - 1) * noisePx,
      time,
    });
  }

  return { name: shape.name, truth, sampled };
}

/** Runs one stroke through the real filter and returns what it drew. */
export function replayInkStroke(
  samples: readonly NotebookInkSample[],
  smoothing: NotebookInkSmoothingOptions = NOTEBOOK_INK_SMOOTHING
): InkPoint[] {
  if (samples.length === 0) return [];
  const smoother = new NotebookInkSmoother(samples[0], smoothing);
  const drawn: InkPoint[] = [{ x: samples[0].x, y: samples[0].y }];
  for (let index = 1; index < samples.length; index += 1) {
    drawn.push(smoother.next(samples[index]));
  }
  return drawn;
}

function distance(a: InkPoint, b: InkPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function measureInkStroke(
  stroke: InkStroke,
  smoothing: NotebookInkSmoothingOptions = NOTEBOOK_INK_SMOOTHING
): InkLatencyMetrics {
  const drawn = replayInkStroke(stroke.sampled, smoothing);
  // The same path with the noise taken out. Comparing the two outputs is what
  // isolates the noise from the shape.
  const clean = replayInkStroke(
    stroke.truth.map((point) => ({ x: point.x, y: point.y, time: point.time })),
    smoothing
  );

  let lagTotal = 0;
  let worstLag = 0;
  let jitterSquares = 0;

  for (let index = 0; index < drawn.length; index += 1) {
    const lag = distance(drawn[index], stroke.truth[index]);
    lagTotal += lag;
    worstLag = Math.max(worstLag, lag);
    jitterSquares += distance(drawn[index], clean[index]) ** 2;
  }

  return {
    stroke: stroke.name,
    samples: drawn.length,
    meanLagPx: lagTotal / drawn.length,
    worstLagPx: worstLag,
    trailAtLiftPx: distance(
      drawn[drawn.length - 1],
      stroke.truth[stroke.truth.length - 1]
    ),
    survivingJitterPx: Math.sqrt(jitterSquares / drawn.length),
  };
}

/** Every shape, measured under one set of conditions. */
export function measureInkPipeline(
  options: InkStrokeOptions = {},
  smoothing: NotebookInkSmoothingOptions = NOTEBOOK_INK_SMOOTHING
): InkLatencyMetrics[] {
  return INK_STROKE_SHAPES.map((shape) =>
    measureInkStroke(buildInkStroke(shape, options), smoothing)
  );
}
