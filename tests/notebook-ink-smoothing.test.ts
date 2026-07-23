import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_INK_SMOOTHING,
  NotebookInkSmoother,
  type NotebookInkSample,
} from "@/lib/workspace/notebook-ink-smoothing";

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

describe("notebook ink smoothing", () => {
  it("keeps a stationary pointer exactly in place", () => {
    const smoother = new NotebookInkSmoother({ x: 100, y: 200, time: 0 });
    for (let index = 1; index <= 30; index += 1) {
      const filtered = smoother.next({ x: 100, y: 200, time: index * SAMPLE_INTERVAL_MS });
      expect(filtered.x).toBeCloseTo(100, 6);
      expect(filtered.y).toBeCloseTo(200, 6);
    }
  });

  it("attenuates high-frequency jitter around a straight line", () => {
    const smoother = new NotebookInkSmoother({ x: 0, y: 50, time: 0 });
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

  it("stays close to the pen during fast movement", () => {
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 });
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

  it.each([8, 16])(
    "responds quickly at a %dms stylus sample interval",
    (sampleIntervalMs) => {
      const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 });
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

      expect(step - first.x).toBeLessThan(1.25);
      expect(30 * step - latest.x).toBeLessThan(0.75);
    }
  );

  it("smooths slow strokes more strongly than fast strokes", () => {
    const measureFirstStepResponse = (speedPxPerSecond: number) => {
      const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 });
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
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 });
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
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 100 });
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
