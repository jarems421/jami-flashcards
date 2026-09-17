/**
 * Closing the gap the smoothing opens between the ink and the pen.
 *
 * A low-pass filter necessarily lags what it filters. The notebook's is a One
 * Euro filter, so the lag is small and shrinks as the pen speeds up, but it is
 * there and it is measurable: `notebook-ink-latency.ts` reads it at about
 * 0.9px through ordinary writing and 1.5px through a fast flick.
 *
 * The lag is not arbitrary, though, and that is what this exploits. A
 * single-pole low pass with cutoff `f` lags its input by very close to
 * `1 / (2πf)` seconds. The filter already knows `f` -- it computes it per
 * sample -- and it already tracks the pen's velocity. Lag in seconds times
 * velocity is lag in pixels, as a vector. Stepping the drawn point forward by
 * exactly that cancels it.
 *
 * So this is not a guess about where the pen is going. It is a correction for a
 * delay whose size the filter can state, which is why it can be bounded so
 * tightly: the lead never exceeds the lag it is cancelling, so the ink can
 * arrive at the pen but not overshoot it.
 *
 * ## Why not the browser's prediction
 *
 * `PointerEvent.getPredictedEvents()` exists in Chrome, and Safari does not
 * implement it -- so on iPad, which is where this app expects a Pencil, it
 * returns nothing. It also predicts the *raw* pointer, tremor included, which
 * is the signal the One Euro filter exists to remove.
 *
 * ## Why not a compositor ink trail
 *
 * That was tried and removed, and the reasoning in `notebook-chisel-stroke.ts`
 * is worth not repeating: the Web Ink API trail is drawn to the unfiltered
 * pointer, outside anything this app renders, and it was reported as ink
 * glitching and reaching past the lift.
 *
 * The difference here is that the lead is derived from the filter's own state
 * and bounded by its own lag, rather than racing it.
 */

export type InkPredictionOptions = {
  /**
   * The hard ceiling on how far ahead the ink may be stepped, in seconds.
   *
   * The derived lag is normally well under this; it exists for the case where
   * the cutoff is momentarily low and the velocity estimate momentarily high,
   * which is a corner, not a straight run.
   */
  maxLeadSeconds: number;
  /**
   * The hard ceiling in pixels, whatever the seconds say.
   *
   * The seconds bound scales with speed and this one does not, which is the
   * point: a fast stroke has the most lag to cancel and is also where a wrong
   * prediction travels furthest. This caps the damage in the units the damage
   * is seen in.
   */
  maxLeadPx: number;
  /**
   * How sharply the lead is withdrawn when the pen changes direction.
   *
   * Prediction's one real failure is the corner: velocity still points the way
   * the pen was going, so leading along it carries the ink past the turn and
   * rounds off a shape the hand made deliberately. Direction change is
   * measurable from one sample to the next, and the lead is scaled by the
   * cosine of it raised to this power -- so a straight run keeps its full
   * correction, a gentle curve keeps most of it, and a right angle keeps none.
   *
   * Higher is more cautious.
   */
  turnSensitivity: number;
  /**
   * Below this speed, in px/s, the ink is drawn exactly where the filter puts
   * it, and above `fullLeadSpeed` it gets the whole correction.
   *
   * This is the second failure, and the harness found it rather than the eye:
   * correcting along the velocity works on a straight run and pushes the ink
   * off the outside of a curve, because a tangent leaves an arc immediately.
   * Measured on the slow curve it made the lag *worse*, 0.56px to 0.80px.
   *
   * The turn gate above does not catch this. It compares one sample's heading
   * with the last, and a smooth curve at 240Hz turns by a fraction of a degree
   * between samples -- nearly parallel, so nearly the full lead. A corner is a
   * sudden change of direction; sustained curvature is not.
   *
   * Speed separates the two cases cleanly, and not by coincidence: lag is a
   * velocity times a delay, so the slower the pen, the smaller the error being
   * corrected. At a crawl it is a fraction of a pixel and invisible, which is
   * exactly where the correction has least to win and curvature costs most. A
   * fast stroke is both where the gap is widest and where the path is
   * straightest, because a hand cannot move quickly round a tight curve.
   */
  minLeadSpeed: number;
  fullLeadSpeed: number;
  /**
   * Cutoff (Hz) of the low pass on the speed the gate reads.
   *
   * The gate cannot read the filter's own velocity estimate directly. That
   * estimate carries sensor noise -- half a pixel between samples at 240Hz is
   * 120px/s of it -- so on a slowly drawn curve it crosses any sane threshold
   * on noise alone. The correction then fires because the sensor was noisy
   * rather than because the pen was fast, which is precisely backwards: it
   * jerks the ink forward at the moments it should be holding steadiest.
   * Measured, that put 75% more surviving jitter into the slow curve.
   *
   * So the gate reads a slower average. Lag here is free, because this decides
   * only *whether* to correct, never by how much or in which direction: a few
   * tens of milliseconds late to notice the pen has sped up costs nothing that
   * can be seen, while a gate that rattles costs the steadiness of the line.
   */
  gateSpeedCutoffHz: number;
};

/**
 * Tuned against `scripts/eval/ink-latency.ts`, not by eye.
 *
 * `maxLeadSeconds` of 8ms is about two frames at 240Hz, and above the derived
 * lag through all four measured strokes. `maxLeadPx` of 2 is under the worst
 * lag the harness reports, so the cap can never invent travel the filter had
 * not already lost.
 *
 * `turnSensitivity` of 3 was the lowest value that left the sharp-corner
 * stroke no worse than it started -- the gate this was tuned under, since the
 * corner is the only case where prediction can actively make ink wrong rather
 * than merely late.
 */
export const NOTEBOOK_INK_PREDICTION: InkPredictionOptions = {
  maxLeadSeconds: 0.008,
  minLeadSpeed: 140,
  fullLeadSpeed: 320,
  maxLeadPx: 2,
  turnSensitivity: 3,
  gateSpeedCutoffHz: 4,
};

export type InkLead = { x: number; y: number };

const NO_LEAD: InkLead = { x: 0, y: 0 };

/**
 * How far ahead of the filtered point the ink should be drawn.
 *
 * Stateful only in that it remembers which way the pen was last going, which
 * is what makes the corner detectable at all.
 */
export class NotebookInkPredictor {
  private lastDirectionX = 0;
  private lastDirectionY = 0;
  private hasDirection = false;
  /** The settled speed the gate reads, px/s. */
  private gateSpeed = 0;

  constructor(
    private readonly options: InkPredictionOptions = NOTEBOOK_INK_PREDICTION
  ) {}

  /**
   * @param velocityX Low-passed velocity, px/s, as the filter estimates it.
   * @param cutoffHz The cutoff the filter used for this sample.
   * @param deltaSeconds Interval since the previous sample. The gate is
   *   filtered against real time rather than per sample so that a 120Hz stylus
   *   and a 240Hz Pencil settle at the same rate.
   */
  lead(
    velocityX: number,
    velocityY: number,
    cutoffHz: number,
    deltaSeconds: number
  ): InkLead {
    const speed = Math.hypot(velocityX, velocityY);
    if (speed <= 0 || cutoffHz <= 0) return NO_LEAD;

    const gateTimeConstant = 1 / (2 * Math.PI * this.options.gateSpeedCutoffHz);
    const gateAlpha = deltaSeconds / (deltaSeconds + gateTimeConstant);
    this.gateSpeed += gateAlpha * (speed - this.gateSpeed);

    const { minLeadSpeed, fullLeadSpeed } = this.options;
    const ramp =
      fullLeadSpeed <= minLeadSpeed
        ? 1
        : Math.min(
            1,
            Math.max(
              0,
              (this.gateSpeed - minLeadSpeed) / (fullLeadSpeed - minLeadSpeed)
            )
          );
    if (ramp <= 0) {
      // Still worth recording the heading: the turn gate needs a previous
      // direction, and a stroke that starts slowly and speeds up should not
      // get its first fast sample treated as though it came from nowhere.
      this.lastDirectionX = velocityX / speed;
      this.lastDirectionY = velocityY / speed;
      this.hasDirection = true;
      return NO_LEAD;
    }

    const directionX = velocityX / speed;
    const directionY = velocityY / speed;

    // How much of the previous heading survives. A reversal gives -1, which
    // clamps to zero: the ink is held rather than led backwards.
    let straightness = 1;
    if (this.hasDirection) {
      const alignment =
        directionX * this.lastDirectionX + directionY * this.lastDirectionY;
      straightness = Math.max(0, alignment) ** this.options.turnSensitivity;
    }
    this.lastDirectionX = directionX;
    this.lastDirectionY = directionY;
    this.hasDirection = true;

    // The lag of a single-pole low pass, in seconds.
    const lagSeconds = 1 / (2 * Math.PI * cutoffHz);
    const leadSeconds =
      Math.min(lagSeconds, this.options.maxLeadSeconds) * straightness * ramp;

    const leadX = velocityX * leadSeconds;
    const leadY = velocityY * leadSeconds;
    const leadDistance = Math.hypot(leadX, leadY);
    if (leadDistance <= this.options.maxLeadPx) return { x: leadX, y: leadY };

    const scale = this.options.maxLeadPx / leadDistance;
    return { x: leadX * scale, y: leadY * scale };
  }

  reset() {
    this.gateSpeed = 0;
    this.lastDirectionX = 0;
    this.lastDirectionY = 0;
    this.hasDirection = false;
  }
}
