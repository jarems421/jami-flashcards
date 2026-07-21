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
