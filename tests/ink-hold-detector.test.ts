import { describe, expect, it, vi } from "vitest";
import { InkHoldDetector } from "@/lib/ink-dom/hold-detector";
import { InkFakeClock } from "./support/ink-fake-timers";

/** The notebook's hold: 25 px/s, 10 px of drift, one second. */
function detectorAt(clock: InkFakeClock, x = 0, y = 0) {
  const onHold = vi.fn();
  const detector = new InkHoldDetector(x, y, clock.time, onHold, clock.timers);
  return { detector, onHold };
}

describe("the hold detector's timer", () => {
  it("fires after one second even if the pen never moves again", () => {
    const clock = new InkFakeClock();
    const { onHold } = detectorAt(clock);
    clock.advanceTo(999);
    expect(onHold).not.toHaveBeenCalled();
    clock.advanceTo(1000);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("waits a full second from the last movement, not from the pen landing", () => {
    const clock = new InkFakeClock();
    const { detector, onHold } = detectorAt(clock);
    // Writing fast (10 px every 100 ms) until 800 ms.
    for (let t = 100; t <= 800; t += 100) {
      clock.advanceTo(t);
      expect(detector.move(t / 10, 0, t)).toBe(false);
    }
    clock.advanceTo(1799);
    expect(onHold).not.toHaveBeenCalled();
    clock.advanceTo(1800);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("stops when destroyed and holds nothing afterwards", () => {
    const clock = new InkFakeClock();
    const { detector, onHold } = detectorAt(clock);
    expect(clock.pendingCount).toBe(1);
    detector.destroy();
    expect(clock.pendingCount).toBe(0);
    clock.advanceTo(5000);
    expect(onHold).not.toHaveBeenCalled();
    expect(detector.move(50, 50, 5001)).toBe(false);
  });
});

describe("the hold detector's verdict on each move", () => {
  it("says moving until the pen has been still for a full second", () => {
    const clock = new InkFakeClock();
    const { detector } = detectorAt(clock);
    const verdicts: boolean[] = [];
    // Tremor: a fifth of a pixel either way, every 100 ms.
    for (let step = 1; step <= 12; step += 1) {
      const t = step * 100;
      clock.advanceTo(t);
      verdicts.push(detector.move(step % 2 === 0 ? 0 : 0.2, 0, t));
    }
    expect(verdicts.slice(0, 9)).toEqual(Array(9).fill(false));
    expect(verdicts.slice(9)).toEqual([true, true, true]);
  });

  it("starts counting again when the pen drifts past the radius", () => {
    const clock = new InkFakeClock();
    const { detector } = detectorAt(clock);
    clock.advanceTo(100);
    expect(detector.move(0.2, 0, 100)).toBe(false);
    clock.advanceTo(500);
    // 11 px is past the 10 px radius: a new hold begins here.
    expect(detector.move(11, 0, 500)).toBe(false);
    const verdicts: boolean[] = [];
    for (let t = 600; t <= 1700; t += 100) {
      clock.advanceTo(t);
      verdicts.push(detector.move(11, 0, t));
    }
    // The average speed of the jump decays over a few samples, which restart the
    // hold each time; stillness then has to last a second from the last restart.
    expect(verdicts.indexOf(true)).toBeGreaterThan(5);
    expect(verdicts.slice(verdicts.indexOf(true))).not.toContain(false);
    expect(verdicts[verdicts.length - 1]).toBe(true);
  });

  it("does not read samples sharing a timestamp as a burst of speed", () => {
    const clock = new InkFakeClock();
    const { detector } = detectorAt(clock);
    // A duplicate timestamp is treated as a second apart, so half a pixel is
    // half a pixel a second, far under the 25 px/s limit.
    expect(detector.move(0.5, 0, 0)).toBe(false);
    clock.advanceTo(1200);
    expect(detector.move(0.5, 0, 1200)).toBe(true);
  });
});
