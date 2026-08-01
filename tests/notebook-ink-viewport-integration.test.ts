// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ToolbarIconButton from "@/components/workspace/NotebookToolbarIconButton";
import {
  dispatchBatchedNotebookPointerSamples,
  installNotebookInkViewportSynchronizer,
  installNotebookNativeInkGuards,
  positionNotebookEraserCursor,
  shouldContinueNotebookPrecisionGesture,
  shouldExpectNotebookCaptureLoss,
  shouldUseNotebookPrecisionGesture,
  suppressNotebookEraserPreview,
} from "@/lib/workspace/notebook-ink-runtime";
import { makePrecisePenInputMapper } from "@/lib/workspace/notebook-js-draw";

describe("notebook ink viewport integration", () => {
  it("synchronizes screen geometry and scale before every boundary-free repaint", () => {
    const calls: string[] = [];
    let screen = { width: 0, height: 0 };
    let transform = { x: 1, y: 1 };
    const editor = {
      rerender(showExportRect?: boolean) {
        calls.push(`repaint:${String(showExportRect)}`);
      },
      viewport: {
        getScreenRectSize: () => ({
          eq: (other: { width: number; height: number }) =>
            other.width === screen.width && other.height === screen.height,
        }),
        canvasToScreenTransform: {
          eq: (other: { x: number; y: number }) =>
            other.x === transform.x && other.y === transform.y,
        },
        updateScreenSize(next: { width: number; height: number }) {
          calls.push("screen");
          screen = next;
        },
        resetTransform(next: { x: number; y: number }) {
          calls.push("transform");
          transform = next;
        },
      },
    };

    installNotebookInkViewportSynchronizer({
      createScreenSize: (width, height) => ({ width, height }),
      createTransform: (x, y) => ({ x, y }),
      editor,
      getDisplaySize: () => ({ width: 500, height: 1000 }),
      pageHeight: 2000,
      pageWidth: 1000,
      shouldSkip: () => false,
    });

    editor.rerender();
    expect(calls).toEqual(["screen", "transform", "repaint:false"]);
    expect(screen).toEqual({ width: 500, height: 1000 });
    expect(transform).toEqual({ x: 0.5, y: 0.5 });

    calls.length = 0;
    editor.rerender();
    expect(calls).toEqual(["repaint:false"]);
  });

  it("installs cancelable native pen guards and removes them cleanly", () => {
    const surface = document.createElement("div");
    const removeGuards = installNotebookNativeInkGuards(
      surface,
      (event) => event.pointerType === "pen"
    );
    const penDown = new Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    }) as PointerEvent;
    Object.defineProperty(penDown, "pointerType", { value: "pen" });

    expect(surface.dispatchEvent(penDown)).toBe(false);
    expect(penDown.defaultPrevented).toBe(true);

    removeGuards();
    const afterCleanup = new Event("pointermove", {
      bubbles: true,
      cancelable: true,
    }) as PointerEvent;
    Object.defineProperty(afterCleanup, "pointerType", { value: "pen" });
    expect(surface.dispatchEvent(afterCleanup)).toBe(true);
    expect(afterCleanup.defaultPrevented).toBe(false);
  });

  it("marks toolbar controls as native drag candidates", () => {
    const html = renderToStaticMarkup(
      createElement(ToolbarIconButton, {
        label: "Pen",
        icon: "pen",
      })
    );

    expect(html).toContain('data-notebook-toolbar-action="true"');
    expect(html).toContain('aria-label="Pen"');
  });

  it("expects capture loss after pointer cancellation and captured release", () => {
    expect(shouldExpectNotebookCaptureLoss("pointercancel", false)).toBe(true);
    expect(shouldExpectNotebookCaptureLoss("pointerup", true)).toBe(true);
    expect(shouldExpectNotebookCaptureLoss("pointerup", false)).toBe(false);
  });

  it("batches exact live Pencil samples synchronously, including failure cleanup", () => {
    const calls: string[] = [];
    const batch = {
      beginBatch: () => calls.push("begin"),
      endBatch: () => calls.push("end"),
    };

    dispatchBatchedNotebookPointerSamples({
      batch,
      samples: [1, 2, 3],
      dispatch: (sample) => calls.push(`sample:${sample}`),
    });
    expect(calls).toEqual([
      "begin",
      "sample:1",
      "sample:2",
      "sample:3",
      "end",
    ]);

    calls.length = 0;
    expect(() =>
      dispatchBatchedNotebookPointerSamples({
        batch,
        samples: [1],
        dispatch: () => {
          calls.push("sample");
          throw new Error("dispatch failed");
        },
      })
    ).toThrow("dispatch failed");
    expect(calls).toEqual(["begin", "sample", "end"]);
  });

  it("re-derives pointer coordinates against the current js-draw viewport", () => {
    let emitted: unknown;
    class InputMapper {
      emit(event: unknown) {
        emitted = event;
        return true;
      }
    }
    const viewport = { id: "viewport" };
    const withScreenPosition = vi.fn(function (
      this: { id: number; screenPos: { x: number; y: number }; timeStamp: number },
      screenPos: { x: number; y: number },
      nextViewport: unknown
    ) {
      expect(nextViewport).toBe(viewport);
      return { ...this, screenPos, withScreenPosition };
    });
    const pointer = {
      id: 7,
      screenPos: { x: 10.25, y: 20.75 },
      timeStamp: 4,
      withScreenPosition,
    };
    const jsDraw = {
      InputMapper,
      InputEvtType: {
        PointerDownEvt: 1,
        PointerMoveEvt: 2,
        PointerUpEvt: 3,
      },
      Vec2: { of: (x: number, y: number) => ({ x, y }) },
    };
    const mapper = makePrecisePenInputMapper(
      jsDraw as never,
      { viewport } as never,
      new Map()
    ) as unknown as { onEvent(event: unknown): boolean };

    expect(
      mapper.onEvent({
        kind: jsDraw.InputEvtType.PointerMoveEvt,
        current: pointer,
        allPointers: [pointer],
      })
    ).toBe(true);
    expect(withScreenPosition).toHaveBeenCalledWith(pointer.screenPos, viewport);
    expect((emitted as { current: { screenPos: unknown } }).current.screenPos).toBe(
      pointer.screenPos
    );
  });

  it("keeps an active precision gesture routed after tool props change", () => {
    const continuing = shouldContinueNotebookPrecisionGesture({
      activePointerId: 17,
      pointerId: 17,
      type: "pointermove",
    });
    expect(continuing).toBe(true);
    expect(
      shouldUseNotebookPrecisionGesture({
        continuing,
        precisionEraserSelected: false,
      })
    ).toBe(true);
    expect(
      shouldContinueNotebookPrecisionGesture({
        activePointerId: 17,
        pointerId: 17,
        type: "pointerdown",
      })
    ).toBe(false);
  });

  it("moves the circular eraser cursor directly without wet-canvas work", () => {
    const cursor = document.createElement("div");
    const diameter = positionNotebookEraserCursor({
      clientX: 80,
      clientY: 60,
      cursor,
      cursorDiameter: 20,
      previousDiameter: null,
      surfaceLeft: 10,
      surfaceTop: 5,
    });

    expect(diameter).toBe(20);
    expect(cursor.style.width).toBe("20px");
    expect(cursor.style.height).toBe("20px");
    expect(cursor.style.transform).toBe("translate3d(60px, 45px, 0)");
    expect(cursor.style.opacity).toBe("1");

    const originalPreview = vi.fn();
    const eraser = { drawPreviewAt: originalPreview };
    suppressNotebookEraserPreview(eraser);
    eraser.drawPreviewAt();
    expect(originalPreview).not.toHaveBeenCalled();
  });
});
