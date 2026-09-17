import { describe, expect, it } from "vitest";
import {
  angleDelta,
  barrelAzimuth,
  NIB_ANGLE_DEFAULT,
  NIB_ANGLE_DEFAULT_DEGREES,
  nibAngleFromPointer,
  NotebookNibAngleTracker,
} from "@/lib/workspace/notebook-nib-angle";

const DEGREES = Math.PI / 180;

/** The grip a right-handed writer holds: barrel up and to the left. */
const TYPICAL_AZIMUTH = 135 * DEGREES;

function pen(overrides: Record<string, number | string> = {}) {
  return { pointerType: "pen", ...overrides };
}

describe("barrel azimuth", () => {
  it("takes a reported azimuth as it stands", () => {
    expect(barrelAzimuth(pen({ azimuthAngle: TYPICAL_AZIMUTH }))).toBeCloseTo(
      TYPICAL_AZIMUTH,
      10
    );
  });

  it("falls back to tilt when no azimuth is reported", () => {
    // Chrome reports tilt about each axis instead of an azimuth.
    expect(barrelAzimuth(pen({ tiltX: 30, tiltY: 30 }))).toBeCloseTo(
      45 * DEGREES,
      10
    );
  });

  it("converts tilt through its tangents, not its degrees", () => {
    // The two tilts are angles away from vertical, so each contributes its
    // tangent rather than its degrees. Tangent grows faster than its angle, so
    // the steeper axis dominates more than the raw numbers suggest: this lands
    // at 8.4 degrees where reading the tilts as a plain direction vector would
    // say atan2(10, 50) = 11.3. The gap is the skew the conversion removes.
    const azimuth = barrelAzimuth(pen({ tiltX: 50, tiltY: 10 }));
    expect(azimuth).toBeCloseTo(
      Math.atan2(Math.tan(10 * DEGREES), Math.tan(50 * DEGREES)),
      10
    );
    expect(azimuth! / DEGREES).toBeLessThan(11.3);
  });

  it("reports nothing when the pointer carries no orientation at all", () => {
    expect(barrelAzimuth(pen())).toBeNull();
    expect(barrelAzimuth(pen({ azimuthAngle: 0, tiltX: 0, tiltY: 0 }))).toBeNull();
  });
});

describe("nib angle from a pointer", () => {
  it("reproduces the previous fixed edge for a typical grip", () => {
    // The whole feature is continuous with what it replaced: hold the pen the
    // ordinary way and the highlighter draws the angle it always drew.
    const angle = nibAngleFromPointer(pen({ azimuthAngle: TYPICAL_AZIMUTH }));
    expect(angle! / DEGREES).toBeCloseTo(NIB_ANGLE_DEFAULT_DEGREES, 6);
  });

  it("turns the edge with the barrel", () => {
    const upright = nibAngleFromPointer(pen({ azimuthAngle: TYPICAL_AZIMUTH }))!;
    const rotated = nibAngleFromPointer(
      pen({ azimuthAngle: TYPICAL_AZIMUTH + 30 * DEGREES })
    )!;
    expect(angleDelta(upright, rotated) / DEGREES).toBeCloseTo(30, 6);
  });

  it("ignores everything that is not a pen", () => {
    expect(
      nibAngleFromPointer({ pointerType: "mouse", azimuthAngle: TYPICAL_AZIMUTH })
    ).toBeNull();
    expect(
      nibAngleFromPointer({ pointerType: "touch", tiltX: 20, tiltY: 20 })
    ).toBeNull();
  });

  it("declines to read the azimuth of a near-vertical pen", () => {
    // Held upright the barrel projects to a point, so its direction is
    // whatever noise the sensor had. There is no signal to filter here.
    expect(
      nibAngleFromPointer(
        pen({ azimuthAngle: TYPICAL_AZIMUTH, altitudeAngle: 80 * DEGREES })
      )
    ).toBeNull();
  });

  it("still reads a pen leaning at an ordinary writing angle", () => {
    expect(
      nibAngleFromPointer(
        pen({ azimuthAngle: TYPICAL_AZIMUTH, altitudeAngle: 45 * DEGREES })
      )
    ).not.toBeNull();
  });
});

describe("angle delta", () => {
  it("goes the short way round the wrap", () => {
    expect(angleDelta(359 * DEGREES, 1 * DEGREES) / DEGREES).toBeCloseTo(2, 10);
    expect(angleDelta(1 * DEGREES, 359 * DEGREES) / DEGREES).toBeCloseTo(-2, 10);
  });

  it("never returns more than half a turn", () => {
    for (let from = 0; from < 360; from += 17) {
      for (let to = 0; to < 360; to += 23) {
        const delta = angleDelta(from * DEGREES, to * DEGREES);
        expect(Math.abs(delta)).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });
});

describe("nib angle tracker", () => {
  it("starts on the default before anything has been measured", () => {
    const tracker = new NotebookNibAngleTracker();
    expect(tracker.current()).toBeCloseTo(NIB_ANGLE_DEFAULT, 10);
    expect(tracker.hasMeasurement).toBe(false);
  });

  it("stays on the default for a pointer that reports no orientation", () => {
    const tracker = new NotebookNibAngleTracker();
    for (let index = 0; index < 20; index += 1) tracker.observe(pen());
    expect(tracker.current()).toBeCloseTo(NIB_ANGLE_DEFAULT, 10);
    expect(tracker.hasMeasurement).toBe(false);
  });

  it("takes the first real measurement whole", () => {
    // Easing towards it would draw the opening of the stroke at an angle the
    // pen was never held at.
    const tracker = new NotebookNibAngleTracker();
    const target = nibAngleFromPointer(pen({ azimuthAngle: 0.5 }))!;
    tracker.observe(pen({ azimuthAngle: 0.5 }));
    expect(tracker.current()).toBeCloseTo(target, 10);
  });

  it("eases towards later measurements instead of snapping", () => {
    const tracker = new NotebookNibAngleTracker();
    tracker.observe(pen({ azimuthAngle: TYPICAL_AZIMUTH }));
    const start = tracker.current();
    const target = nibAngleFromPointer(
      pen({ azimuthAngle: TYPICAL_AZIMUTH + 40 * DEGREES })
    )!;

    tracker.observe(pen({ azimuthAngle: TYPICAL_AZIMUTH + 40 * DEGREES }));
    const afterOne = tracker.current();
    expect(Math.abs(angleDelta(start, afterOne))).toBeGreaterThan(0);
    expect(Math.abs(angleDelta(afterOne, target))).toBeGreaterThan(
      Math.abs(angleDelta(start, target)) * 0.5
    );

    for (let index = 0; index < 200; index += 1) {
      tracker.observe(pen({ azimuthAngle: TYPICAL_AZIMUTH + 40 * DEGREES }));
    }
    expect(angleDelta(tracker.current(), target) / DEGREES).toBeCloseTo(0, 3);
  });

  it("holds its angle while the pen is too upright to read", () => {
    const tracker = new NotebookNibAngleTracker();
    tracker.observe(pen({ azimuthAngle: TYPICAL_AZIMUTH }));
    const held = tracker.current();

    for (let index = 0; index < 50; index += 1) {
      // Noise of the kind a vertical pen reports, which must not move the edge.
      tracker.observe(
        pen({ azimuthAngle: Math.random() * Math.PI * 2, altitudeAngle: 85 * DEGREES })
      );
    }
    expect(tracker.current()).toBeCloseTo(held, 10);
  });

  it("does not cross the wrap the long way", () => {
    // Just below zero easing towards just above it must travel two degrees,
    // not 358. Averaging the raw numbers would point the edge backwards.
    const tracker = new NotebookNibAngleTracker();
    tracker.observe(pen({ azimuthAngle: 359 * DEGREES }));
    const start = tracker.current();
    tracker.observe(pen({ azimuthAngle: 361 * DEGREES }));
    expect(angleDelta(start, tracker.current())).toBeGreaterThan(0);
    expect(Math.abs(angleDelta(start, tracker.current())) / DEGREES).toBeLessThan(2);
  });

  it("carries grip across strokes and forgets it only on reset", () => {
    const tracker = new NotebookNibAngleTracker();
    for (let index = 0; index < 50; index += 1) {
      tracker.observe(pen({ azimuthAngle: 0.7 }));
    }
    const settled = tracker.current();
    expect(tracker.current()).toBeCloseTo(settled, 10);

    tracker.reset();
    expect(tracker.current()).toBeCloseTo(NIB_ANGLE_DEFAULT, 10);
    expect(tracker.hasMeasurement).toBe(false);
  });
});
