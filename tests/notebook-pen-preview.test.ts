import { describe, expect, it } from "vitest";
import {
  installFrameGatedNotebookPenPreview,
  type NotebookFrameGatedPen,
  type NotebookPenPreviewScheduler,
} from "@/lib/workspace/notebook-pen-preview";

function makeHarness() {
  let nextFrameId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const scheduler: NotebookPenPreviewScheduler = {
    requestFrame(callback) {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelFrame(frameId) {
      frames.delete(frameId);
    },
  };
  const runFrames = () => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach((callback) => callback(0));
  };
  return { frames, runFrames, scheduler };
}

describe("notebook pen preview scheduling", () => {
  it("paints at most once for all samples in a display frame", () => {
    const harness = makeHarness();
    let previewCount = 0;
    const pen: NotebookFrameGatedPen = {
      previewStroke() {
        previewCount += 1;
      },
      onPointerUp() {
        return false;
      },
      onGestureCancel() {},
    };
    const dispose = installFrameGatedNotebookPenPreview(pen, harness.scheduler);

    pen.previewStroke();
    pen.previewStroke();
    pen.previewStroke();

    expect(previewCount).toBe(0);
    expect(harness.frames.size).toBe(1);
    harness.runFrames();
    expect(previewCount).toBe(1);
    dispose();
  });

  it("cancels a stale frame and paints completed geometry exactly once", () => {
    const harness = makeHarness();
    let previewCount = 0;
    const pen: NotebookFrameGatedPen = {
      previewStroke() {
        previewCount += 1;
      },
      onPointerUp() {
        // js-draw previews after adding the pointer-up point and then requests
        // the same preview again while finalizing the stroke.
        this.previewStroke();
        this.previewStroke();
        return false;
      },
      onGestureCancel() {},
    };
    installFrameGatedNotebookPenPreview(pen, harness.scheduler);

    pen.previewStroke();
    expect(harness.frames.size).toBe(1);
    expect(pen.onPointerUp({})).toBe(false);

    expect(harness.frames.size).toBe(0);
    expect(previewCount).toBe(1);
    harness.runFrames();
    expect(previewCount).toBe(1);
  });

  it("drops pending preview work when a gesture is cancelled or disposed", () => {
    const harness = makeHarness();
    let previewCount = 0;
    let cancelCount = 0;
    const pen: NotebookFrameGatedPen = {
      previewStroke() {
        previewCount += 1;
      },
      onPointerUp() {},
      onGestureCancel() {
        cancelCount += 1;
      },
    };
    const dispose = installFrameGatedNotebookPenPreview(pen, harness.scheduler);

    pen.previewStroke();
    pen.onGestureCancel({});
    expect(cancelCount).toBe(1);
    expect(harness.frames.size).toBe(0);
    harness.runFrames();
    expect(previewCount).toBe(0);

    pen.previewStroke();
    dispose();
    expect(harness.frames.size).toBe(0);
  });
});
