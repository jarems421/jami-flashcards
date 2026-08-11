import type {
  Editor as JsDrawEditor,
  InputEvt as JsDrawInputEvent,
  PenTool as JsDrawPenTool,
  Pointer as JsDrawPointer,
} from "js-draw";
import { createNotebookChiselStrokeFactory } from "@/lib/workspace/notebook-chisel-stroke";
import { createNotebookSmoothPenStrokeFactory } from "@/lib/workspace/notebook-smooth-pen";
import type { NotebookStrokeColor } from "@/lib/workspace/notebooks";
import {
  getNotebookEraserModeValue,
  getNotebookEraserToolThickness,
  type NotebookEraserMode,
} from "@/lib/workspace/notebook-eraser";
import { getNotebookInkColor } from "@/lib/workspace/notebook-ink-data";
import { NotebookInkSmoother } from "@/lib/workspace/notebook-ink-smoothing";
import {
  clampNotebookPenSmoothing,
  getNotebookPenFeel,
  NOTEBOOK_PEN_SMOOTHING_DEFAULT,
} from "@/lib/workspace/notebook-pen-feel";

export type JsDrawModule = typeof import("js-draw");

export type NotebookInkTool =
  | "pen"
  | "highlighter"
  | "eraser"
  | "select"
  | "text";

/** Everything about the ink editor that a style application depends on. */
export type NotebookInkStyle = {
  activeTool: NotebookInkTool;
  eraserMode: NotebookEraserMode;
  eraserThickness: number;
  highlighterColor: NotebookStrokeColor;
  highlighterThickness: number;
  penColor: NotebookStrokeColor;
  penThickness: number;
  /** How much the pen tidies the line, 0 to 100. See `getNotebookPenFeel`. */
  penSmoothing: number;
};

let jsDrawModulePromise: Promise<JsDrawModule> | null = null;

/** js-draw is ~large and only the notebook needs it, so it loads on demand. */
export function loadJsDraw() {
  jsDrawModulePromise ??= import("js-draw");
  return jsDrawModulePromise;
}

// js-draw quantizes each incoming pointer's canvas position to a grid of
// 10^floor(log10(1/scaleFactor)) canvas units — a whole canvas unit at this
// notebook's typical zoom. The default Bézier fitting used to hide that grid;
// faithful polyline strokes render it as visible stair-steps ("grainy" ink).
// Every pointer still carries its exact screen position, so this mapper
// re-derives the canvas position at full precision before the pen sees it. It
// also smooths the js-draw pointer directly, keeping the browser's original
// PointerEvent lifecycle intact (notably capture/release on rapid pen contact).
export function makePrecisePenInputMapper(
  jsDraw: JsDrawModule,
  editor: JsDrawEditor,
  inkSmoothers: Map<number, NotebookInkSmoother>
) {
  class PrecisePenInputMapper extends jsDraw.InputMapper {
    onEvent(event: JsDrawInputEvent): boolean {
      if (
        event.kind === jsDraw.InputEvtType.PointerDownEvt ||
        event.kind === jsDraw.InputEvtType.PointerMoveEvt ||
        event.kind === jsDraw.InputEvtType.PointerUpEvt
      ) {
        const withExactPosition = (pointer: JsDrawPointer) =>
          pointer.withScreenPosition(pointer.screenPos, editor.viewport);
        let current = withExactPosition(event.current);

        if (event.kind === jsDraw.InputEvtType.PointerDownEvt) {
          inkSmoothers.set(
            current.id,
            new NotebookInkSmoother({
              x: current.screenPos.x,
              y: current.screenPos.y,
              time: current.timeStamp,
            })
          );
        } else {
          /*
           * A stroke ends on the point it was already drawn to, and gains
           * nothing at the lift.
           *
           * js-draw ends a stroke by adding the `pointerup` position and
           * finalising immediately, so whatever that position is becomes a
           * final segment -- one that appears in a single frame, after the pen
           * has left the glass. It is not seen being drawn, it is seen
           * arriving, and that is exactly the ink appearing to carry on past
           * where the stroke was ended.
           *
           * Filtering that position rather than taking it raw made the segment
           * shorter and did not remove it, because filtering still steps
           * towards the lift. The pointer-up carries its own position, some
           * milliseconds of travel beyond the last move -- at speed that is
           * still a visible tick of ink.
           *
           * So the lift holds the filter where it is instead of stepping it.
           * The last point of the stroke is then identical to the last point
           * already painted, which makes a jump impossible rather than small.
           * The cost is that a stroke ends a fraction short of where the pen
           * physically left -- and ink that is not there cannot be seen, where
           * ink arriving late very much can.
           */
          const smoother = inkSmoothers.get(current.id);
          if (smoother) {
            const settled =
              event.kind === jsDraw.InputEvtType.PointerUpEvt
                ? smoother.current()
                : smoother.next({
                    x: current.screenPos.x,
                    y: current.screenPos.y,
                    time: current.timeStamp,
                  });
            current = current.withScreenPosition(
              jsDraw.Vec2.of(settled.x, settled.y),
              editor.viewport
            );
          }
        }

        const handled = this.emit({
          ...event,
          current,
          allPointers: event.allPointers.map((pointer) =>
            pointer.id === current.id ? current : withExactPosition(pointer)
          ),
        });
        if (event.kind === jsDraw.InputEvtType.PointerUpEvt) {
          inkSmoothers.delete(current.id);
        }
        return handled;
      }
      return this.emit(event);
    }
  }
  return new PrecisePenInputMapper();
}

// Pushes the precision/stroke selection straight to js-draw's eraser. Kept
// separate so it can be called imperatively (bypassing the deferred style
// effect), guaranteeing "stroke" maps to FullStroke and "precision" to
// PartialStroke regardless of which tool is active or whether a stale pointer
// is deferring the normal style application.
export function applyNotebookEraserMode(
  editor: JsDrawEditor,
  mode: NotebookEraserMode,
  jsDraw: JsDrawModule
) {
  const eraser = editor.toolController.getMatchingTools(jsDraw.EraserTool)[0];
  const nextMode =
    getNotebookEraserModeValue(mode) === "full-stroke"
      ? jsDraw.EraserMode.FullStroke
      : jsDraw.EraserMode.PartialStroke;
  const modeValue = eraser?.getModeValue();
  if (modeValue && modeValue.get() !== nextMode) modeValue.set(nextMode);
}

/**
 * Converts a nib width in page units into the number js-draw wants.
 *
 * js-draw measures tool thickness in *screen* pixels and divides by the
 * viewport scale to get the width it actually lays down:
 * `width = thickness / viewport.getScaleFactor()`. Passed a page-unit width
 * directly, the pen therefore draws narrower the further in you zoom -- write
 * at 2x and the mark is half the width it would have been, so zooming back out
 * shows thin, shrunken writing. It also made the pen a different weight on a
 * phone than on a desktop, because the fitted scale differs.
 *
 * Multiplying back out pins the mark to the page: the same nib puts down the
 * same width whatever the zoom, which is how writing behaves everywhere else.
 *
 * The eraser deliberately does *not* do this. Its cursor is a ring on the
 * screen and erasing a smaller part of the page as you zoom in is the point of
 * zooming in to erase.
 */
export function getNotebookNibThicknessForViewport(
  editor: JsDrawEditor,
  pageThickness: number
) {
  const scale = editor.viewport.getScaleFactor();
  return pageThickness * (Number.isFinite(scale) && scale > 0 ? scale : 1);
}

/**
 * Pushes the nib width to js-draw for the zoom the viewport is at now.
 *
 * Kept callable on its own because the zoom can change without the style
 * changing, and the style application is skipped when nothing about the style
 * moved. The pen path reasserts this at every contact, exactly as the eraser
 * already reasserts its mode and size.
 */
export function applyNotebookNibThickness(
  editor: JsDrawEditor,
  style: NotebookInkStyle,
  jsDraw: JsDrawModule
) {
  if (style.activeTool !== "pen" && style.activeTool !== "highlighter") return;
  const pen = editor.toolController.getMatchingTools(jsDraw.PenTool)[0];
  if (!pen) return;
  const thickness = getNotebookNibThicknessForViewport(
    editor,
    style.activeTool === "highlighter"
      ? style.highlighterThickness
      : style.penThickness
  );
  if (pen.getThickness() !== thickness) pen.setThickness(thickness);
}

type StrokeShapeTool = "pen" | "highlighter";

/**
 * Remembers which nib each pen tool is currently carrying, and how it was
 * tuned.
 *
 * `setStrokeFactory` has no getter, so without this the factory would be
 * rebuilt on every style application -- including mid-gesture ones, where
 * replacing the factory under an in-progress stroke is not worth risking. The
 * smoothing is part of the key because changing it has to take effect on the
 * next stroke, and only a new factory carries it.
 */
const appliedStrokeShapes = new WeakMap<object, string>();

export function applyNotebookStrokeShape(
  pen: JsDrawPenTool,
  tool: StrokeShapeTool,
  jsDraw: JsDrawModule,
  penSmoothing = NOTEBOOK_PEN_SMOOTHING_DEFAULT
) {
  const applied = `${tool}:${clampNotebookPenSmoothing(penSmoothing)}`;
  if (appliedStrokeShapes.get(pen) === applied) return;

  /*
   * Hold still at the end of a stroke and a line snaps straight. js-draw
   * detects the pause and asks the builder to correct itself; the pen answers
   * that in `autocorrectShape`, which only straightens something that was
   * already reaching for a line.
   *
   * The pen only. A highlighter is laid over words that are already there and
   * has nothing to snap to, and straightening one mid-sweep would be a
   * surprise rather than a help.
   */
  const straightenOnHold = tool === "pen";
  pen.setStrokeFactory(
    tool === "highlighter"
      ? createNotebookChiselStrokeFactory(jsDraw)
      : createNotebookSmoothPenStrokeFactory(
          jsDraw,
          getNotebookPenFeel(penSmoothing)
        )
  );
  if (pen.getStrokeAutocorrectionEnabled() !== straightenOnHold) {
    pen.setStrokeAutocorrectEnabled(straightenOnHold);
  }
  appliedStrokeShapes.set(pen, applied);
}

export function applyNotebookInkStyle(
  editor: JsDrawEditor,
  style: NotebookInkStyle,
  jsDraw: JsDrawModule
) {
  const pens = editor.toolController.getMatchingTools(jsDraw.PenTool);
  const erasers = editor.toolController.getMatchingTools(jsDraw.EraserTool);
  const selections = editor.toolController.getMatchingTools(
    jsDraw.SelectionTool
  );
  const primaryPen = pens[0];
  if (!primaryPen) return;

  // Keep the eraser's mode and thickness in sync on every style application,
  // not only while the eraser is the active tool. js-draw defaults the eraser
  // to FullStroke, so configuring it unconditionally ensures the selected
  // precision/stroke mode is already correct the moment the eraser is enabled.
  applyNotebookEraserMode(editor, style.eraserMode, jsDraw);
  const eraserThickness = getNotebookEraserToolThickness(style.eraserThickness);
  if (erasers[0] && erasers[0].getThickness() !== eraserThickness) {
    erasers[0].setThickness(eraserThickness);
  }

  const requestedPrimaryTool =
    style.activeTool === "pen" || style.activeTool === "highlighter"
      ? primaryPen
      : style.activeTool === "eraser"
        ? erasers[0]
        : style.activeTool === "select"
          ? selections[0]
          : null;
  editor.toolController.getPrimaryTools().forEach((editorTool) => {
    const shouldEnable = editorTool === requestedPrimaryTool;
    if (editorTool.isEnabled() !== shouldEnable) {
      editorTool.setEnabled(shouldEnable);
    }
  });

  if (style.activeTool === "pen" || style.activeTool === "highlighter") {
    // Pen and highlighter share one js-draw tool, so the nib shape has to be
    // swapped with the tool rather than set once at startup.
    applyNotebookStrokeShape(
      primaryPen,
      style.activeTool,
      jsDraw,
      style.penSmoothing
    );
    const selectedColor =
      style.activeTool === "highlighter"
        ? style.highlighterColor
        : style.penColor;
    const { color, opacity } = getNotebookInkColor(
      selectedColor,
      style.activeTool
    );
    const parsed = jsDraw.Color4.fromString(color);
    const parsedColor = jsDraw.Color4.ofRGBA(parsed.r, parsed.g, parsed.b, opacity);
    // Pressure is enabled per contact only for Apple Pencil. Keeping this
    // baseline off gives mouse and desktop-stylus strokes one consistent width.
    const pressureEnabled = false;
    if (!primaryPen.getColor().eq(parsedColor)) primaryPen.setColor(parsedColor);
    applyNotebookNibThickness(editor, style, jsDraw);
    if (primaryPen.getPressureSensitivityEnabled() !== pressureEnabled) {
      primaryPen.setPressureSensitivityEnabled(pressureEnabled);
    }
  }
}

export function areNotebookInkStylesEqual(
  left: NotebookInkStyle | null,
  right: NotebookInkStyle
) {
  return (
    left?.activeTool === right.activeTool &&
    left.eraserMode === right.eraserMode &&
    left.eraserThickness === right.eraserThickness &&
    left.highlighterColor === right.highlighterColor &&
    left.highlighterThickness === right.highlighterThickness &&
    left.penColor === right.penColor &&
    left.penThickness === right.penThickness &&
    left.penSmoothing === right.penSmoothing
  );
}

/**
 * Takes the synchronous snapshot used by route-exit saves. Interaction is
 * checked both before and after export because a pointer can land while
 * js-draw is serializing a large page.
 */
export function serializeNotebookInkSynchronously(
  editor: { toSVG(): { outerHTML: string } } | null,
  ready: boolean,
  isInteracting: () => boolean
): string | null {
  if (!editor || !ready || isInteracting()) return null;
  const svg = editor.toSVG();
  return isInteracting() ? null : svg.outerHTML;
}
