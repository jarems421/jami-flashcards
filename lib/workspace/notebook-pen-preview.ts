export type NotebookBatchedPen = {
  previewStroke(): void;
  onPointerUp(event: unknown): boolean | void;
  onGestureCancel(event: unknown): void;
};

export type NotebookPenPreviewBatch = {
  beginBatch(): void;
  endBatch(): void;
  paintNow(): void;
  dispose(): void;
};

/**
 * js-draw clears and repaints the full unfinished stroke whenever a point is
 * added. A single Apple Pencil pointermove can contain several coalesced
 * points, so repainting after every point is unnecessarily expensive.
 *
 * Batch only the points inside that one browser event, then paint once
 * synchronously before returning to Safari. This preserves the richer Pencil
 * geometry without the extra requestAnimationFrame of latency that the old
 * frame gate introduced.
 */
export function installBatchedNotebookPenPreview(
  pen: NotebookBatchedPen
): NotebookPenPreviewBatch {
  const originalPreviewStroke = pen.previewStroke;
  const originalPointerUp = pen.onPointerUp;
  const originalGestureCancel = pen.onGestureCancel;
  let batchDepth = 0;
  let dirty = false;
  let finalizing = false;
  let finalPreviewPainted = false;
  let disposed = false;

  const paintOriginal = () => {
    if (disposed) return;
    originalPreviewStroke.call(pen);
  };

  pen.previewStroke = function batchedPreview() {
    if (finalizing) {
      if (!finalPreviewPainted) {
        finalPreviewPainted = true;
        paintOriginal();
      }
      return;
    }
    if (batchDepth > 0) {
      dirty = true;
      return;
    }
    paintOriginal();
  };

  pen.onPointerUp = function batchedPointerUp(event) {
    batchDepth = 0;
    dirty = false;
    finalizing = true;
    finalPreviewPainted = false;
    try {
      return originalPointerUp.call(pen, event);
    } finally {
      finalizing = false;
      finalPreviewPainted = false;
    }
  };

  pen.onGestureCancel = function batchedGestureCancel(event) {
    batchDepth = 0;
    dirty = false;
    return originalGestureCancel.call(pen, event);
  };

  return {
    beginBatch() {
      if (!disposed) batchDepth += 1;
    },
    endBatch() {
      if (disposed || batchDepth === 0) return;
      batchDepth -= 1;
      if (batchDepth === 0 && dirty) {
        dirty = false;
        paintOriginal();
      }
    },
    paintNow() {
      if (disposed) return;
      dirty = false;
      paintOriginal();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      batchDepth = 0;
      dirty = false;
      pen.previewStroke = originalPreviewStroke;
      pen.onPointerUp = originalPointerUp;
      pen.onGestureCancel = originalGestureCancel;
    },
  };
}
