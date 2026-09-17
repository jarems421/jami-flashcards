import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_INK_PREDICTION,
  NotebookInkPredictor,
} from "@/lib/workspace/notebook-ink-prediction";
import {
  NOTEBOOK_INK_SMOOTHING,
  NotebookInkSmoother,
} from "@/lib/workspace/notebook-ink-smoothing";

const STEP = 1 / 240;

/** Runs a predictor at a steady speed until its gate has settled. */
function settled(
  predictor: NotebookInkPredictor,
  velocityX: number,
  velocityY: number,
  cutoffHz: number,
  samples = 400
) {
  let lead = predictor.lead(velocityX, velocityY, cutoffHz, STEP);
  for (let index = 1; index < samples; index += 1) {
    lead = predictor.lead(velocityX, velocityY, cutoffHz, STEP);
  }
  return lead;
}

describe("ink lag correction", () => {
  it("leads along the direction of travel", () => {
    const lead = settled(new NotebookInkPredictor(), 800, 0, 70);
    expect(lead.x).toBeGreaterThan(0);
    expect(lead.y).toBeCloseTo(0, 10);
  });

  it("never exceeds its pixel ceiling, whatever it is handed", () => {
    /*
     * The structural bound. Everything else about this feature is a tuning
     * choice; this is the promise that a wrong correction stays small.
     * Checked against speeds and cutoffs no hand produces, because the point
     * is that nothing can produce a larger lead, not that nothing normally
     * does.
     */
    for (const speed of [50, 500, 5000, 50000, 1e6]) {
      for (const cutoff of [0.01, 1, 9, 100, 1e5]) {
        const predictor = new NotebookInkPredictor();
        const lead = settled(predictor, speed, speed, cutoff);
        expect(
          Math.hypot(lead.x, lead.y),
          `speed ${speed}, cutoff ${cutoff}`
        ).toBeLessThanOrEqual(NOTEBOOK_INK_PREDICTION.maxLeadPx + 1e-9);
      }
    }
  });

  it("never leads further than the lag it is cancelling", () => {
    // What makes this a correction rather than a guess. The lead in seconds is
    // capped at the filter's own lag, so the ink can arrive at the pen and not
    // travel past it.
    const cutoff = 20;
    const lagSeconds = 1 / (2 * Math.PI * cutoff);
    const speed = 600;
    const lead = settled(new NotebookInkPredictor(), speed, 0, cutoff);
    expect(lead.x).toBeLessThanOrEqual(speed * lagSeconds + 1e-9);
  });

  it("holds the ink still below the speed gate", () => {
    // A pen drawn slowly and carefully gets no correction at all: the lag
    // there is a fraction of a pixel and a tangential lead would push the ink
    // off the outside of the curve being drawn.
    const slow = NOTEBOOK_INK_PREDICTION.minLeadSpeed / 2;
    const lead = settled(new NotebookInkPredictor(), slow, 0, 9);
    expect(lead.x).toBe(0);
    expect(lead.y).toBe(0);
  });

  it("does not let a noisy velocity estimate open the gate", () => {
    /*
     * The gate reads a settled speed, not this sample's. A pen genuinely
     * crawling produces velocity estimates that swing well past the threshold
     * on sensor noise alone -- half a pixel between samples at 240Hz is
     * 120px/s of it -- and correcting on those jerks the ink forward exactly
     * when it should be steadiest.
     */
    const predictor = new NotebookInkPredictor();
    const trueSpeed = 60;
    let worst = 0;
    for (let index = 0; index < 600; index += 1) {
      // Alternating noise far larger than the signal, as a crawl produces.
      const noise = index % 2 === 0 ? 200 : -200;
      const lead = predictor.lead(trueSpeed + noise, 0, 9, STEP);
      worst = Math.max(worst, Math.hypot(lead.x, lead.y));
    }
    expect(worst).toBe(0);
  });

  it("withdraws the lead when the pen turns", () => {
    // The corner. Velocity still points the old way for a sample or two, and
    // leading along it would carry ink past a turn the hand made on purpose.
    const predictor = new NotebookInkPredictor();
    const straight = settled(predictor, 900, 0, 80);
    const throughTurn = predictor.lead(0, 900, 80, STEP);

    expect(Math.hypot(straight.x, straight.y)).toBeGreaterThan(0);
    expect(Math.hypot(throughTurn.x, throughTurn.y)).toBeLessThan(
      Math.hypot(straight.x, straight.y) / 4
    );
  });

  it("gives nothing back on a reversal", () => {
    // A complete about-turn must never lead backwards, which would draw ink
    // where the pen has already been.
    const predictor = new NotebookInkPredictor();
    settled(predictor, 900, 0, 80);
    const reversed = predictor.lead(-900, 0, 80, STEP);
    expect(Math.hypot(reversed.x, reversed.y)).toBe(0);
  });

  it("settles at the same speed whatever the sample rate", () => {
    // The gate is filtered against time, not samples, so a 120Hz stylus and a
    // 240Hz Pencil reach the same decision at the same moment.
    const slow = new NotebookInkPredictor();
    const fast = new NotebookInkPredictor();
    for (let elapsed = 0; elapsed < 0.25; elapsed += 1 / 120) {
      slow.lead(700, 0, 70, 1 / 120);
    }
    for (let elapsed = 0; elapsed < 0.25; elapsed += 1 / 240) {
      fast.lead(700, 0, 70, 1 / 240);
    }
    const slowLead = slow.lead(700, 0, 70, 1 / 120);
    const fastLead = fast.lead(700, 0, 70, 1 / 240);
    expect(slowLead.x).toBeCloseTo(fastLead.x, 2);
  });

  it("forgets its heading and its gate on reset", () => {
    const predictor = new NotebookInkPredictor();
    settled(predictor, 900, 0, 80);
    predictor.reset();
    // A gate that had settled open must not carry into the next stroke: the
    // first sample of that stroke has no speed history behind it.
    expect(predictor.lead(900, 0, 80, STEP)).toEqual({ x: 0, y: 0 });
  });
});

describe("the filter with lag correction", () => {
  it("leaves the filter itself untouched", () => {
    /*
     * Correction changes where the ink is drawn and never what the filter
     * keeps, so the filtering is identical with it on or off. If this ever
     * fails, the lead has started feeding back and will compound.
     */
    const samples = Array.from({ length: 60 }, (_, index) => ({
      x: index * 4 + Math.sin(index) * 0.4,
      y: 50 + Math.cos(index * 0.7) * 3,
      time: index * (1000 / 240),
    }));

    const corrected = new NotebookInkSmoother(samples[0]);
    const plain = new NotebookInkSmoother(samples[0], {
      ...NOTEBOOK_INK_SMOOTHING,
      prediction: null,
    });

    for (let index = 1; index < samples.length; index += 1) {
      const led = corrected.next(samples[index]);
      const unled = plain.next(samples[index]);
      // The two differ only by the lead, which is bounded.
      expect(Math.hypot(led.x - unled.x, led.y - unled.y)).toBeLessThanOrEqual(
        NOTEBOOK_INK_PREDICTION.maxLeadPx + 1e-9
      );
    }
  });

  it("ends a stroke on the point it was last drawn to", () => {
    /*
     * The invariant the lift depends on. Before correction, `current` returned
     * the filter's own position and that was the same thing. It is not any
     * more, and returning the filter's position would end every fast stroke a
     * lead behind the ink already on screen -- a backwards tick, which is the
     * "ink jumps at the lift" defect wearing the other sign.
     */
    const smoother = new NotebookInkSmoother({ x: 0, y: 0, time: 0 });
    let last = { x: 0, y: 0 };
    for (let index = 1; index < 40; index += 1) {
      last = smoother.next({ x: index * 12, y: 0, time: index * (1000 / 240) });
    }
    expect(smoother.current()).toEqual(last);
  });

  it("is switched off by one field", () => {
    // The rollback. If this ever feels wrong on a device, `prediction: null`
    // in NOTEBOOK_INK_SMOOTHING restores the previous ink exactly.
    const samples = Array.from({ length: 40 }, (_, index) => ({
      x: index * 20,
      y: 0,
      time: index * (1000 / 240),
    }));
    const plain = new NotebookInkSmoother(samples[0], {
      ...NOTEBOOK_INK_SMOOTHING,
      prediction: null,
    });
    let last = { x: samples[0].x, y: samples[0].y };
    for (let index = 1; index < samples.length; index += 1) {
      last = plain.next(samples[index]);
    }
    // With no correction the emitted point is the filter's own, so the lift
    // still lands exactly where it always did.
    expect(plain.current()).toEqual(last);
  });
});
