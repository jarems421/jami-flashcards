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
 * `beta` was 0.04, which bounded the lag near `1 / (2π · beta)` -- about 4px at
 * the top of a fast stroke -- on the reasoning that the eye is on the pen
 * rather than the ink up there, so the lag is not seen.
 *
 * It is seen, at the one moment it cannot hide: the lift. Trailing ink has to
 * arrive somewhere, and a fast stroke that has been trailing four pixels
 * finishes four pixels after the pen has stopped. That is the report of quick
 * strokes extending past where they were ended, and it is worst on a short
 * flick, where four pixels is a fifth of the whole stroke.
 *
 * How much of that arrives as a *jump* is a separate question, settled in
 * `makePrecisePenInputMapper`: the endpoint is now filtered like every other
 * sample, so the ink stops rather than lurching. But the trailing distance is
 * this constant's to answer, and 4px was too much of it.
 *
 * `beta` cannot simply be run up until the trail is gone, because it is the
 * same knob that decides how much sensor noise survives at writing speed. The
 * two are in real tension. Measured against a 1px alternating wobble at 220px/s
 * -- ordinary writing -- alongside the trail left by a 1500px/s stroke:
 *
 *     beta   surviving wobble   trail at speed
 *     0.04   0.39px             2.87px
 *     0.08   0.48px             1.64px
 *     0.11   0.53px             1.25px
 *     0.25   0.67px             0.59px
 *
 * Half the wobble surviving is where a line starts to read as grainy, and that
 * is the ceiling this sits under rather than a number chosen to fit: 0.08 is as
 * far as `beta` goes without spending the steadiness of the line, and it buys
 * back most of the trail on the way.
 *
 * The rest of the answer is not here. It is that the trail no longer arrives as
 * a jump, which is what made three pixels of it so visible.
 *
 * The slow end is untouched, which is the end that matters for shape: at a
 * crawl the cutoff is still near `minCutoff` and the trail is under half a
 * pixel.
 *
 * Lower `minCutoff` if writing feels dragged; lower `beta` if fast strokes look
 * noisy -- but raise it back if they start reaching past the pen again.
 */
export const NOTEBOOK_INK_SMOOTHING: NotebookInkSmoothingOptions = {
  minCutoff: 9,
  beta: 0.08,
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

  /**
   * Where the ink is now, without taking another step towards anything.
   *
   * This is what the end of a stroke is given. A stroke must not gain any
   * geometry at the lift: whatever is added there is added in one frame, after
   * the pen has left the glass, so it is seen arriving rather than being drawn
   * -- which is the whole of the "ink extends after lifting" complaint. Ending
   * on the point already painted makes that impossible rather than small.
   */
  current(): { x: number; y: number } {
    return { x: this.x, y: this.y };
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
