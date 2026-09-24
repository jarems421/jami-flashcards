/**
 * The last few samples of a flick, which paper would not have inked.
 *
 * A pen leaving the glass at speed does not stop reporting the moment the
 * writing stops. Its tip is still travelling as it rises, and the digitiser
 * keeps sending positions for the few milliseconds it takes to lose contact --
 * with the pressure falling away to almost nothing. On paper that stretch is
 * where the ink runs out. Here every sample is drawn at the stroke's width, so a
 * quick flick grew a tail past the point the hand meant it to end: the
 * "extension at the end of a flick".
 *
 * So a sample whose pressure has collapsed against the stroke's own is held
 * rather than drawn. If the pressure comes back, it was a dip, and the held
 * samples are drawn in order with nothing lost. If the pen lifts while they are
 * held, they were the lift, and they are dropped.
 *
 * Judged against the stroke's own pressure rather than a fixed level, so a
 * light hand is compared with itself. A pen that reports one pressure throughout
 * -- a mouse, a stylus without pressure -- never falls below its own level and
 * is never held. The hold is short and bounded, so a stroke drawn lightly on
 * purpose is at worst drawn a few milliseconds late, never lost.
 */

export type NotebookLiftOffOptions = {
  /** Below this share of the stroke's settled pressure, a sample may be the lift. */
  fraction: number;
  /** Samples of real pressure a stroke needs before anything is held. */
  settleSamples: number;
  /** The most samples held at once before they are drawn after all. */
  maxHeldSamples: number;
  /** The longest a sample is held, in milliseconds, before it is drawn after all. */
  maxHeldMs: number;
  /** How quickly the settled pressure follows the stroke's, per sample. */
  settleRate: number;
};

/**
 * A lift at writing speed lasts a few milliseconds -- a sample or two at 240Hz.
 * Three samples or 30ms is room for that and no more, so the worst a genuine
 * light passage suffers is a delay shorter than two frames.
 */
export const NOTEBOOK_LIFT_OFF: NotebookLiftOffOptions = {
  fraction: 0.3,
  settleSamples: 4,
  maxHeldSamples: 3,
  maxHeldMs: 30,
  settleRate: 0.25,
};

export class NotebookLiftOffGate<Sample> {
  private settled = 0;
  private seen = 0;
  private held: Sample[] = [];
  private heldSince = 0;

  constructor(
    private readonly pressureOf: (sample: Sample) => number | null | undefined,
    private readonly timeOf: (sample: Sample) => number,
    private readonly options: NotebookLiftOffOptions = NOTEBOOK_LIFT_OFF
  ) {}

  /** The samples to draw now, in order: none while holding. */
  next(sample: Sample): Sample[] {
    const pressure = this.pressureOf(sample);
    if (typeof pressure !== "number" || !Number.isFinite(pressure) || pressure <= 0) {
      return this.release(sample);
    }

    const collapsed =
      this.seen >= this.options.settleSamples &&
      pressure < this.settled * this.options.fraction;
    if (collapsed) {
      if (this.held.length === 0) this.heldSince = this.timeOf(sample);
      this.held.push(sample);
      const tooLong =
        this.held.length > this.options.maxHeldSamples ||
        this.timeOf(sample) - this.heldSince > this.options.maxHeldMs;
      // Held past any lift, so it is simply light writing: draw it after all.
      return tooLong ? this.release() : [];
    }

    this.settled =
      this.seen === 0
        ? pressure
        : this.settled + (pressure - this.settled) * this.options.settleRate;
    this.seen += 1;
    return this.release(sample);
  }

  /** The pen has left the glass: whatever is held was the lift, and is dropped. */
  lift() {
    this.held = [];
  }

  private release(sample?: Sample) {
    const out = sample === undefined ? this.held : [...this.held, sample];
    this.held = [];
    return out;
  }
}
