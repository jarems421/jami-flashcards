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

/**
 * A scribble-out as a hand actually makes it: overshooting ends, a band that
 * drifts as it goes, wobble on every sample, and a speed in the range people
 * really scribble at.
 *
 * The first cut of this detector was tuned against tidy fixtures and rejected
 * essentially every real gesture -- four passes rather than five, 0.7 screen
 * pixels per millisecond rather than 1.2. These are the shapes that matter.
 */
function handScribble(input: {
  bandHeight?: number;
  durationMs?: number;
  passes?: number;
  seed?: number;
  wordWidth?: number;
}) {
  const {
    bandHeight = 40,
    durationMs = 800,
    passes = 4,
    seed = 1,
    wordWidth = 160,
  } = input;
  let state = seed * 7919;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  const corners: Array<[number, number]> = [];
  for (let pass = 0; pass <= passes; pass += 1) {
    corners.push([
      200 + (pass % 2 === 0 ? 0 : wordWidth) + (random() - 0.5) * 20,
      400 + (pass / passes) * bandHeight + (random() - 0.5) * 8,
    ]);
  }

  const samples: NotebookScribbleSample[] = [];
  let total = 0;
  for (let index = 1; index < corners.length; index += 1) {
    total += Math.hypot(
      corners[index][0] - corners[index - 1][0],
      corners[index][1] - corners[index - 1][1]
    );
  }
  let travelled = 0;
  for (let index = 1; index < corners.length; index += 1) {
    const [fromX, fromY] = corners[index - 1];
    const [toX, toY] = corners[index];
    const legLength = Math.hypot(toX - fromX, toY - fromY);
    const count = Math.max(2, Math.round(legLength / 4));
    for (let step = index === 1 ? 0 : 1; step <= count; step += 1) {
      const t = step / count;
      samples.push({
        x: fromX + (toX - fromX) * t + (random() - 0.5) * 2,
        y: fromY + (toY - fromY) * t + (random() - 0.5) * 2,
        time: ((travelled + legLength * t) / total) * durationMs,
      });
    }
    travelled += legLength;
  }
  return samples;
}

describe("detectNotebookScribble", () => {
  it("recognises a fast back-and-forth scribble", () => {
    const found = detectNotebookScribble(scribble());

    expect(found).not.toBeNull();
    expect(found!.reversals).toBeGreaterThanOrEqual(3);
    expect(found!.band.hull.length).toBeGreaterThanOrEqual(3);
  });

  describe("as a hand actually scribbles", () => {
    it.each([
      ["four passes over a word", {}],
      ["five passes over a word", { passes: 5, durationMs: 900 }],
      ["six quick passes", { passes: 6, durationMs: 700 }],
      ["four passes over a phrase", { wordWidth: 320 }],
      ["a band as tall as two lines", { passes: 5, bandHeight: 70 }],
      ["an unhurried scribble", { durationMs: 1100 }],
    ])("recognises %s", (_label, options) => {
      for (let seed = 1; seed <= 8; seed += 1) {
        expect(
          detectNotebookScribble(handScribble({ ...options, seed }), {
            viewportScale: 0.85,
          })
        ).not.toBeNull();
      }
    });

    it("recognises the smallest gesture anyone means: three passes", () => {
      for (let seed = 1; seed <= 8; seed += 1) {
        expect(
          detectNotebookScribble(
            handScribble({ passes: 3, durationMs: 600, seed }),
            { viewportScale: 0.85 }
          )
        ).not.toBeNull();
      }
    });

    it("recognises a scribble over a single narrow letter", () => {
      // A few quick passes across a `t` span barely more than its stem. This
      // is the size that made the gesture feel arbitrary: it worked scribbling
      // along a letter and not across one.
      for (let seed = 1; seed <= 8; seed += 1) {
        expect(
          detectNotebookScribble(
            handScribble({
              bandHeight: 36,
              durationMs: 320,
              passes: 5,
              seed,
              wordWidth: 32,
            }),
            { viewportScale: 0.85 }
          )
        ).not.toBeNull();
      }
    });

    /**
     * The gestures people most want this for, and the ones the band rule used
     * to reject: they cover an area rather than tracing a thin line.
     */
    describe("covering an area rather than a line", () => {
      /** Back and forth across a block, working down it. */
      const areaScribble = (input: {
        height: number;
        passes: number;
        seed: number;
        width: number;
      }) => {
        let state = input.seed * 7919;
        const random = () => {
          state = (state * 1103515245 + 12345) % 2147483648;
          return state / 2147483648;
        };
        const samples: NotebookScribbleSample[] = [];
        let time = 0;
        for (let pass = 0; pass < input.passes; pass += 1) {
          const y =
            300 + (pass / (input.passes - 1)) * input.height + (random() - 0.5) * 6;
          const fromX = pass % 2 === 0 ? 150 : 150 + input.width;
          const toX = pass % 2 === 0 ? 150 + input.width : 150;
          const count = Math.max(2, Math.round(input.width / 5));
          for (let step = pass === 0 ? 0 : 1; step <= count; step += 1) {
            const t = step / count;
            samples.push({
              x: fromX + (toX - fromX) * t + (random() - 0.5) * 3,
              y: y + (random() - 0.5) * 3,
              time,
            });
            time += 2.2;
          }
        }
        return samples;
      };

      it("recognises a scribble over a chunk of several lines", () => {
        for (let seed = 1; seed <= 8; seed += 1) {
          expect(
            detectNotebookScribble(
              areaScribble({ height: 220, passes: 9, seed, width: 380 }),
              { viewportScale: 0.85 }
            )
          ).not.toBeNull();
        }
      });

      it("recognises a square-ish scribble, as scribbling out a scribble makes", () => {
        for (let seed = 1; seed <= 8; seed += 1) {
          expect(
            detectNotebookScribble(
              areaScribble({ height: 200, passes: 8, seed, width: 200 }),
              { viewportScale: 0.85 }
            )
          ).not.toBeNull();
        }
      });

      it("recognises one taller than it is wide", () => {
        for (let seed = 1; seed <= 8; seed += 1) {
          expect(
            detectNotebookScribble(
              areaScribble({ height: 300, passes: 10, seed, width: 180 }),
              { viewportScale: 0.85 }
            )
          ).not.toBeNull();
        }
      });
    });

    it("leaves a two-pass cross-out alone, because that is a mark people keep", () => {
      for (let seed = 1; seed <= 8; seed += 1) {
        expect(
          detectNotebookScribble(
            handScribble({ passes: 2, durationMs: 500, seed }),
            { viewportScale: 0.85 }
          )
        ).toBeNull();
      }
    });

    it("leaves a slow, considered movement alone", () => {
      for (let seed = 1; seed <= 8; seed += 1) {
        expect(
          detectNotebookScribble(
            handScribble({ durationMs: 2200, seed }),
            { viewportScale: 0.85 }
          )
        ).toBeNull();
      }
    });
  });


  /**
   * What the *motion* still rules out. A small scribble and a small `w` are
   * the same shape, and every rule that separated them broke something people
   * do -- whole words, blocks of lines, single letters. Letters are kept safe
   * by requiring the gesture to cover ink instead; see the gesture tests.
   */
  it.each([
    ["a two-pass cross-out, which is a mark people keep", [[40, 90], [180, 90], [180, 96], [40, 96]]],
    ["a single fast stroke", [[40, 90], [300, 90]]],
  ])("leaves %s alone", (_label, corners) => {
    expect(
      detectNotebookScribble(trace(corners as Array<[number, number]>))
    ).toBeNull();
  });

  it("leaves a slow deliberate zig-zag alone", () => {
    // Slow enough to be drawing rather than striking out. A merely relaxed
    // scribble still counts -- speed is the weakest of the six signals, and
    // demanding a brisk one is what stopped the gesture firing at all.
    expect(detectNotebookScribble(scribble(6, 0.15))).toBeNull();
  });

  it("leaves a scribble too small to be aimed at anything alone", () => {
    // Narrower than a letter: there is not enough gesture to read.
    const corners: Array<[number, number]> = [];
    for (let pass = 0; pass < 6; pass += 1) {
      corners.push(pass % 2 === 0 ? [40, 60 + pass] : [58, 60 + pass]);
    }

    expect(detectNotebookScribble(trace(corners))).toBeNull();
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

  /**
   * Zoom moves the page under the hand, so the two kinds of threshold have to
   * be measured in different spaces. Scribbling over the same word should work
   * the same at any zoom, even though the hand travels a different distance to
   * do it.
   */
  describe("across zoom levels", () => {
    /**
     * Scribbling over a fixed piece of the page, at a given zoom and a given
     * hand speed. Zoomed in, the hand has further to travel to cross the same
     * word, so the gesture takes proportionally longer.
     */
    const overPageBand = (input: {
      handSpeed?: number;
      pageWidth?: number;
      viewportScale: number;
    }) => {
      const { handSpeed = 2, pageWidth = 140, viewportScale } = input;
      const samples: NotebookScribbleSample[] = [];
      const step = 2;
      const count = Math.max(1, Math.round(pageWidth / step));
      let time = 0;

      for (let pass = 0; pass < 6; pass += 1) {
        const fromX = pass % 2 === 0 ? 100 : 100 + pageWidth;
        const toX = pass % 2 === 0 ? 100 + pageWidth : 100;
        for (let index = pass === 0 ? 0 : 1; index <= count; index += 1) {
          const t = index / count;
          samples.push({
            x: fromX + (toX - fromX) * t,
            y: 200 + pass * 3,
            time,
          });
          time += ((pageWidth / count) * viewportScale) / handSpeed;
        }
      }
      return samples;
    };

    it.each([0.5, 0.85, 1, 2, 4])(
      "recognises a scribble over the same words at %sx",
      (viewportScale) => {
        expect(
          detectNotebookScribble(overPageBand({ viewportScale }), {
            viewportScale,
          })
        ).not.toBeNull();
      }
    );

    it.each([0.5, 1, 4])(
      "still refuses one too small to be aimed at a word at %sx",
      (viewportScale) => {
        expect(
          detectNotebookScribble(
            overPageBand({ viewportScale, pageWidth: 18 }),
            { viewportScale }
          )
        ).toBeNull();
      }
    );

    it("judges speed by the hand, so a lazy sweep zoomed out is not a scribble", () => {
      // Zoomed out, the hand covers four page units per screen pixel: a slow,
      // deliberate movement looks fast if speed is read off the page.
      const dawdling = overPageBand({ viewportScale: 0.25, handSpeed: 0.15 });
      const brisk = overPageBand({ viewportScale: 0.25, handSpeed: 2 });

      expect(
        detectNotebookScribble(dawdling, { viewportScale: 0.25 })
      ).toBeNull();
      expect(
        detectNotebookScribble(brisk, { viewportScale: 0.25 })
      ).not.toBeNull();
    });
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
