import { NOTEBOOK_STRAIGHTEN_HOLD } from "@/lib/workspace/notebook-ink-contact";

/**
 * A pen held still at the end of a stroke.
 *
 * A port of js-draw's `StationaryPenDetector`, with the notebook's own numbers
 * (`NOTEBOOK_STRAIGHTEN_HOLD`) in place of js-draw's, so the new engine decides
 * "held" exactly as the editor does today. It works in screen pixels and
 * milliseconds, on the position the ink was drawn to (the smoothed point) and
 * the event's timestamp.
 *
 * Two quirks of the original are kept, because "held" is a feel the owner has
 * tuned against them:
 *
 * - The timer is only ever armed when none is pending. Movement restarts the
 *   hold's clock (the stationary start moves) but not the timer, which on
 *   firing checks how long the pen has really been still and re-arms for the
 *   rest.
 * - A move within `minTimeSeconds` *milliseconds* of the stationary start
 *   counts as moving: js-draw compares a time in milliseconds with a limit in
 *   seconds. With the notebook's one second that is a move in the first
 *   millisecond after the pen settles, which the hold is not sensitive to.
 */

export type InkTimers = {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  /** The clock event timestamps are on, `performance.now()` by default. */
  now?: () => number;
};

/** The window's timers, for a session that is not given any. */
export function browserInkTimers(): InkTimers {
  return {
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    now: () => performance.now(),
  };
}

export type InkHoldConfig = {
  /** Screen pixels a second, averaged. */
  maxSpeed: number;
  /** Screen pixels the tip may drift over the hold. */
  maxRadius: number;
  minTimeSeconds: number;
};

export class InkHoldDetector {
  private startX: number;
  private startY: number;
  private startTime: number;
  private lastX: number;
  private lastY: number;
  private lastTime: number;
  private averageVelocityX = 0;
  private averageVelocityY = 0;
  private timer: number | null = null;
  private destroyed = false;
  private readonly now: () => number;

  /**
   * `x`, `y` and `time` are where and when the stroke began. The clock starts
   * at once: a pen that never moves again still holds.
   */
  constructor(
    x: number,
    y: number,
    time: number,
    private readonly onHold: () => void,
    private readonly timers: InkTimers,
    private readonly config: InkHoldConfig = NOTEBOOK_STRAIGHTEN_HOLD
  ) {
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
    this.startTime = this.lastTime = time;
    this.now = timers.now ?? (() => performance.now());
    this.arm(this.config.minTimeSeconds * 1000);
  }

  /**
   * Takes the next position of the pen. True when it is being held still, in
   * which case the move is not added to the stroke.
   */
  move(x: number, y: number, time: number): boolean {
    if (this.destroyed) return false;

    const dx = x - this.lastX;
    const dy = y - this.lastY;
    // Duplicate timestamps are given a whole second, as js-draw does: the
    // speed it reports is then near zero rather than infinite.
    let dt = (time - this.lastTime) / 1000;
    if (dt === 0) dt = 1;
    // Slight smoothing of the velocity, so input jitter cannot decide it.
    const perSecond = 1 / dt;
    this.averageVelocityX = this.averageVelocityX * 0.5 + dx * perSecond * 0.5;
    this.averageVelocityY = this.averageVelocityY * 0.5 + dy * perSecond * 0.5;

    const sinceStart = time - this.startTime; // milliseconds
    const fromStartX = x - this.startX;
    const fromStartY = y - this.startY;
    const movedOutOfRadius =
      Math.sqrt(fromStartX * fromStartX + fromStartY * fromStartY) > this.config.maxRadius;
    const speed = Math.sqrt(
      this.averageVelocityX * this.averageVelocityX + this.averageVelocityY * this.averageVelocityY
    );

    if (movedOutOfRadius || speed > this.config.maxSpeed || sinceStart < this.config.minTimeSeconds) {
      this.startX = this.lastX = x;
      this.startY = this.lastY = y;
      this.startTime = this.lastTime = time;
      this.arm(this.config.minTimeSeconds * 1000);
      return false;
    }

    this.lastX = x;
    this.lastY = y;
    this.lastTime = time;
    return this.config.minTimeSeconds * 1000 - sinceStart <= 0;
  }

  destroy() {
    this.destroyed = true;
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private arm(ms: number) {
    if (this.timer !== null) return;
    if (ms <= 0) {
      this.onHold();
      return;
    }
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.destroyed) return;
      const remaining = this.config.minTimeSeconds * 1000 - (this.now() - this.startTime);
      if (remaining <= 0) this.onHold();
      else this.arm(remaining);
    }, ms);
  }
}
