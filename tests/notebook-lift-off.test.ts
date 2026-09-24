import { describe, expect, it } from "vitest";
import { NotebookLiftOffGate } from "@/lib/workspace/notebook-lift-off";

type Sample = { id: number; pressure: number | null; time: number };

function gate() {
  return new NotebookLiftOffGate<Sample>(
    (sample) => sample.pressure,
    (sample) => sample.time
  );
}

/** A stroke written at a steady 0.5, one sample every 4ms. */
function writing(from: number, count: number, pressure = 0.5): Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    id: from + index,
    pressure,
    time: (from + index) * 4,
  }));
}

describe("the end of a flick", () => {
  it("never draws the samples a pen sends as it leaves the glass", () => {
    const lift = gate();
    const drawn = writing(0, 8).flatMap((sample) => lift.next(sample));
    expect(drawn).toHaveLength(8);
    // Pressure collapses as the tip rises, then the pen is gone.
    expect(lift.next({ id: 8, pressure: 0.06, time: 32 })).toEqual([]);
    expect(lift.next({ id: 9, pressure: 0.03, time: 36 })).toEqual([]);
    lift.lift();
  });

  it("loses nothing when the pressure only dipped", () => {
    const lift = gate();
    writing(0, 8).forEach((sample) => lift.next(sample));
    expect(lift.next({ id: 8, pressure: 0.05, time: 32 })).toEqual([]);
    expect(lift.next({ id: 9, pressure: 0.45, time: 36 }).map((sample) => sample.id)).toEqual([8, 9]);
  });

  it("never holds writing that is merely light", () => {
    const lift = gate();
    writing(0, 8).forEach((sample) => lift.next(sample));
    // Fast, aggressive strokes swing far below their own average without lifting.
    const light = writing(8, 5, 0.12).flatMap((sample) => lift.next(sample));
    expect(light.map((sample) => sample.id)).toEqual([8, 9, 10, 11, 12]);
  });

  it("draws near-zero pressure after a moment rather than holding it", () => {
    const lift = gate();
    writing(0, 8).forEach((sample) => lift.next(sample));
    const faint = writing(8, 4, 0.05).flatMap((sample) => lift.next(sample));
    // Held for at most two samples, then everything held is drawn in order.
    expect(faint.map((sample) => sample.id)).toEqual([8, 9, 10]);
  });

  it("leaves a pen without pressure, and a stroke's landing, alone", () => {
    const mouse = gate();
    const steady = writing(0, 12).flatMap((sample) => mouse.next(sample));
    expect(steady).toHaveLength(12);

    const unknown = gate();
    expect(unknown.next({ id: 0, pressure: null, time: 0 })).toHaveLength(1);

    // A Pencil lands light: nothing is held before the stroke has a pressure of its own.
    const landing = gate();
    expect(landing.next({ id: 0, pressure: 0.05, time: 0 })).toHaveLength(1);
    expect(landing.next({ id: 1, pressure: 0.3, time: 4 })).toHaveLength(1);
  });
});
