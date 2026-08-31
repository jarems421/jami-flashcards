import { getNotebookInkViewportScale } from "@/lib/workspace/notebook-viewport";
import type { NotebookInkRenderWindow } from "@/lib/workspace/notebook-ink-window";

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

/**
 * The two origins an eraser pointer has to be measured from.
 *
 * They are the same element on a fitted page and different ones as soon as it
 * is zoomed, which is why they cannot stay a single offset.
 *
 * `surface` places the cursor ring, a DOM element inside the ink surface, so it
 * has to be measured from that surface. `region` feeds js-draw's
 * `screenToCanvas`, which measures from js-draw's own rendering region -- and
 * on a zoomed page the ink canvas is given only the visible slice of the sheet
 * and positioned at that slice's origin. Measuring erase geometry from the
 * full-sheet surface counted the slice offset twice and rubbed out ink a window
 * away from the nib.
 */
export type NotebookInkPointerOrigins = {
  surface: { left: number; top: number };
  region: { left: number; top: number };
};

export function getNotebookInkPointerOrigins(
  surface: HTMLElement,
  region: HTMLElement | null
): NotebookInkPointerOrigins {
  const surfaceRect = surface.getBoundingClientRect();
  const regionRect = region ? region.getBoundingClientRect() : surfaceRect;
  return {
    surface: { left: surfaceRect.left, top: surfaceRect.top },
    region: { left: regionRect.left, top: regionRect.top },
  };
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

/**
 * How still a hand actually is, and how long it has to stay that way.
 *
 * js-draw asks for an average speed under 8.5 screen pixels a second before it
 * will call a pen stationary. That is under a seventh of a pixel per frame --
 * far below what a hand resting a stylus on glass does. Every time the tremor
 * crosses it the timer starts again, so the snap can take several seconds to
 * arrive or never arrive at all, which reads as "hold it longer" rather than as
 * a threshold nobody can meet.
 *
 * The wait is longer than js-draw's half second on purpose. Half a second of
 * stillness happens in the middle of ordinary writing; a full second is a
 * deliberate pause, and it is the pause -- not the shape of the stroke -- that
 * is really being asked about.
 */
export const NOTEBOOK_STRAIGHTEN_HOLD = {
  /**
   * Screen pixels a second, averaged. Room for a hand, not for a stroke.
   *
   * This was the broken one: 8.5 is under a seventh of a pixel per frame and a
   * hand resting a stylus on glass never gets there, so the timer restarted on
   * every tremor and the snap arrived late or not at all.
   */
  maxSpeed: 25,
  /**
   * How far the tip may drift over the hold, in screen pixels.
   *
   * Left near js-draw's, and that matters more than it looks: with the timer
   * running for a second, this is what decides how slowly somebody can be
   * writing and still trip the snap by accident. Ten pixels of drift over a
   * second means anything above ten pixels a second is safe. Raising it to
   * sixteen, as this briefly was, doubled the band of speeds that could snap
   * mid-word -- and a snap mid-word does not just tidy the stroke, it turns the
   * rest of it into a line that swings around after the pen.
   */
  maxRadius: 10,
  /**
   * Longer than js-draw's half second on purpose. Half a second of stillness
   * happens in the middle of ordinary writing; a second is a deliberate pause,
   * and it is the pause being asked about rather than the shape of the stroke.
   */
  minTimeSeconds: 1,
};
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
