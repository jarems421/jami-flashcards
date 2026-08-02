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
 * Tuned for handwriting speed, which is where writing is actually judged.
 *
 * The cutoff rises with speed, so these two numbers decide how much noise
 * survives at the speed a pen is normally moving. At the previous 4.5/0.3 the
 * cutoff reached 70 Hz by 220 px/s -- ordinary handwriting -- and roughly 70%
 * of the sensor's jitter passed straight through. The filter was only really
 * working while the pen was nearly still, which is exactly when nothing is
 * being written.
 *
 * The cost is lag, bounded near `1 / (2π · beta)`: 0.53px before, 1.77px now.
 * Both are well under a pen width, and the lag only appears at speed, where
 * the eye is following the pen rather than the ink. Raise `beta` if the ink
 * ever feels like it is trailing; lower it if writing still looks noisy.
 */
export const NOTEBOOK_INK_SMOOTHING: NotebookInkSmoothingOptions = {
  minCutoff: 2,
  beta: 0.09,
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
