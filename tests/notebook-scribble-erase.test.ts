import { describe, expect, it } from "vitest";
import {
  detectNotebookScribble,
  getNotebookScribbleCoverage,
  NOTEBOOK_SCRIBBLE_MIN_COVERAGE,
  type NotebookScribbleSample,
} from "@/lib/workspace/notebook-scribble-erase";

/**
 * Scribble-to-erase deletes work, and it lives on the pen. These are the
 * shapes it must never mistake for a scribble; the last one is the only shape
 * it should act on.
 */

/**
 * Samples a polyline at a fixed speed, which is how a real pen arrives: the
 * gesture's shape and its speed are separate questions.
 */
function trace(
  corners: Array<[number, number]>,
  pixelsPerMs = 2
): NotebookScribbleSample[] {
  const samples: NotebookScribbleSample[] = [];
  let time = 0;
  const step = 2;

  for (let index = 1; index < corners.length; index += 1) {
    const [fromX, fromY] = corners[index - 1];
    const [toX, toY] = corners[index];
    const length = Math.hypot(toX - fromX, toY - fromY);
    const count = Math.max(1, Math.round(length / step));
    for (let sample = index === 1 ? 0 : 1; sample <= count; sample += 1) {
      const t = sample / count;
      samples.push({
        x: fromX + (toX - fromX) * t,
        y: fromY + (toY - fromY) * t,
        time,
      });
      time += (length / count) / pixelsPerMs;
    }
  }
  return samples;
}

/** Back and forth along one band: the gesture itself. */
function scribble(passes = 6, pixelsPerMs = 2) {
  const corners: Array<[number, number]> = [];
  for (let pass = 0; pass < passes; pass += 1) {
    corners.push(pass % 2 === 0 ? [40, 100 + pass * 3] : [180, 100 + pass * 3]);
  }
  return trace(corners, pixelsPerMs);
}

describe("detectNotebookScribble", () => {
  it("recognises a fast back-and-forth scribble", () => {
    const found = detectNotebookScribble(scribble());

    expect(found).not.toBeNull();
    expect(found!.reversals).toBeGreaterThanOrEqual(4);
    expect(found!.band.hull.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["a w", [[40, 60], [55, 120], [70, 60], [85, 120], [100, 60]]],
    ["an m", [[40, 120], [40, 60], [70, 120], [70, 60], [100, 120]]],
    ["a z", [[40, 60], [110, 60], [40, 120], [110, 120]]],
    [
      "a two-pass cross-out",
      [[40, 90], [180, 90], [180, 96], [40, 96]],
    ],
  ])("leaves %s alone", (_label, corners) => {
    expect(
      detectNotebookScribble(trace(corners as Array<[number, number]>))
    ).toBeNull();
  });

  it("leaves shading alone, because its passes advance instead of retracing", () => {
    // Hatching down a block: each pass sits below the last, not over it.
    const corners: Array<[number, number]> = [];
    for (let pass = 0; pass < 10; pass += 1) {
      corners.push(pass % 2 === 0 ? [40, 60 + pass * 9] : [90, 60 + pass * 9]);
    }

    expect(detectNotebookScribble(trace(corners))).toBeNull();
  });

  it("leaves a slow deliberate zig-zag alone", () => {
    expect(detectNotebookScribble(scribble(6, 0.4))).toBeNull();
  });

  it("leaves a scribble too small to be aimed at anything alone", () => {
    const corners: Array<[number, number]> = [];
    for (let pass = 0; pass < 6; pass += 1) {
      corners.push(pass % 2 === 0 ? [40, 60 + pass] : [70, 60 + pass]);
    }

    expect(detectNotebookScribble(trace(corners))).toBeNull();
  });

  it("leaves three legs alone, however fast and however parallel", () => {
    expect(
      detectNotebookScribble(
        trace([[40, 90], [180, 90], [40, 96], [180, 96]], 3)
      )
    ).toBeNull();
  });

  it("leaves a single fast stroke alone", () => {
    expect(detectNotebookScribble(trace([[40, 90], [300, 90]], 3))).toBeNull();
  });

  it("wants nothing to do with a stroke too short to judge", () => {
    expect(detectNotebookScribble([])).toBeNull();
    expect(
      detectNotebookScribble([
        { x: 0, y: 0, time: 0 },
        { x: 40, y: 0, time: 8 },
      ])
    ).toBeNull();
  });

  it("recognises a scribble at any angle, not only a horizontal one", () => {
    // Legs along the diagonal, drifting across it as the hand works down.
    const corners: Array<[number, number]> = [];
    for (let pass = 0; pass < 6; pass += 1) {
      corners.push(
        pass % 2 === 0
          ? [40 - pass * 2, 40 + pass * 2]
          : [140 - pass * 2, 140 + pass * 2]
      );
    }

    expect(detectNotebookScribble(trace(corners))).not.toBeNull();
  });

  it("refuses a gesture with no area, having no band to erase within", () => {
    // Retracing one line exactly. No hand does this, and without a band there
    // is no honest way to say what the gesture covered.
    const corners: Array<[number, number]> = [];
    for (let pass = 0; pass < 6; pass += 1) {
      corners.push(pass % 2 === 0 ? [40, 100] : [180, 100]);
    }

    expect(detectNotebookScribble(trace(corners))).toBeNull();
  });
});

describe("getNotebookScribbleCoverage", () => {
  const band = () => {
    const found = detectNotebookScribble(scribble());
    if (!found) throw new Error("The scribble fixture should be detected.");
    return found.band;
  };

  it("covers a word the scribble was drawn over", () => {
    // A short stroke sitting inside the scribbled band.
    const coverage = getNotebookScribbleCoverage(band(), [
      { x: 60, y: 106 },
      { x: 120, y: 106 },
    ]);

    expect(coverage).toBeGreaterThanOrEqual(NOTEBOOK_SCRIBBLE_MIN_COVERAGE);
  });

  it("spares an underline that only passes beneath the scribble", () => {
    // A long rule crossing the band but mostly outside it.
    const coverage = getNotebookScribbleCoverage(band(), [
      { x: -400, y: 110 },
      { x: 600, y: 110 },
    ]);

    expect(coverage).toBeLessThan(NOTEBOOK_SCRIBBLE_MIN_COVERAGE);
  });

  it("spares a stroke nowhere near the scribble", () => {
    expect(
      getNotebookScribbleCoverage(band(), [
        { x: 40, y: 600 },
        { x: 180, y: 600 },
      ])
    ).toBe(0);
  });

  it("covers a dot inside the band and spares one outside it", () => {
    expect(getNotebookScribbleCoverage(band(), [{ x: 110, y: 108 }])).toBe(1);
    expect(getNotebookScribbleCoverage(band(), [{ x: 110, y: 900 }])).toBe(0);
  });
});
