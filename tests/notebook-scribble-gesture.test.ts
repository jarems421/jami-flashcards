import { describe, expect, it } from "vitest";
import {
  applyNotebookScribbleErase,
  planNotebookScribbleErase,
} from "@/lib/workspace/notebook-scribble-gesture";
import type { NotebookScribbleSample } from "@/lib/workspace/notebook-scribble-erase";
import { Color4, Path, PathCommandType, Rect2, Vec2 } from "@js-draw/math";
// @ts-expect-error -- Direct module import avoids js-draw's browser-only package entry in node tests.
import JsDrawStroke from "../node_modules/js-draw/dist/mjs/components/Stroke.mjs";

class FakeErase {
  constructor(readonly components: JsDrawStroke[]) {}
}

/** A scribble back and forth across a band, sampled at a believable rate. */
function scribbleSamples(): NotebookScribbleSample[] {
  const samples: NotebookScribbleSample[] = [];
  let time = 0;
  for (let pass = 0; pass < 6; pass += 1) {
    const fromX = pass % 2 === 0 ? 40 : 180;
    const toX = pass % 2 === 0 ? 180 : 40;
    const y = 100 + pass * 3;
    for (let step = 0; step <= 70; step += 1) {
      samples.push({
        x: fromX + ((toX - fromX) * step) / 70,
        y,
        time,
      });
      time += 1;
    }
  }
  return samples;
}

function line(fromX: number, fromY: number, toX: number, toY: number) {
  return JsDrawStroke.fromStroked(
    new Path(Vec2.of(fromX, fromY), [
      { kind: PathCommandType.LineTo, point: Vec2.of(toX, toY) },
    ]),
    { color: Color4.black, width: 2 }
  ) as JsDrawStroke;
}

function makeHarness(strokes: JsDrawStroke[], scale = 1) {
  const dispatched: FakeErase[] = [];
  const editor = {
    dispatch(command: FakeErase) {
      dispatched.push(command);
    },
    image: {
      getComponentsIntersecting: (area: Rect2) =>
        strokes.filter((stroke) => stroke.getExactBBox().intersects(area)),
    },
    viewport: {
      getScaleFactor: () => scale,
      screenToCanvas: (point: { x: number; y: number }) =>
        Vec2.of(point.x / scale, point.y / scale),
    },
  };
  const jsDraw = { Erase: FakeErase, Rect2, Stroke: JsDrawStroke, Vec2 };

  return { dispatched, editor, jsDraw, surfaceReads: 0 };
}

const plan = (
  harness: ReturnType<typeof makeHarness>,
  samples = scribbleSamples()
) =>
  planNotebookScribbleErase({
    editor: harness.editor as never,
    jsDraw: harness.jsDraw as never,
    // The page sits at the origin here, so client coordinates are page
    // coordinates and the fixtures read as written.
    getSurfaceOffset: () => {
      harness.surfaceReads += 1;
      return { left: 0, top: 0 };
    },
    samples,
    strokeWidth: 2,
  });

describe("planNotebookScribbleErase", () => {
  it("plans the strokes a scribble covered", () => {
    // A short word-sized stroke sitting inside the scribbled band.
    const word = line(60, 106, 130, 106);
    const found = plan(makeHarness([word]));

    expect(found?.components).toEqual([word]);
  });

  it("plans nothing over blank paper, so the scribble commits as ink", () => {
    expect(plan(makeHarness([]))).toBeNull();
  });

  /**
   * This runs at the end of every pen stroke, so what it costs to say "no" is
   * what writing costs. Locating the page forces a layout flush; doing it per
   * stroke was enough to make writing feel like it dragged.
   */
  it("does not go looking for the page unless a scribble was found", () => {
    const ordinary = makeHarness([]);
    // An ordinary stroke, which is what nearly every pen-up is.
    const straight: NotebookScribbleSample[] = Array.from(
      { length: 60 },
      (_, step) => ({ x: 40 + step * 3, y: 106, time: step })
    );
    plan(ordinary, straight);
    expect(ordinary.surfaceReads).toBe(0);

    const scribbled = makeHarness([]);
    plan(scribbled, scribbleSamples());
    expect(scribbled.surfaceReads).toBe(1);
  });

  it("spares a rule that only passes beneath the scribble", () => {
    expect(plan(makeHarness([line(-400, 110, 600, 110)]))).toBeNull();
  });

  it("spares everything when the gesture was not a scribble", () => {
    const word = line(60, 106, 130, 106);
    // A single fast stroke straight across the same band.
    const straight: NotebookScribbleSample[] = Array.from(
      { length: 60 },
      (_, step) => ({ x: 40 + step * 3, y: 106, time: step })
    );

    expect(plan(makeHarness([word]), straight)).toBeNull();
  });

  it("maps the band into page coordinates, so zoom does not shift it", () => {
    // At 2x, the same screen gesture covers half as much of the page.
    const zoomed = line(30, 53, 65, 53);
    const found = plan(makeHarness([zoomed], 2));

    expect(found?.components).toEqual([zoomed]);
    // The stroke that would have matched at 1x is now outside the band.
    expect(plan(makeHarness([line(60, 106, 130, 106)], 2))).toBeNull();
  });
});

/**
 * Where letters are kept safe.
 *
 * A letter-sized scribble and a letter are the same motion, so shape cannot
 * separate them and the rules that tried broke whole words, blocks of lines and
 * single letters. What separates them is what the gesture *did*: writing a
 * letter leaves existing work mostly outside it, while scribbling something out
 * swallows it.
 */
describe("a letter-sized gesture has to swallow what it takes", () => {
  /** A `w`, which every shape gate reads as a scribble. */
  const letterW = (): NotebookScribbleSample[] => {
    const corners: Array<[number, number]> = [
      [100, 100],
      [115, 160],
      [130, 100],
      [145, 160],
      [160, 100],
    ];
    const samples: NotebookScribbleSample[] = [];
    let time = 0;
    for (let index = 1; index < corners.length; index += 1) {
      const [fromX, fromY] = corners[index - 1];
      const [toX, toY] = corners[index];
      const length = Math.hypot(toX - fromX, toY - fromY);
      const count = Math.max(2, Math.round(length / 2));
      for (let step = index === 1 ? 0 : 1; step <= count; step += 1) {
        const t = step / count;
        samples.push({
          x: fromX + (toX - fromX) * t,
          y: fromY + (toY - fromY) * t,
          time,
        });
        time += length / count / 2;
      }
    }
    return samples;
  };

  it("deletes nothing when a letter is written on blank paper", () => {
    expect(plan(makeHarness([]), letterW())).toBeNull();
  });

  it("deletes nothing when a letter is written across existing work", () => {
    // A line of writing running through where the `w` was made. Most of it
    // lies outside the letter, so the letter takes none of it.
    expect(plan(makeHarness([line(-200, 130, 400, 130)]), letterW())).toBeNull();
  });

  it("still takes a letter that a letter-sized scribble swallows whole", () => {
    // A short stroke sitting entirely inside the same gesture.
    const swallowed = line(112, 128, 150, 132);

    expect(plan(makeHarness([swallowed]), letterW())?.components).toEqual([
      swallowed,
    ]);
  });
});

describe("applyNotebookScribbleErase", () => {
  it("erases in one undoable action", () => {
    const word = line(60, 106, 130, 106);
    const other = line(70, 108, 120, 108);
    const harness = makeHarness([word, other]);
    const found = plan(harness);
    expect(found).not.toBeNull();

    applyNotebookScribbleErase(
      harness.editor as never,
      harness.jsDraw as never,
      found!
    );

    expect(harness.dispatched).toHaveLength(1);
    expect(harness.dispatched[0].components).toEqual([word, other]);
  });
});
