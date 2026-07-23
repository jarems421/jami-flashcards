import type { Editor as JsDrawEditor } from "js-draw";

type JsDrawPointerRuntime = Pick<
  typeof import("js-draw"),
  "InputEvtType" | "Pointer"
>;

type DirectInkEditor = Pick<
  JsDrawEditor,
  "display" | "toolController" | "viewport"
>;

/**
 * Sends a move directly into js-draw's normal input pipeline.
 *
 * Editor.handleHTMLPointerEvent drops all movement below two CSS pixels before
 * input mappers run. That is particularly noticeable with Apple Pencil, where
 * several high-frequency sub-pixel samples can arrive in one Safari packet.
 * Dispatching here bypasses only that distance gate; the pen tool, input
 * mapper, history, wet-ink renderer, and final stroke commit remain js-draw's.
 */
export function dispatchPreciseNotebookPointerMove(input: {
  editor: DirectInkEditor;
  event: PointerEvent;
  jsDraw: JsDrawPointerRuntime;
  surface: HTMLElement;
}) {
  input.editor.display.onPointerEvent(input.event);
  const pointer = input.jsDraw.Pointer.ofEvent(
    input.event,
    true,
    input.editor.viewport,
    input.surface
  );
  return input.editor.toolController.dispatchInputEvent({
    kind: input.jsDraw.InputEvtType.PointerMoveEvt,
    current: pointer,
    allPointers: [pointer],
  });
}
