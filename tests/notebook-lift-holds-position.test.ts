// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { loadJsDraw, makePrecisePenInputMapper, type JsDrawModule } from "@/lib/workspace/notebook-js-draw";
import type { NotebookInkSmoother } from "@/lib/workspace/notebook-ink-smoothing";

let jsDraw: JsDrawModule;
beforeAll(async () => {
  jsDraw = await loadJsDraw();
}, 120_000);

/**
 * A stroke ends on the point it was already drawn to.
 *
 * js-draw finalises a stroke by adding the pointerup position, so whatever that
 * position is becomes a final segment -- one that appears in a single frame,
 * after the pen has left the glass, and stays, because it is geometry rather
 * than a paint artifact. Holding the lift where the ink already is, rather than
 * stepping it to the pen, is what stops that.
 *
 * That was written as `if (smoother) { ... }`, so the invariant held only while
 * a pointer had a smoother. It can be missing -- a down that reached the tool by
 * another route, a tool swapped mid-contact, a contact resumed after a cancel --
 * and in each case the lift fell through carrying its raw position. These tests
 * exist because the failure is invisible in review and permanent on the page.
 */
describe("the lift never moves the ink", () => {
  const viewport = {
    screenToCanvas: (point: unknown) => point,
    canvasToScreen: (point: unknown) => point,
    roundPoint: (point: unknown) => point,
    getScaleFactor: () => 1,
  } as never;

  type Emitted = { x: number; y: number };

  /** Drives the mapper and reports the position it emitted for each event. */
  function run(
    kinds: ("down" | "move" | "up")[],
    positions: [number, number][],
    seedSmoother: boolean
  ): Emitted[] {
    const smoothers = new Map<number, NotebookInkSmoother>();
    const mapper = makePrecisePenInputMapper(jsDraw, { viewport } as never, smoothers);

    const emitted: Emitted[] = [];
    (mapper as unknown as { emit: (event: unknown) => boolean }).emit = (event) => {
      const current = (event as { current: { screenPos: { x: number; y: number } } }).current;
      emitted.push({ x: current.screenPos.x, y: current.screenPos.y });
      return true;
    };

    kinds.forEach((kind, index) => {
      const [x, y] = positions[index];
      const screenPos = jsDraw.Vec2.of(x, y);
      const pointer = {
        id: 1,
        screenPos,
        timeStamp: index * 16,
        withScreenPosition(next: { x: number; y: number }) {
          return { ...this, screenPos: next };
        },
      };
      const kindMap = {
        down: jsDraw.InputEvtType.PointerDownEvt,
        move: jsDraw.InputEvtType.PointerMoveEvt,
        up: jsDraw.InputEvtType.PointerUpEvt,
      } as const;

      // Skipping the down is how a pointer arrives with no smoother.
      if (kind === "down" && !seedSmoother) return;

      (mapper as unknown as { onEvent: (event: unknown) => boolean }).onEvent({
        kind: kindMap[kind],
        current: pointer,
        allPointers: [pointer],
      });
    });

    return emitted;
  }

  it("ends where the ink was drawn, when the stroke had a smoother", () => {
    const emitted = run(
      ["down", "move", "move", "up"],
      [
        [100, 100],
        [140, 100],
        [180, 100],
        // The pen travelled well past the last move before the browser
        // reported the lift, which is the position that used to be kept.
        [230, 100],
      ],
      true
    );

    const lastMove = emitted[emitted.length - 2];
    const lift = emitted[emitted.length - 1];
    expect(lift).toEqual(lastMove);
    expect(lift.x).toBeLessThan(230);
  });

  /*
   * The case the old guard let through. Without a smoother it took the raw
   * pointerup, so the stroke gained a segment reaching to 230 that no frame had
   * ever drawn -- and kept it.
   */
  it("ends where the ink was drawn, even with no smoother for the pointer", () => {
    const emitted = run(
      ["down", "move", "move", "up"],
      [
        [100, 100],
        [140, 100],
        [180, 100],
        [230, 100],
      ],
      false
    );

    const lastMove = emitted[emitted.length - 2];
    const lift = emitted[emitted.length - 1];
    expect(lift).toEqual(lastMove);
    expect(lift.x).toBe(180);
  });

  it("still lets moves through unchanged when there is no smoother", () => {
    const emitted = run(["down", "move", "up"], [[10, 10], [60, 20], [90, 30]], false);
    expect(emitted[0]).toEqual({ x: 60, y: 20 });
  });

  it("has something to hold even when the lift is the first event seen", () => {
    const emitted = run(["up"], [[42, 24]], false);
    expect(emitted[0]).toEqual({ x: 42, y: 24 });
  });
});
