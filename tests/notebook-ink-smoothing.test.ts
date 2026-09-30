import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_INK_SMOOTHING,
  NotebookInkSmoother,
  type NotebookInkSample,
} from "@/lib/workspace/notebook-ink-smoothing";
import { NOTEBOOK_INK_PREDICTION } from "@/lib/workspace/notebook-ink-prediction";

const SAMPLE_INTERVAL_MS = 8; // ~120Hz stylus input

function makeSamples(
  points: Array<{ x: number; y: number }>,
  startTime = 0
): NotebookInkSample[] {
  return points.map((point, index) => ({
    ...point,
    time: startTime + index * SAMPLE_INTERVAL_MS,
  }));
}

/**
 * The filter with lag correction switched off.
 *
 * The tests below measure what the low pass itself does -- how much wobble it
 * removes, how far behind the pen it sits -- and those are properties of the
 * filter rather than of the ink. Lag correction is a separate stage that moves
 * where the result is drawn without changing any of the filtering, and it has
 * its own tests in `notebook-ink-prediction.test.ts`. Measuring it here would
 * only make these numbers describe two things at once.
 */
const FILTER_ONLY = { ...NOTEBOOK_INK_SMOOTHING, prediction: null };

describe("notebook ink smoothing", () => {
  it("keeps a stationary pointer exactly in place", () => {
    const smoother = new NotebookInkSmoother({ x: 100, y: 200, time: 0 }, FILTER_ONLY);
    for (let index = 1; index <= 30; index += 1) {
      const filtered = smoother.next({ x: 100, y: 200, time: index * SAMPLE_INTERVAL_MS });
      expect(filtered.x).toBeCloseTo(100, 6);
      expect(filtered.y).toBeCloseTo(200, 6);
    }
  });

  it("attenuates high-frequency jitter around a straight line", () => {
    const smoother = new NotebookInkSmoother({ x: 0, y: 50, time: 0 }, FILTER_ONLY);
    // Slow horizontal stroke (25 px/s) with ±1px alternating vertical noise.
    const samples = makeSamples(
      Array.from({ length: 120 }, (_, index) => ({
        x: (index + 1) * 0.2,
        y: 50 + (index % 2 === 0 ? 1 : -1),
      }))
    );

    let maxFilteredDeviation = 0;
    samples.forEach((sample, index) => {
      const filtered = smoother.next(sample);
      if (index >= 20) {
        maxFilteredDeviation = Math.max(maxFilteredDeviation, Math.abs(filtered.y - 50));
      }
    });

    // Raw deviation is 1px; the filtered line should be markedly calmer.
    expect(maxFilteredDeviation).toBeLessThan(0.45);
  });

  it("attenuates jitter at handwriting speed, not only when barely moving", () => {
    // The test above uses a 25 px/s stroke, which is the one regime where the
    // filter was already doing its job. Ordinary handwriting is nearer 220
    // px/s, and the cutoff rises with speed -- so this is the case that
    // decides whether writing looks clean.
    const smoother = new NotebookInkSmoother({ x: 0, y: 50, time: 0 }, FILTER_ONLY);
    const perSampleStep = (220 * SAMPLE_INTERVAL_MS) / 1000;
    const samples = makeSamples(
      Array.from({ length: 120 }, (_, index) => ({
        x: (index + 1) * perSampleStep,
        y: 50 + (index % 2 === 0 ? 1 : -1),
      }))
    );

    let maxFilteredDeviation = 0;
    samples.forEach((sample, index) => {
      const filtered = smoother.next(sample);
      if (index >= 20) {
        maxFilteredDeviation = Math.max(
          maxFilteredDeviation,
          Math.abs(filtered.y - 50)
        );
      }
    });

    // Raw deviation is 1px. Half of it surviving is what reads as a jittery
    // line at writing speed.
    expect(maxFilteredDeviation).toBeLessThan(0.5);
  });

  it("stays close to the pen during fast movement", () => {
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 }, FILTER_ONLY);
    // 1500 px/s — a fast handwriting stroke.
    const perSampleStep = (1500 * SAMPLE_INTERVAL_MS) / 1000;
    const samples = makeSamples(
      Array.from({ length: 60 }, (_, index) => ({
        x: (index + 1) * perSampleStep,
        y: 0,
      }))
    );

    let lag = Number.POSITIVE_INFINITY;
    let raw = 0;
    for (const sample of samples) {
      raw = sample.x;
      lag = raw - smoother.next(sample).x;
    }

    // Steady-state lag is bounded near 1 / (2π·beta) regardless of speed.
    const maxExpectedLag = 1 / (2 * Math.PI * NOTEBOOK_INK_SMOOTHING.beta) + 1;
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThan(maxExpectedLag);
  });

  it("draws the ink at the pen once lag correction is on", () => {
    /*
     * The same fast stroke with lag correction on, which the notebook no
     * longer ships but which is kept measurable.
     *
     * The test above asserts the filter sits *behind* the pen, which was the
     * whole truth before correction existed. It is not any more: correction
     * closes that gap deliberately, so the ink can sit fractionally either
     * side of the pen rather than always behind it. What still has to hold is
     * that it stays close, and that it cannot run away -- the lead is capped
     * at `maxLeadPx`, so overshoot is bounded by construction rather than by
     * tuning.
     */
    const smoother = new NotebookInkSmoother(
      { x: 0, y: 0, time: 0 },
      { ...NOTEBOOK_INK_SMOOTHING, prediction: NOTEBOOK_INK_PREDICTION }
    );
    const perSampleStep = (1500 * SAMPLE_INTERVAL_MS) / 1000;
    const samples = makeSamples(
      Array.from({ length: 60 }, (_, index) => ({
        x: (index + 1) * perSampleStep,
        y: 0,
      }))
    );

    let gap = Number.POSITIVE_INFINITY;
    for (const sample of samples) {
      gap = sample.x - smoother.next(sample).x;
    }

    const uncorrected = new NotebookInkSmoother(
      { x: 0, y: 0, time: 0 },
      FILTER_ONLY
    );
    let plainLag = Number.POSITIVE_INFINITY;
    for (const sample of samples) {
      plainLag = sample.x - uncorrected.next(sample).x;
    }

    // Closer to the pen than the filter alone manages, and never past it by
    // more than the lead is allowed to be.
    expect(Math.abs(gap)).toBeLessThan(plainLag);
    expect(gap).toBeGreaterThan(-NOTEBOOK_INK_PREDICTION.maxLeadPx);
  });

  /**
   * How far the ink is trailing when the pen lifts is how far it has left to
   * travel after the stroke has been ended, which is what reads as ink
   * extending past the pen. `makePrecisePenInputMapper` stops that arriving as
   * a jump by filtering the endpoint too, but the distance itself is this
   * filter's to keep small -- and quick strokes are where it is largest.
   */
  it.each([
    ["a short flick", 12],
    ["a full stroke", 60],
  ])("trails %s by well under the old four pixels", (_name, sampleCount) => {
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 }, FILTER_ONLY);
    // 1500 px/s — a fast handwriting stroke, where the trail is largest.
    const perSampleStep = (1500 * SAMPLE_INTERVAL_MS) / 1000;
    const samples = makeSamples(
      Array.from({ length: sampleCount }, (_, index) => ({
        x: (index + 1) * perSampleStep,
        y: 0,
      }))
    );

    let trailingBy = 0;
    for (const sample of samples) {
      trailingBy = sample.x - smoother.next(sample).x;
    }

    // Derived from the constant that actually governs it, so the bound cannot
    // drift away from `beta` if it is ever retuned.
    expect(trailingBy).toBeLessThan(
      1 / (2 * Math.PI * NOTEBOOK_INK_SMOOTHING.beta)
    );
  });

  it("holds its position when asked, so a lift adds no ink", () => {
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 }, FILTER_ONLY);
    let latest = { x: 0, y: 0 };
    for (let step = 1; step <= 20; step += 1) {
      latest = smoother.next({ x: step * 12, y: step * 3, time: step * 8 });
    }

    // The same point the stroke was last drawn to, and unmoved by asking.
    expect(smoother.current()).toEqual(latest);
    expect(smoother.current()).toEqual(latest);
  });

  it.each([8, 16])(
    "responds quickly at a %dms stylus sample interval",
    (sampleIntervalMs) => {
      const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 }, FILTER_ONLY);
      const step = (1500 * sampleIntervalMs) / 1000;
      const first = smoother.next({ x: step, y: 0, time: sampleIntervalMs });
      let latest = first;
      for (let index = 2; index <= 30; index += 1) {
        latest = smoother.next({
          x: index * step,
          y: 0,
          time: index * sampleIntervalMs,
        });
      }

      // The first movement is taken exactly as reported: there is nothing to
      // filter it against, and lag is most obvious where the pen lands.
      expect(step - first.x).toBe(0);
      // Steady-state lag is the price of the smoothing, and beta is what sets
      // it. Derived rather than hardcoded so the bound cannot quietly drift
      // away from the constant that actually governs it.
      expect(30 * step - latest.x).toBeLessThan(
        1 / (2 * Math.PI * NOTEBOOK_INK_SMOOTHING.beta)
      );
    }
  );

  it("smooths slow strokes more strongly than fast strokes", () => {
    const measureFirstStepResponse = (speedPxPerSecond: number) => {
      const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 }, FILTER_ONLY);
      const step = (speedPxPerSecond * SAMPLE_INTERVAL_MS) / 1000;
      let filtered = { x: 0, y: 0 };
      let raw = 0;
      // Let the speed estimate settle, then measure how closely the filter
      // tracks one further step.
      for (let index = 1; index <= 40; index += 1) {
        raw = index * step;
        filtered = smoother.next({ x: raw, y: 0, time: index * SAMPLE_INTERVAL_MS });
      }
      return (raw - filtered.x) / step; // lag measured in steps
    };

    const slowLagInSteps = measureFirstStepResponse(30);
    const fastLagInSteps = measureFirstStepResponse(2000);
    expect(fastLagInSteps).toBeLessThan(slowLagInSteps);
  });

  it("does not warp diagonal strokes (isotropic smoothing)", () => {
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 }, FILTER_ONLY);
    // Constant-velocity diagonal stroke along y = x.
    const samples = makeSamples(
      Array.from({ length: 60 }, (_, index) => ({
        x: (index + 1) * 2,
        y: (index + 1) * 2,
      }))
    );

    for (const sample of samples) {
      const filtered = smoother.next(sample);
      // Both axes must lag by the same amount, keeping the point on the line.
      expect(Math.abs(filtered.y - filtered.x)).toBeLessThan(1e-9);
    }
  });

  it("survives duplicate and out-of-order timestamps", () => {
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 100 }, FILTER_ONLY);
    const samples: NotebookInkSample[] = [
      { x: 1, y: 1, time: 100 },
      { x: 2, y: 2, time: 100 },
      { x: 3, y: 3, time: 90 },
      { x: 4, y: 4, time: 108 },
    ];
    for (const sample of samples) {
      const filtered = smoother.next(sample);
      expect(Number.isFinite(filtered.x)).toBe(true);
      expect(Number.isFinite(filtered.y)).toBe(true);
    }
  });
});

describe("samples that share a timestamp", () => {
  /*
   * Batched pointer samples can arrive with one timestamp between them. Read as
   * a millisecond apart, an ordinary step looked like a burst of speed and that
   * one sample escaped the smoothing its neighbours got -- lumps along a loop.
   * Unfixed, a fast circle with every other timestamp shared came out at 8.8
   * radians of heading reversal; fixed, 0.01, the same as clean timestamps.
   */
  it("keeps a fast loop round", () => {
    const roughness = (shared: boolean) => {
      const smoother = new NotebookInkSmoother({ x: 100, y: 0, time: 0 });
      let total = 0;
      let previousTurn = 0;
      let a = { x: 100, y: 0 };
      let b = { x: 100, y: 0 };
      for (let index = 1; index <= 240; index += 1) {
        const at = index * 4.17;
        const time = shared && index % 2 === 1 ? at + 4.17 : at;
        // Four loops a second at radius 100: about 2500px/s.
        const angle = (at / 1000) * 2 * Math.PI * 4;
        const out = smoother.next({ x: 100 * Math.cos(angle), y: 100 * Math.sin(angle), time });
        const turn = Math.atan2(
          (b.x - a.x) * (out.y - b.y) - (b.y - a.y) * (out.x - b.x),
          (b.x - a.x) * (out.x - b.x) + (b.y - a.y) * (out.y - b.y)
        );
        if (index > 20) total += Math.abs(turn - previousTurn);
        previousTurn = turn;
        a = b;
        b = out;
      }
      return total;
    };
    expect(roughness(true)).toBeLessThan(0.5);
  });
});
