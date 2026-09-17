import { describe, expect, it } from "vitest";
import {
  buildInkStroke,
  INK_STROKE_SHAPES,
  measureInkPipeline,
  measureInkStroke,
  replayInkStroke,
} from "@/lib/workspace/notebook-ink-latency";
import { NOTEBOOK_INK_SMOOTHING } from "@/lib/workspace/notebook-ink-smoothing";

/** The filter with lag correction switched off, for before-and-after. */
const UNCORRECTED = { ...NOTEBOOK_INK_SMOOTHING, prediction: null };

const shapeNamed = (name: string) => {
  const shape = INK_STROKE_SHAPES.find((candidate) => candidate.name === name);
  if (!shape) throw new Error(`no stroke shape named ${name}`);
  return shape;
};

describe("ink latency harness", () => {
  it("is deterministic", () => {
    // The whole point of the harness is that a difference in the numbers is a
    // difference in the pipeline. That only holds if the input never moves.
    const once = measureInkPipeline({ seed: 7 });
    const twice = measureInkPipeline({ seed: 7 });
    expect(once).toEqual(twice);
  });

  it("separates the noise from the shape", () => {
    // A stroke sampled with no sensor noise has nothing for the filter to
    // remove, so the jitter metric must read exactly zero rather than merely
    // small -- otherwise it is measuring the path's own curvature.
    const clean = buildInkStroke(shapeNamed("writing"), { noisePx: 0 });
    expect(measureInkStroke(clean).survivingJitterPx).toBe(0);
  });

  it("reports more surviving jitter as the sensor gets noisier", () => {
    const quiet = measureInkStroke(
      buildInkStroke(shapeNamed("writing"), { noisePx: 0.25, seed: 3 })
    );
    const noisy = measureInkStroke(
      buildInkStroke(shapeNamed("writing"), { noisePx: 2, seed: 3 })
    );
    expect(noisy.survivingJitterPx).toBeGreaterThan(quiet.survivingJitterPx * 2);
  });

  it("shows lag rising with pen speed", () => {
    // The One Euro filter lets go as the pen speeds up, but not completely:
    // the fast flick is the stroke that trails, which is what the smoothing
    // constants were last tuned around.
    const measured = measureInkPipeline({ sampleRateHz: 240 });
    const flick = measured.find((entry) => entry.stroke === "fast flick")!;
    const crawl = measured.find((entry) => entry.stroke === "slow curve")!;
    expect(flick.meanLagPx).toBeGreaterThan(crawl.meanLagPx);
  });

  it("agrees with the trail the smoothing constants were chosen against", () => {
    // `notebook-ink-smoothing.ts` records 1.64px of trail for a 1500px/s
    // stroke at beta 0.08. The flick is exactly that stroke, and this harness
    // was written long afterwards and independently. If the two ever disagree,
    // one of them has stopped describing the filter.
    // Measured without lag correction, because the figure in that file is
    // about the filter on its own.
    const flick = measureInkStroke(
      buildInkStroke(shapeNamed("fast flick"), { sampleRateHz: 240 }),
      UNCORRECTED
    );
    expect(flick.trailAtLiftPx).toBeGreaterThan(1.4);
    expect(flick.trailAtLiftPx).toBeLessThan(1.9);
  });

  it("holds the uncorrected filter to its measured baseline", () => {
    /*
     * What the filter alone does, at Apple Pencil's rate.
     *
     * Not targets. A floor under accidental regression, and the numbers lag
     * correction is judged against. Bounds are loose enough that only a real
     * shift trips them.
     */
    const baseline: Record<string, { lag: number; trail: number; jitter: number }> = {
      writing: { lag: 0.888, trail: 0.845, jitter: 0.264 },
      "fast flick": { lag: 1.475, trail: 1.671, jitter: 0.36 },
      "sharp corner": { lag: 1.073, trail: 1.173, jitter: 0.291 },
      "slow curve": { lag: 0.561, trail: 0.731, jitter: 0.232 },
    };

    for (const measured of measureInkPipeline({ sampleRateHz: 240 }, UNCORRECTED)) {
      const expected = baseline[measured.stroke];
      expect(expected, `no baseline for ${measured.stroke}`).toBeDefined();
      expect(measured.meanLagPx).toBeCloseTo(expected.lag, 1);
      expect(measured.trailAtLiftPx).toBeCloseTo(expected.trail, 1);
      expect(measured.survivingJitterPx).toBeCloseTo(expected.jitter, 1);
    }
  });

  it("holds what ships today to its measured baseline", () => {
    // The same four strokes with lag correction on, which is what the notebook
    // draws with. Recorded so the next change to either file has something to
    // move away from deliberately rather than by accident.
    const baseline: Record<string, { lag: number; trail: number; jitter: number }> = {
      writing: { lag: 0.74, trail: 0.777, jitter: 0.327 },
      "fast flick": { lag: 0.484, trail: 0.323, jitter: 0.378 },
      "sharp corner": { lag: 0.68, trail: 0.538, jitter: 0.335 },
      "slow curve": { lag: 0.296, trail: 0.402, jitter: 0.299 },
    };

    for (const measured of measureInkPipeline({ sampleRateHz: 240 })) {
      const expected = baseline[measured.stroke];
      expect(expected, `no baseline for ${measured.stroke}`).toBeDefined();
      expect(measured.meanLagPx).toBeCloseTo(expected.lag, 1);
      expect(measured.trailAtLiftPx).toBeCloseTo(expected.trail, 1);
      expect(measured.survivingJitterPx).toBeCloseTo(expected.jitter, 1);
    }
  });

  it("closes the gap to the pen on every measured stroke", () => {
    // The gate this was built under. An earlier version improved the flick and
    // made the slow curve worse, which is the shape of change that feels like
    // an improvement to whoever tested the stroke they were thinking about.
    for (const rate of [120, 240]) {
      const corrected = measureInkPipeline({ sampleRateHz: rate });
      const plain = measureInkPipeline({ sampleRateHz: rate }, UNCORRECTED);

      for (const [index, measured] of corrected.entries()) {
        expect(
          measured.meanLagPx,
          `${measured.stroke} lag at ${rate}Hz`
        ).toBeLessThan(plain[index].meanLagPx);
        expect(
          measured.trailAtLiftPx,
          `${measured.stroke} trail at ${rate}Hz`
        ).toBeLessThan(plain[index].trailAtLiftPx);
      }
    }
  });

  it("buys that without letting the line go grainy", () => {
    // Correction costs jitter -- it amplifies the velocity estimate, noise
    // included -- and half a pixel is where a line starts to read as grainy.
    // That ceiling is the price cap on the whole feature.
    for (const rate of [120, 240]) {
      for (const measured of measureInkPipeline({ sampleRateHz: rate })) {
        expect(
          measured.survivingJitterPx,
          `${measured.stroke} jitter at ${rate}Hz`
        ).toBeLessThan(0.5);
      }
    }
  });

  it("never lurches further from the pen than the filter alone did", () => {
    /*
     * Correction must not overshoot into being its own error. Checked per
     * sample rather than on the average, because an average can hide a lurch.
     *
     * The tolerance is not zero and should not be read as a rounding
     * allowance. Individual samples genuinely do land further from the pen
     * than the plain filter would put them, from two causes, both measured:
     *
     *   - a corner, where the lead carries ink past the turn in the samples
     *     before the turn gate closes. Worst measured with no sensor noise at
     *     all: 0.29px on the sharp corner, 0.06px on writing.
     *   - noise, where the lead multiplies whatever error is in the velocity
     *     estimate. Worst measured at 0.5px of sensor noise: 0.84px.
     *
     * The systematic part of that second cause is what the jitter ceiling
     * above prices, and it stays under half a pixel. This test is for the
     * excursion the average would hide, so the bound is set from the worst
     * measured case with headroom rather than at a number that would look
     * tidier. The hard structural bound -- that a lead can never exceed
     * `maxLeadPx` -- is asserted directly in the prediction tests.
     */
    const lurchCeilingPx = 1;

    for (const shape of INK_STROKE_SHAPES) {
      const stroke = buildInkStroke(shape, { sampleRateHz: 240 });
      const corrected = replayInkStroke(stroke.sampled);
      const plain = replayInkStroke(stroke.sampled, UNCORRECTED);

      for (const [index, point] of corrected.entries()) {
        const truth = stroke.truth[index];
        const correctedGap = Math.hypot(point.x - truth.x, point.y - truth.y);
        const plainGap = Math.hypot(
          plain[index].x - truth.x,
          plain[index].y - truth.y
        );
        expect(
          correctedGap,
          `${shape.name} sample ${index} overshot`
        ).toBeLessThanOrEqual(plainGap + lurchCeilingPx);
      }
    }
  });

  it("keeps ordinary writing under the grainy threshold", () => {
    // Half a pixel of surviving wobble is where a line starts to read as
    // grainy -- the ceiling the smoothing file tunes beta under.
    const writing = measureInkStroke(
      buildInkStroke(shapeNamed("writing"), { sampleRateHz: 240 })
    );
    expect(writing.survivingJitterPx).toBeLessThan(0.5);
  });

  it("shows stronger smoothing trading lag for steadiness", () => {
    // The tension the constants sit in, demonstrated rather than asserted: a
    // lower beta holds the line steadier and drags it further behind the pen.
    const stroke = buildInkStroke(shapeNamed("fast flick"), { sampleRateHz: 240 });
    const tuned = measureInkStroke(stroke, NOTEBOOK_INK_SMOOTHING);
    const heavier = measureInkStroke(stroke, {
      ...NOTEBOOK_INK_SMOOTHING,
      beta: 0.04,
    });
    expect(heavier.trailAtLiftPx).toBeGreaterThan(tuned.trailAtLiftPx);
    expect(heavier.survivingJitterPx).toBeLessThan(tuned.survivingJitterPx);
  });

  it("replays a stroke of one sample without reaching past its end", () => {
    const drawn = replayInkStroke([{ x: 5, y: 9, time: 0 }]);
    expect(drawn).toEqual([{ x: 5, y: 9 }]);
    expect(replayInkStroke([])).toEqual([]);
  });
});
