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
 * The class js-draw puts on the element it measures pointer events against.
 *
 * `Editor.renderingRegion` is private, so it cannot be read off the editor. It
 * is a child of the element js-draw was mounted in and carries this class, so
 * the host is enough to find it.
 */
const JS_DRAW_RENDER_REGION_CLASS = "imageEditorRenderArea";

/**
 * Which element a pointer's position is measured from, cached per host.
 *
 * Resolved lazily rather than at mount: js-draw builds its DOM inside the host
 * during construction, and this runs on a pointer path that must not pay for a
 * query per sample. A WeakMap so a replaced editor's host does not keep its
 * old region alive.
 */
const renderRegions = new WeakMap<HTMLElement, HTMLElement>();

export function getJsDrawPointerReferenceElement(
  host: HTMLElement | null
): HTMLElement | null {
  if (!host) return null;
  const cached = renderRegions.get(host);
  if (cached?.isConnected) return cached;

  const region = host.querySelector<HTMLElement>(
    `.${JS_DRAW_RENDER_REGION_CLASS}`
  );
  // The host is the right answer's parent and shares its origin in every
  // layout js-draw builds, so it is a safe stand-in if the class ever moves.
  const reference = region ?? host;
  renderRegions.set(host, reference);
  return reference;
}

/**
 * Sends a move directly into js-draw's normal input pipeline.
 *
 * Editor.handleHTMLPointerEvent drops all movement below two CSS pixels before
 * input mappers run. That is particularly noticeable with Apple Pencil, where
 * several high-frequency sub-pixel samples can arrive in one Safari packet.
 * Dispatching here bypasses only that distance gate; the pen tool, input
 * mapper, history, wet-ink renderer, and final stroke commit remain js-draw's.
 *
 * The position is measured against js-draw's own rendering region, and that is
 * load-bearing rather than incidental. js-draw measures every event it handles
 * itself -- the pointerdown that starts the stroke included -- against that
 * element, and on a zoomed page it does not sit where the ink surface does:
 * the ink canvas is given only the visible slice of the sheet, positioned at
 * the slice's origin, and the viewport transform already carries that offset.
 * Measuring a move against the full-sheet surface instead counts the offset a
 * second time. The stroke then began under the pen and continued a window
 * away from it -- a straight line down a scrolled page, sideways near its top.
 */
export function dispatchPreciseNotebookPointerMove(input: {
  editor: DirectInkEditor;
  event: PointerEvent;
  /** The element js-draw was mounted in. */
  host: HTMLElement;
  jsDraw: JsDrawPointerRuntime;
}) {
  input.editor.display.onPointerEvent(input.event);
  const pointer = input.jsDraw.Pointer.ofEvent(
    input.event,
    true,
    input.editor.viewport,
    getJsDrawPointerReferenceElement(input.host) ?? input.host
  );
  return input.editor.toolController.dispatchInputEvent({
    kind: input.jsDraw.InputEvtType.PointerMoveEvt,
    current: pointer,
    allPointers: [pointer],
  });
}
