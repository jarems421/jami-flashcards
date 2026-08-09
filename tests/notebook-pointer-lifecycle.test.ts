import { describe, expect, it } from "vitest";
import { NotebookInkPointerLifecycle } from "@/lib/workspace/notebook-pointer-lifecycle";

describe("notebook ink pointer lifecycle", () => {
  it("preserves three rapid strokes when capture-loss events arrive late", () => {
    const lifecycle = new NotebookInkPointerLifecycle();
    const pointerId = 7;

    const first = lifecycle.begin(pointerId);
    expect(first.shouldCancelStaleGesture).toBe(false);
    lifecycle.finish({
      pointerId,
      expectCaptureLoss: true,
      timeStamp: 10,
    });

    const second = lifecycle.begin(pointerId);
    expect(second.shouldCancelStaleGesture).toBe(false);
    expect(lifecycle.handleLostCapture(pointerId, 21)).toEqual({
      kind: "ignore-intentional",
    });
    expect(lifecycle.isCurrent(pointerId, second.generation)).toBe(true);
    lifecycle.finish({
      pointerId,
      expectCaptureLoss: true,
      timeStamp: 30,
    });

    const third = lifecycle.begin(pointerId);
    expect(third.shouldCancelStaleGesture).toBe(false);
    expect(lifecycle.handleLostCapture(pointerId, 41)).toEqual({
      kind: "ignore-intentional",
    });
    expect(lifecycle.isCurrent(pointerId, third.generation)).toBe(true);
    expect(lifecycle.isInteracting).toBe(true);
    expect(
      lifecycle.finish({
        pointerId,
        expectCaptureLoss: true,
        timeStamp: 50,
      })
    ).toBe(true);
    expect(lifecycle.handleLostCapture(pointerId, 61)).toEqual({
      kind: "ignore-intentional",
    });
  });

  it("keeps rapid re-contact active after a cancelled captured stroke", () => {
    const lifecycle = new NotebookInkPointerLifecycle();
    const pointerId = 11;

    lifecycle.begin(pointerId);
    lifecycle.finish({
      pointerId,
      expectCaptureLoss: true,
      timeStamp: 10,
    });

    const next = lifecycle.begin(pointerId);
    expect(lifecycle.handleLostCapture(pointerId, 18)).toEqual({
      kind: "ignore-intentional",
    });
    expect(lifecycle.isCurrent(pointerId, next.generation)).toBe(true);
    expect(lifecycle.isInteracting).toBe(true);
  });

  it("still cancels a genuinely stranded active pointer", () => {
    const lifecycle = new NotebookInkPointerLifecycle();
    const start = lifecycle.begin(4);
    const decision = lifecycle.handleLostCapture(4, 10);

    expect(decision).toEqual({
      kind: "cancel-active",
      generation: start.generation,
    });
    expect(lifecycle.isCurrent(4, start.generation)).toBe(true);
  });

  it("does not let an expired intentional release mask a later loss", () => {
    const lifecycle = new NotebookInkPointerLifecycle();
    lifecycle.begin(2);
    lifecycle.finish({
      pointerId: 2,
      expectCaptureLoss: true,
      timeStamp: 0,
    });
    const next = lifecycle.begin(2);

    expect(lifecycle.handleLostCapture(2, 500)).toEqual({
      kind: "cancel-active",
      generation: next.generation,
    });
  });

  it("requests stale-gesture cleanup only when a contact is still active", () => {
    const lifecycle = new NotebookInkPointerLifecycle();
    expect(lifecycle.begin(1).shouldCancelStaleGesture).toBe(false);
    expect(lifecycle.begin(2).shouldCancelStaleGesture).toBe(true);
  });
});

/**
 * A Pencil reports pointermove while it hovers, before it has touched anything
 * and after it has left. Those moves used to reach the drawing path, so a
 * stroke went on growing after the pen was lifted -- following it through the
 * air.
 */
describe("knowing whether a contact is down", () => {
  it("is true only between the down and the up", () => {
    const lifecycle = new NotebookInkPointerLifecycle();

    expect(lifecycle.isDown(1)).toBe(false);
    lifecycle.begin(1);
    expect(lifecycle.isDown(1)).toBe(true);
    // A different pencil, or a finger, is not this contact.
    expect(lifecycle.isDown(2)).toBe(false);

    lifecycle.finish({ pointerId: 1, expectCaptureLoss: false, timeStamp: 0 });
    expect(lifecycle.isDown(1)).toBe(false);
  });

  it("forgets a contact that was cancelled rather than lifted", () => {
    const lifecycle = new NotebookInkPointerLifecycle();
    lifecycle.begin(7);
    lifecycle.reset();
    expect(lifecycle.isDown(7)).toBe(false);
  });

  it("follows the newest contact when one replaces another", () => {
    // Starting a stroke clears whatever was active, so a stale pointer that
    // never reported its up cannot leave the gate propped open.
    const lifecycle = new NotebookInkPointerLifecycle();
    lifecycle.begin(3);
    lifecycle.begin(4);
    expect(lifecycle.isDown(3)).toBe(false);
    expect(lifecycle.isDown(4)).toBe(true);
  });
});
