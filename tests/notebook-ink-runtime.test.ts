import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_STRAIGHTEN_HOLD,
  relaxNotebookStraightenHold,
} from "@/lib/workspace/notebook-ink-runtime";

/**
 * The hold that snaps a line straight has to be one a hand can satisfy.
 *
 * js-draw wants an average speed under 8.5 screen pixels a second, which is
 * under a seventh of a pixel per frame and below what a hand resting a stylus
 * on glass does. Every time the tremor crosses it the timer restarts, so the
 * snap arrives late or never -- and it reads as "hold it for longer" rather
 * than as a threshold nobody can meet.
 */
describe("relaxNotebookStraightenHold", () => {
  it("gives the detector a threshold a resting hand can meet", () => {
    expect(NOTEBOOK_STRAIGHTEN_HOLD.maxSpeed).toBeGreaterThan(8.5);
    // Longer than js-draw's half second, on purpose: half a second of
    // stillness happens in the middle of ordinary writing, and it is the pause
    // that is being asked about rather than the shape of the stroke.
    expect(NOTEBOOK_STRAIGHTEN_HOLD.minTimeSeconds).toBeGreaterThanOrEqual(0.75);
    expect(NOTEBOOK_STRAIGHTEN_HOLD.minTimeSeconds).toBeLessThanOrEqual(2);
  });

  it("replaces the config once the stroke has begun", () => {
    const detector = { config: { maxSpeed: 8.5, maxRadius: 11, minTimeSeconds: 0.5 } };
    const pen = {
      stationaryDetector: null as typeof detector | null,
      onPointerDown() {
        this.stationaryDetector = detector;
        return true;
      },
    };

    expect(relaxNotebookStraightenHold(pen)).toBe(true);
    expect(pen.onPointerDown()).toBe(true);
    expect(pen.stationaryDetector!.config.maxSpeed).toBe(
      NOTEBOOK_STRAIGHTEN_HOLD.maxSpeed
    );
    expect(pen.stationaryDetector!.config.minTimeSeconds).toBe(
      NOTEBOOK_STRAIGHTEN_HOLD.minTimeSeconds
    );
  });

  it("says so rather than throwing when js-draw has moved on", () => {
    // A patch on somebody else's internals should fail loudly at the seam, not
    // silently leave the hold unreachable.
    expect(relaxNotebookStraightenHold({})).toBe(false);
  });

  it("leaves a stroke that never starts one alone", () => {
    const pen = { stationaryDetector: null, onPointerDown: () => undefined };
    expect(relaxNotebookStraightenHold(pen)).toBe(true);
    expect(() => pen.onPointerDown()).not.toThrow();
  });
});
