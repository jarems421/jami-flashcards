// Light input smoothing for notebook pen/highlighter strokes, based on the
// One Euro filter (Casiez et al.): a low-pass filter whose cutoff frequency
// rises with pointer speed. Slow strokes (where hand tremor and sensor noise
// dominate) are smoothed strongly; fast strokes are followed almost exactly,
// so the ink never feels like it is being pulled behind the pen.
//
// Both axes share one cutoff derived from the 2D speed. Filtering each axis
// by its own speed (the textbook formulation) over-smooths whichever axis is
// momentarily slow, which visibly warps curves — a diagonal stroke would lag
// vertically while tracking horizontally.

export type NotebookInkSample = {
  x: number;
  y: number;
  /** Event timestamp in milliseconds (e.g. `PointerEvent.timeStamp`). */
  time: number;
};

export type NotebookInkSmoothingOptions = {
  /** Cutoff frequency (Hz) at zero speed. Lower = stronger smoothing. */
  minCutoff: number;
  /**
   * Cutoff increase per px/s of pointer speed. Bounds the worst-case dynamic
   * lag to roughly `1 / (2π · beta)` pixels at high speed.
   */
  beta: number;
  /**
   * Cutoff (Hz) for the velocity estimate. Higher values make the filter
   * loosen its smoothing sooner after the pen speeds up (less lag at stroke
   * starts) at the cost of a noisier speed estimate.
   */
  derivativeCutoff: number;
};

/**
 * Flat across the speeds handwriting actually uses.
 *
 * The cutoff rises with speed, so `minCutoff` governs the pen when it is
 * moving slowly and `beta` how quickly it lets go as the pen speeds up. The
 * mistake worth remembering is that these are not "less smoothing" and "more
 * smoothing": a pen slows down at precisely the moments that need the most
 * accuracy -- the turn at the top of an 'o', the join between two letters --
 * so a low `minCutoff` clamps down hardest exactly where the shape is being
 * made. At 2 Hz only a sixth of each sample survived down there, and the ink
 * felt magnetic, dragged towards where it had just been.
 *
 * Raising `minCutoff` and dropping `beta` flattens the curve instead of
 * tilting it: about a third of each sample survives when the pen is crawling,
 * near enough to the original feel, while less than half survives at writing
 * speed, where the original let 78% of the sensor's noise straight through.
 *
 * The cost is lag, bounded near `1 / (2π · beta)`, now about 4px at the top of
 * a fast stroke where the eye is on the pen rather than the ink. Lower
 * `minCutoff` if writing feels dragged; lower `beta` if it looks noisy.
 */
export const NOTEBOOK_INK_SMOOTHING: NotebookInkSmoothingOptions = {
  minCutoff: 9,
  beta: 0.04,
  derivativeCutoff: 16,
};

// Duplicate or out-of-order timestamps (common for coalesced pointer samples)
// are clamped so the filter stays finite instead of dividing by zero.
const MIN_DELTA_SECONDS = 1 / 1000;

function lowPassAlpha(cutoffHz: number, deltaSeconds: number) {
  const timeConstant = 1 / (2 * Math.PI * cutoffHz);
  return deltaSeconds / (deltaSeconds + timeConstant);
}

export class NotebookInkSmoother {
  private x: number;
  private y: number;
  // Signed, low-passed velocity components. Keeping the sign lets alternating
  // jitter cancel to ~zero speed (so jitter cannot loosen its own smoothing),
  // while sustained motion accumulates into a real speed estimate.
  private velocityX = 0;
  private velocityY = 0;
  private lastTime: number;
  private hasMoved = false;

  constructor(
    seed: NotebookInkSample,
    private readonly options: NotebookInkSmoothingOptions = NOTEBOOK_INK_SMOOTHING
  ) {
    this.x = seed.x;
    this.y = seed.y;
    this.lastTime = seed.time;
  }

  next(sample: NotebookInkSample): { x: number; y: number } {
    const deltaSeconds = Math.max(
      MIN_DELTA_SECONDS,
      (sample.time - this.lastTime) / 1000
    );
    this.lastTime = Math.max(this.lastTime, sample.time);

    // The first movement of a stroke has no history to be filtered against,
    // and the velocity estimate still reads zero -- which is the filter's
    // strongest smoothing. Left alone that shows up as the ink hanging back at
    // the moment the pen lands, the one place lag is unmistakable. Take it
    // exactly as reported and start the velocity estimate from it.
    if (!this.hasMoved) {
      this.hasMoved = true;
      this.velocityX = (sample.x - this.x) / deltaSeconds;
      this.velocityY = (sample.y - this.y) / deltaSeconds;
      this.x = sample.x;
      this.y = sample.y;
      return { x: this.x, y: this.y };
    }

    const derivativeAlpha = lowPassAlpha(this.options.derivativeCutoff, deltaSeconds);
    this.velocityX += derivativeAlpha * ((sample.x - this.x) / deltaSeconds - this.velocityX);
    this.velocityY += derivativeAlpha * ((sample.y - this.y) / deltaSeconds - this.velocityY);
    const speed = Math.hypot(this.velocityX, this.velocityY);

    const cutoff = this.options.minCutoff + this.options.beta * speed;
    const alpha = lowPassAlpha(cutoff, deltaSeconds);
    this.x += alpha * (sample.x - this.x);
    this.y += alpha * (sample.y - this.y);
    return { x: this.x, y: this.y };
  }
}
