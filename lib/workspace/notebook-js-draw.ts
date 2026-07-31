import type {
  Editor as JsDrawEditor,
  InputEvt as JsDrawInputEvent,
  Pointer as JsDrawPointer,
} from "js-draw";
import type { NotebookStrokeColor } from "@/lib/workspace/notebooks";
import {
  getNotebookEraserModeValue,
  getNotebookEraserToolThickness,
  type NotebookEraserMode,
} from "@/lib/workspace/notebook-eraser";
import { getNotebookInkColor } from "@/lib/workspace/notebook-ink-data";
import { NotebookInkSmoother } from "@/lib/workspace/notebook-ink-smoothing";

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
        } else if (event.kind === jsDraw.InputEvtType.PointerMoveEvt) {
          const smoother = inkSmoothers.get(current.id);
          if (smoother) {
            const filtered = smoother.next({
              x: current.screenPos.x,
              y: current.screenPos.y,
              time: current.timeStamp,
            });
            current = current.withScreenPosition(
              jsDraw.Vec2.of(filtered.x, filtered.y),
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
  const eraserThickness = getNotebookEraserToolThickness(
    style.eraserMode,
    style.eraserThickness
  );
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
    const thickness =
      style.activeTool === "highlighter"
        ? style.highlighterThickness
        : style.penThickness;
    // Pressure is enabled per contact only for Apple Pencil. Keeping this
    // baseline off gives mouse and desktop-stylus strokes one consistent width.
    const pressureEnabled = false;
    if (!primaryPen.getColor().eq(parsedColor)) primaryPen.setColor(parsedColor);
    if (primaryPen.getThickness() !== thickness) {
      primaryPen.setThickness(thickness);
    }
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
    left.penThickness === right.penThickness
  );
}
