import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  join(process.cwd(), "components/workspace/NotebookInkEditor.tsx"),
  "utf8"
);
const notebookPageSource = readFileSync(
  join(process.cwd(), "app/dashboard/notebooks/[notebookId]/page.tsx"),
  "utf8"
);

describe("notebook ink viewport integration", () => {
  it("suppresses js-draw's internal export boundary on every rerender", () => {
    expect(editorSource).toContain(
      "const rerenderWithoutExportBounds = editor.rerender.bind(editor)"
    );
    expect(editorSource).toContain("editor.rerender = syncViewport");
    expect(editorSource).toContain("rerenderWithoutExportBounds(false)");
  });

  it("updates screen geometry and scale before repainting resized ink", () => {
    const syncStart = editorSource.indexOf("const syncViewport = () =>");
    const syncEnd = editorSource.indexOf(
      "editor.rerender = syncViewport",
      syncStart
    );
    const syncSource = editorSource.slice(syncStart, syncEnd);
    const updateScreen = syncSource.indexOf("viewport.updateScreenSize");
    const resetTransform = syncSource.indexOf("viewport.resetTransform");
    const repaint = syncSource.indexOf("rerenderWithoutExportBounds(false)");

    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    expect(updateScreen).toBeGreaterThanOrEqual(0);
    expect(resetTransform).toBeGreaterThan(updateScreen);
    expect(repaint).toBeGreaterThan(resetTransform);
    expect(syncSource).toContain("measuredDisplaySize.width");
    expect(syncSource).toContain("measuredDisplaySize.height");
    expect(syncSource).not.toContain("clientWidth");
    expect(syncSource).not.toContain("clientHeight");
  });

  it("installs native ink guards before the first writable page is painted", () => {
    const guardStart = editorSource.indexOf(
      "const suppressNativePenGesture = (event: PointerEvent)"
    );
    const guardEffectStart = editorSource.lastIndexOf(
      "useLayoutEffect(() =>",
      guardStart
    );

    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(guardEffectStart).toBeGreaterThanOrEqual(0);
    expect(editorSource.slice(guardEffectStart, guardStart)).toContain(
      "const surface = inkSurfaceRef.current"
    );
  });

  it("retries the iPad touch guard when the initially unmeasured sheet mounts", () => {
    const readiness = notebookPageSource.indexOf(
      "const pageSurfaceReady = Boolean(selectedPage?.id && pageFit.width > 0)"
    );
    const guardStart = notebookPageSource.indexOf(
      "const isStylusTouchEvent = (event: TouchEvent)",
      readiness
    );
    const guardEnd = notebookPageSource.indexOf(
      "}, [pageSurfaceReady, selectedPage?.id]);",
      guardStart
    );

    expect(readiness).toBeGreaterThanOrEqual(0);
    expect(guardStart).toBeGreaterThan(readiness);
    expect(guardEnd).toBeGreaterThan(guardStart);
    expect(notebookPageSource.slice(readiness, guardStart)).toContain(
      "useLayoutEffect(() =>"
    );
    expect(notebookPageSource.slice(guardStart, guardEnd)).toContain(
      'surface.addEventListener("touchstart"'
    );
    expect(notebookPageSource.slice(guardStart, guardEnd)).toContain(
      'surface.addEventListener("touchmove"'
    );
    expect(notebookPageSource.slice(guardStart, guardEnd)).toContain(
      "shouldSuppressNotebookStylusTouch({"
    );
  });

  it("keeps Pencil taps native until toolbar movement becomes a drag", () => {
    const pointerDownStart = notebookPageSource.indexOf(
      "const handleToolbarPointerDown ="
    );
    const pointerMoveStart = notebookPageSource.indexOf(
      "const handleToolbarPointerMove =",
      pointerDownStart
    );
    const pointerLeaveStart = notebookPageSource.indexOf(
      "const handleToolbarPointerLeave =",
      pointerMoveStart
    );
    const finishStart = notebookPageSource.indexOf(
      "const finishToolbarPointer =",
      pointerLeaveStart
    );
    const pointerDownSource = notebookPageSource.slice(
      pointerDownStart,
      pointerMoveStart
    );
    const pointerMoveSource = notebookPageSource.slice(
      pointerMoveStart,
      pointerLeaveStart
    );

    expect(pointerDownStart).toBeGreaterThanOrEqual(0);
    expect(pointerMoveStart).toBeGreaterThan(pointerDownStart);
    expect(pointerLeaveStart).toBeGreaterThan(pointerMoveStart);
    expect(finishStart).toBeGreaterThan(pointerLeaveStart);
    expect(notebookPageSource).toContain(
      'data-notebook-toolbar-action="true"'
    );
    expect(notebookPageSource).toContain(
      'data-notebook-stylus-action="true"'
    );
    expect(pointerDownSource).toContain(
      "if (!startedOnAction) safelySetPointerCapture(toolbar, event.pointerId)"
    );
    expect(pointerMoveSource).toContain("getNotebookToolbarDragThreshold({");
    expect(pointerMoveSource).toContain(
      "safelySetPointerCapture(toolbar, event.pointerId)"
    );
    expect(notebookPageSource.slice(pointerLeaveStart, finishStart)).toContain(
      "toolbarDragRef.current = null"
    );
    expect(notebookPageSource).toContain(
      "onPointerLeave={handleToolbarPointerLeave}"
    );
  });

  it("expects capture loss after pointer cancellation before rapid re-contact", () => {
    expect(editorSource).toContain(
      'expectCaptureLoss: hadPointerCapture || type === "pointercancel"'
    );
    expect(editorSource).not.toContain(
      'expectCaptureLoss: type === "pointerup" && hadPointerCapture'
    );
  });

  it("frame-gates bounded live Pencil preview work", () => {
    expect(editorSource).toContain(
      "getBoundedLivePointerSamples("
    );
    expect(editorSource).toContain("installFrameGatedNotebookPenPreview(");
    expect(editorSource).toContain("event.kind === jsDraw.InputEvtType.PointerMoveEvt");
  });

  it("routes precision erasing through the circular live gesture only", () => {
    const precisionBranchStart = editorSource.indexOf(
      "if (precisionEraserActive) {"
    );
    const stockMoveBranch = editorSource.indexOf(
      '} else if (type === "pointermove") {',
      precisionBranchStart
    );
    const precisionSource = editorSource.slice(
      precisionBranchStart,
      stockMoveBranch
    );

    expect(precisionBranchStart).toBeGreaterThanOrEqual(0);
    expect(stockMoveBranch).toBeGreaterThan(precisionBranchStart);
    expect(precisionSource).toContain("new NotebookPrecisionEraserGesture(");
    expect(precisionSource).toContain("gesture.begin({");
    expect(precisionSource).toContain("getContinuousNotebookEraserSamples(");
    expect(precisionSource).toContain("activeGesture.gesture.finish()");
    expect(precisionSource).toContain("activeGesture.gesture.cancel()");
    expect(precisionSource).not.toContain("editor.handleHTMLPointerEvent");
  });

  it("keeps an active precision gesture routed after tool or mode props change", () => {
    expect(editorSource).toContain("const continuesPrecisionGesture =");
    expect(editorSource).toContain(
      "continuesPrecisionGesture || precisionEraserSelected"
    );
    expect(editorSource.indexOf("const continuesPrecisionGesture =")).toBeLessThan(
      editorSource.indexOf('activeTool === "text" || readOnly')
    );
    expect(editorSource).toContain(
      "precisionEraserGestureRef.current?.gesture.cancel()"
    );
    expect(editorSource).toContain(
      "precisionEraserGestureRef.current?.cursorDiameter ??"
    );
    expect(editorSource).toContain(
      "type === \"pointerdown\" &&\n        existingPrecisionGesture"
    );
  });

  it("moves the circular eraser cursor without React rerenders or wet-canvas clears", () => {
    expect(editorSource).toContain("eraserCursorRef.current");
    expect(editorSource).toContain("const eraserSurfaceOffsetRef = useRef");
    expect(editorSource).toContain(
      "eraserSurfaceOffset = eraserSurfaceOffsetRef.current"
    );
    expect(editorSource).toContain(
      "cursor.style.transform = `translate3d(${left}px, ${top}px, 0)`"
    );
    expect(editorSource).toContain(
      "eraserCursorDiameterRef.current !== cursorDiameter"
    );
    expect(editorSource).toContain("cursor.style.width = `${cursorDiameter}px`");
    expect(editorSource).toContain("cursor.style.height = `${cursorDiameter}px`");
    expect(editorSource).not.toContain("setEraserCursor(");
    expect(editorSource).toContain(
      "previewable.drawPreviewAt = function suppressedDrawPreviewAt() {}"
    );
    expect(editorSource).not.toContain(
      "previewable.clearPreview?.();"
    );
  });

  it("uses the shared small, medium, and large eraser size map", () => {
    expect(notebookPageSource).toContain(
      "NOTEBOOK_ERASER_THICKNESS_BY_SIZE[eraserWidth]"
    );
    expect(notebookPageSource).not.toContain("const ERASER_WIDTH_VALUE");
  });
});
