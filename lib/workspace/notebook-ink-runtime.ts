import { getNotebookInkViewportScale } from "@/lib/workspace/notebook-viewport";

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
  createTransform(scaleX: number, scaleY: number): Transform;
  editor: NotebookInkViewportEditor<ScreenSize, Transform>;
  getDisplaySize(): { width: number; height: number };
  pageHeight: number;
  pageWidth: number;
  shouldSkip(): boolean;
}) {
  const rerenderWithoutExportBounds = input.editor.rerender.bind(input.editor);

  const synchronize = () => {
    if (input.shouldSkip()) return;

    const displaySize = input.getDisplaySize();
    const scale = getNotebookInkViewportScale({
      displayWidth: displaySize.width,
      displayHeight: displaySize.height,
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
    });

    if (scale.x > 0 && scale.y > 0) {
      const screenSize = input.createScreenSize(
        displaySize.width,
        displaySize.height
      );
      const transform = input.createTransform(scale.x, scale.y);
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

export function installNotebookNativeInkGuards(
  surface: HTMLElement,
  shouldSuppress: (event: PointerEvent) => boolean
) {
  const suppressNativeGesture = (event: PointerEvent) => {
    if (event.cancelable && shouldSuppress(event)) {
      event.preventDefault();
    }
  };
  const listenerOptions: AddEventListenerOptions = {
    capture: true,
    passive: false,
  };

  surface.addEventListener(
    "pointerdown",
    suppressNativeGesture,
    listenerOptions
  );
  surface.addEventListener(
    "pointermove",
    suppressNativeGesture,
    listenerOptions
  );

  return () => {
    surface.removeEventListener(
      "pointerdown",
      suppressNativeGesture,
      listenerOptions
    );
    surface.removeEventListener(
      "pointermove",
      suppressNativeGesture,
      listenerOptions
    );
  };
}

export type NotebookInkPointerEventType =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel";

export function shouldContinueNotebookPrecisionGesture(input: {
  activePointerId?: number;
  pointerId: number;
  type: NotebookInkPointerEventType;
}) {
  return (
    input.type !== "pointerdown" && input.activePointerId === input.pointerId
  );
}

export function shouldUseNotebookPrecisionGesture(input: {
  continuing: boolean;
  precisionEraserSelected: boolean;
}) {
  return input.continuing || input.precisionEraserSelected;
}

export function shouldExpectNotebookCaptureLoss(
  type: NotebookInkPointerEventType,
  hadPointerCapture: boolean
) {
  return hadPointerCapture || type === "pointercancel";
}

export function positionNotebookEraserCursor(input: {
  clientX: number;
  clientY: number;
  cursor: HTMLElement;
  cursorDiameter: number;
  previousDiameter: number | null;
  surfaceLeft: number;
  surfaceTop: number;
}) {
  if (input.previousDiameter !== input.cursorDiameter) {
    input.cursor.style.width = `${input.cursorDiameter}px`;
    input.cursor.style.height = `${input.cursorDiameter}px`;
  }
  const left =
    input.clientX - input.surfaceLeft - input.cursorDiameter / 2;
  const top = input.clientY - input.surfaceTop - input.cursorDiameter / 2;
  input.cursor.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  input.cursor.style.opacity = "1";
  return input.cursorDiameter;
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
