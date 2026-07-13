// Light input smoothing for notebook pen/highlighter strokes, based on the
// One Euro filter (Casiez et al.): a low-pass filter whose cutoff frequency
// rises with pointer speed. Slow strokes (where hand tremor and sensor noise
// dominate) are smoothed strongly; fast strokes are followed almost exactly,
// so the ink never feels like it is being pulled behind the pen.

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
  /** Cutoff (Hz) for the internal speed estimate. */
  derivativeCutoff: number;
};

export const NOTEBOOK_INK_SMOOTHING: NotebookInkSmoothingOptions = {
  minCutoff: 2,
  beta: 0.04,
  derivativeCutoff: 1,
};

// Duplicate or out-of-order timestamps (common for coalesced pointer samples)
// are clamped so the filter stays finite instead of dividing by zero.
const MIN_DELTA_SECONDS = 1 / 1000;

function lowPassAlpha(cutoffHz: number, deltaSeconds: number) {
  const timeConstant = 1 / (2 * Math.PI * cutoffHz);
  return deltaSeconds / (deltaSeconds + timeConstant);
}

class OneEuroAxis {
  private value: number;
  private derivative = 0;

  constructor(
    initialValue: number,
    private readonly options: NotebookInkSmoothingOptions
  ) {
    this.value = initialValue;
  }

  next(rawValue: number, deltaSeconds: number) {
    const derivativeAlpha = lowPassAlpha(this.options.derivativeCutoff, deltaSeconds);
    const rawDerivative = (rawValue - this.value) / deltaSeconds;
    this.derivative += derivativeAlpha * (rawDerivative - this.derivative);

    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(this.derivative);
    const alpha = lowPassAlpha(cutoff, deltaSeconds);
    this.value += alpha * (rawValue - this.value);
    return this.value;
  }
}

export class NotebookInkSmoother {
  private readonly xAxis: OneEuroAxis;
  private readonly yAxis: OneEuroAxis;
  private lastTime: number;

  constructor(seed: NotebookInkSample, options: NotebookInkSmoothingOptions = NOTEBOOK_INK_SMOOTHING) {
    this.xAxis = new OneEuroAxis(seed.x, options);
    this.yAxis = new OneEuroAxis(seed.y, options);
    this.lastTime = seed.time;
  }

  next(sample: NotebookInkSample): { x: number; y: number } {
    const deltaSeconds = Math.max(
      MIN_DELTA_SECONDS,
      (sample.time - this.lastTime) / 1000
    );
    this.lastTime = Math.max(this.lastTime, sample.time);
    return {
      x: this.xAxis.next(sample.x, deltaSeconds),
      y: this.yAxis.next(sample.y, deltaSeconds),
    };
  }
}
