export type NotebookPenPreviewScheduler = {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(frameId: number): void;
};

export type NotebookFrameGatedPen = {
  previewStroke(): void;
  onPointerUp(event: unknown): boolean | void;
  onGestureCancel(event: unknown): void;
};

const browserScheduler: NotebookPenPreviewScheduler = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
};

/**
 * js-draw's pen clears its wet canvas and repaints the complete unfinished
 * stroke for every input sample. Apple Pencil packets contain several
 * coalesced samples, so doing that work for each sample quickly falls behind on
 * iPad. Gate the expensive preview to the display frame while still feeding all
 * selected geometry into the stroke builder.
 *
 * Pointer-up is special: it synchronously paints the exact completed geometry
 * once before js-draw flattens the wet canvas into the committed image. The pen
 * asks for the same preview twice during finalization, so the second request is
 * deliberately ignored.
 */
export function installFrameGatedNotebookPenPreview(
  pen: NotebookFrameGatedPen,
  scheduler: NotebookPenPreviewScheduler = browserScheduler
) {
  const originalPreviewStroke = pen.previewStroke;
  const originalPointerUp = pen.onPointerUp;
  const originalGestureCancel = pen.onGestureCancel;
  let pendingFrame: number | null = null;
  let finalizing = false;
  let finalPreviewPainted = false;

  const cancelPendingPreview = () => {
    if (pendingFrame === null) return;
    scheduler.cancelFrame(pendingFrame);
    pendingFrame = null;
  };

  pen.previewStroke = function frameGatedPreview() {
    if (finalizing) {
      if (!finalPreviewPainted) {
        finalPreviewPainted = true;
        originalPreviewStroke.call(pen);
      }
      return;
    }
    if (pendingFrame !== null) return;
    pendingFrame = scheduler.requestFrame(() => {
      pendingFrame = null;
      originalPreviewStroke.call(pen);
    });
  };

  pen.onPointerUp = function frameGatedPointerUp(event) {
    cancelPendingPreview();
    finalizing = true;
    finalPreviewPainted = false;
    try {
      return originalPointerUp.call(pen, event);
    } finally {
      finalizing = false;
      finalPreviewPainted = false;
    }
  };

  pen.onGestureCancel = function frameGatedGestureCancel(event) {
    cancelPendingPreview();
    return originalGestureCancel.call(pen, event);
  };

  return () => {
    cancelPendingPreview();
    pen.previewStroke = originalPreviewStroke;
    pen.onPointerUp = originalPointerUp;
    pen.onGestureCancel = originalGestureCancel;
  };
}
