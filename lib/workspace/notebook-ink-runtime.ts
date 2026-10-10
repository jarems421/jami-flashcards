import { getNotebookInkViewportScale } from "@/lib/workspace/notebook-viewport";
import type { NotebookInkRenderWindow } from "@/lib/workspace/notebook-ink-window";
import { NOTEBOOK_STRAIGHTEN_HOLD } from "@/lib/workspace/notebook-ink-contact";

type Comparable<Value> = {
  eq(other: Value): boolean;
};

type NotebookInkViewport<ScreenSize, Transform> = {
  canvasToScreenTransform: Comparable<Transform>;
  getScreenRectSize(): Comparable<ScreenSize>;
  resetTransform(transform: Transform): void;
  updateScreenSize(screenSize: ScreenSize): void;
};

type NotebookInkViewportEditor<ScreenSize, Transform> = {
  rerender(showExportRect?: boolean): void;
  viewport: NotebookInkViewport<ScreenSize, Transform>;
};

export function installNotebookInkViewportSynchronizer<
  ScreenSize,
  Transform,
>(input: {
  createScreenSize(width: number, height: number): ScreenSize;
  /**
   * `offsetX`/`offsetY` are where the painted slice starts on the sheet, so a
   * canvas covering only part of a zoomed page still puts page coordinates in
   * the right place. Zero for a canvas covering the whole sheet.
   */
  createTransform(
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number
  ): Transform;
  editor: NotebookInkViewportEditor<ScreenSize, Transform>;
  /**
   * The measured canvas. Used only when there is no window -- see below for why
   * a window must not be paired with it.
   */
  getDisplaySize(): { width: number; height: number };
  /**
   * The slice of a zoomed sheet being painted, or null for the whole sheet.
   * See `notebook-ink-window.ts`.
   */
  getRenderWindow?(): NotebookInkRenderWindow | null;
  pageHeight: number;
  pageWidth: number;
  shouldSkip(): boolean;
}) {
  const rerenderWithoutExportBounds = input.editor.rerender.bind(input.editor);

  const synchronize = () => {
    if (input.shouldSkip()) return;

    /*
     * The canvas size and the transform are taken from one snapshot, and that
     * is the whole reason the window answers both.
     *
     * They used to share a source by construction: the size was measured, and
     * the scale derived from that same measurement. A window breaks that, since
     * it is pushed in synchronously by a layout effect while the matching size
     * is reported by a ResizeObserver a beat later. Read separately, js-draw
     * spends those frames holding a transform for the new slice against a size
     * for the old one -- so its idea of what is on screen is the wrong size and
     * in the wrong place, and the stroke being drawn is culled and simplified
     * against it. Reading both from the window closes the gap.
     */
    const painted = input.getRenderWindow?.() ?? null;
    const displaySize = painted
      ? { width: painted.width, height: painted.height }
      : input.getDisplaySize();
    const sheet = painted
      ? {
          width: painted.sheetWidth,
          height: painted.sheetHeight,
          left: painted.left,
          top: painted.top,
        }
      : {
          width: displaySize.width,
          height: displaySize.height,
          left: 0,
          top: 0,
        };
    const scale = getNotebookInkViewportScale({
      displayWidth: sheet.width,
      displayHeight: sheet.height,
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
    });

    if (scale.x > 0 && scale.y > 0) {
      const screenSize = input.createScreenSize(
        displaySize.width,
        displaySize.height
      );
      const transform = input.createTransform(
        scale.x,
        scale.y,
        sheet.left,
        sheet.top
      );
      if (!input.editor.viewport.getScreenRectSize().eq(screenSize)) {
        input.editor.viewport.updateScreenSize(screenSize);
      }
      if (!input.editor.viewport.canvasToScreenTransform.eq(transform)) {
        input.editor.viewport.resetTransform(transform);
      }
    }

    // The notebook sheet owns the visible page boundary. Passing false keeps
    // js-draw's internal import/export rectangle out of every repaint.
    rerenderWithoutExportBounds(false);
  };

  input.editor.rerender = synchronize;
  return synchronize;
}

export function suppressNotebookEraserPreview(eraser: {
  drawPreviewAt?: () => void;
}) {
  eraser.drawPreviewAt = function suppressedDrawPreviewAt() {};
}

type NotebookAimablePen = {
  autocorrectShape?: (pointer: unknown) => Promise<void>;
  lastAutocorrectedShape?: unknown;
};

/**
 * Lets a straightened line be aimed right up to the moment the pen lifts.
 *
 * js-draw remembers the line it snapped to, and if the pen lifts within a few
 * hundred milliseconds of first moving again it puts that remembered line back
 * -- on the reasoning that a small movement just after a correction was
 * probably a slip, and the correction should survive it.
 *
 * That reasoning held while any movement *destroyed* the line. It no longer
 * does: movement now aims the line instead, so the remembered version is
 * simply an older aim, and restoring it throws away the adjustment. It bites
 * exactly when someone is quick and confident -- snap, swing to the angle they
 * want, lift -- which is the gesture working as intended.
 *
 * Forgetting the shape as soon as it has been shown leaves both remaining
 * paths correct: lift without moving and js-draw commits the line it is still
 * holding, or move and it asks the builder, which returns the aimed line.
 */
export function keepNotebookStraightenedLineAimable(pen: object) {
  const target = pen as NotebookAimablePen;
  const autocorrectShape = target.autocorrectShape;
  if (typeof autocorrectShape !== "function") return false;

  target.autocorrectShape = async function aimableAutocorrectShape(pointer) {
    await autocorrectShape.call(target, pointer);
    // Shown by now, and no longer wanted as a fallback.
    target.lastAutocorrectedShape = null;
  };
  return true;
}

type NotebookStationaryPen = {
  stationaryDetector?: { config?: Record<string, number> } | null;
  onPointerDown?: (...args: unknown[]) => unknown;
};

/**
 * Makes the hold that straightens a line one a hand can actually hold.
 *
 * The detector is built fresh for each stroke and keeps its config by
 * reference, reading it again on every move -- so replacing the object once the
 * stroke has begun takes effect for that stroke, including the timer, which is
 * reset on the first move after the change.
 */
export function relaxNotebookStraightenHold(pen: object) {
  const target = pen as NotebookStationaryPen;
  const onPointerDown = target.onPointerDown;
  if (typeof onPointerDown !== "function") return false;

  target.onPointerDown = function holdAwareOnPointerDown(...args: unknown[]) {
    const handled = onPointerDown.apply(target, args);
    const detector = target.stationaryDetector;
    if (detector && detector.config) {
      detector.config = { ...detector.config, ...NOTEBOOK_STRAIGHTEN_HOLD };
    }
    return handled;
  };
  return true;
}

export function dispatchBatchedNotebookPointerSamples<Sample>(input: {
  batch?: { beginBatch(): void; endBatch(): void };
  dispatch(sample: Sample): void;
  samples: readonly Sample[];
}) {
  input.batch?.beginBatch();
  try {
    input.samples.forEach(input.dispatch);
  } finally {
    input.batch?.endBatch();
  }
}
