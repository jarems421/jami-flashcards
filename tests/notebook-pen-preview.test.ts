import { describe, expect, it } from "vitest";
import {
  installBatchedNotebookPenPreview,
  type NotebookBatchedPen,
} from "@/lib/workspace/notebook-pen-preview";

describe("notebook pen preview batching", () => {
  it("paints coalesced samples once, synchronously at the end of the packet", () => {
    let previewCount = 0;
    const pen: NotebookBatchedPen = {
      previewStroke() {
        previewCount += 1;
      },
      onPointerUp() {
        return false;
      },
      onGestureCancel() {},
    };
    const batch = installBatchedNotebookPenPreview(pen);

    batch.beginBatch();
    pen.previewStroke();
    pen.previewStroke();
    pen.previewStroke();
    expect(previewCount).toBe(0);

    batch.endBatch();
    expect(previewCount).toBe(1);
    batch.dispose();
  });

  it("does not defer an ordinary preview or the first contact paint", () => {
    let previewCount = 0;
    const pen: NotebookBatchedPen = {
      previewStroke() {
        previewCount += 1;
      },
      onPointerUp() {},
      onGestureCancel() {},
    };
    const batch = installBatchedNotebookPenPreview(pen);

    pen.previewStroke();
    batch.paintNow();

    expect(previewCount).toBe(2);
  });

  it("paints completed geometry exactly once on pointer-up", () => {
    let previewCount = 0;
    const pen: NotebookBatchedPen = {
      previewStroke() {
        previewCount += 1;
      },
      onPointerUp() {
        // js-draw asks for a preview after adding the pointer-up point and
        // again while finalizing the same stroke.
        this.previewStroke();
        this.previewStroke();
        return false;
      },
      onGestureCancel() {},
    };
    const batch = installBatchedNotebookPenPreview(pen);

    batch.beginBatch();
    pen.previewStroke();
    expect(pen.onPointerUp({})).toBe(false);

    expect(previewCount).toBe(1);
    batch.endBatch();
    expect(previewCount).toBe(1);
  });

  it("lets something be drawn after every live paint, but not the final one", () => {
    // The predicted tip is painted here, on top of the stroke and wiped with
    // it. The stroke's last paint shows exactly what is about to be kept, so
    // nothing is drawn after that one.
    const events: string[] = [];
    const pen: NotebookBatchedPen = {
      previewStroke() {
        events.push("paint");
      },
      onPointerUp() {
        this.previewStroke();
        this.previewStroke();
        return false;
      },
      onGestureCancel() {},
    };
    const batch = installBatchedNotebookPenPreview(pen, {
      afterPaint: () => events.push("after"),
    });

    batch.paintNow();
    batch.beginBatch();
    pen.previewStroke();
    pen.previewStroke();
    batch.endBatch();
    pen.previewStroke();
    expect(events).toEqual(["paint", "after", "paint", "after", "paint", "after"]);

    events.length = 0;
    pen.onPointerUp({});
    expect(events).toEqual(["paint"]);
  });

  it("drops unfinished batch work when cancelled or disposed", () => {
    let previewCount = 0;
    let cancelCount = 0;
    const pen: NotebookBatchedPen = {
      previewStroke() {
        previewCount += 1;
      },
      onPointerUp() {},
      onGestureCancel() {
        cancelCount += 1;
      },
    };
    const batch = installBatchedNotebookPenPreview(pen);

    batch.beginBatch();
    pen.previewStroke();
    pen.onGestureCancel({});
    batch.endBatch();
    expect(cancelCount).toBe(1);
    expect(previewCount).toBe(0);

    batch.beginBatch();
    pen.previewStroke();
    batch.dispose();
    batch.endBatch();
    expect(previewCount).toBe(0);
  });
});
