import type { NotebookInkTool } from "@/lib/workspace/notebook-ink-types";

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

/**
 * The `buttons` bit a pen sets while its eraser is in contact.
 *
 * From the Pointer Events spec, and what Windows reports for the eraser end
 * of a Surface Pen or a Wacom stylus, and for the eraser button some pens
 * carry on the barrel instead.
 */
export const NOTEBOOK_PEN_ERASER_BUTTONS = 32;

/**
 * The tool a new contact works with.
 *
 * The selected one, unless the pen has been turned over: its eraser end
 * erases whatever is selected, as it does on paper and in every note app on
 * the machines these pens come with. Turned back, the pen writes again with
 * nothing to reselect -- the choice is made per contact, never saved.
 */
export function getNotebookContactTool(input: {
  activeTool: NotebookInkTool;
  buttons: number;
  pointerType: string;
}): NotebookInkTool {
  return input.pointerType === "pen" &&
    (input.buttons & NOTEBOOK_PEN_ERASER_BUTTONS) !== 0
    ? "eraser"
    : input.activeTool;
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
