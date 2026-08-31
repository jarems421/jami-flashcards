// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { Editor as JsDrawEditor } from "js-draw";
import { dispatchPreciseNotebookPointerMove } from "@/lib/workspace/notebook-direct-ink-input";

/**
 * The layout of a zoomed page, as far as pointer coordinates are concerned.
 *
 * The ink canvas is given only the visible slice of the sheet and is positioned
 * at that slice's origin, while the surface carrying the pointer handlers still
 * spans the whole sheet. `windowLeft`/`windowTop` is the gap between them --
 * zero on a fitted page, hundreds of pixels once zoomed in.
 */
function buildInkLayout({
  windowLeft,
  windowTop,
  withRenderRegion = true,
}: {
  windowLeft: number;
  windowTop: number;
  withRenderRegion?: boolean;
}) {
  const rect = (element: HTMLElement, left: number, top: number) => {
    element.getBoundingClientRect = () =>
      ({ left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  };

  const surface = document.createElement("div");
  const host = document.createElement("div");
  // The surface sits at the sheet origin; the host at the painted slice.
  rect(surface, 0, 0);
  rect(host, windowLeft, windowTop);

  let region: HTMLElement | null = null;
  if (withRenderRegion) {
    region = document.createElement("div");
    region.className = "imageEditorRenderArea";
    rect(region, windowLeft, windowTop);
    host.appendChild(region);
  }
  document.body.appendChild(host);

  return { host, region, surface };
}

/**
 * Stands in for js-draw's own conversion.
 *
 * `Pointer.ofEvent` takes the position relative to the element it is handed, so
 * reproducing that one subtraction is enough to show whether a move lands where
 * the pen is.
 */
function buildJsDraw() {
  const ofEvent = vi.fn(
    (
      event: PointerEvent,
      down: boolean,
      _viewport: unknown,
      relativeTo: HTMLElement
    ) => {
      const bounds = relativeTo.getBoundingClientRect();
      return {
        id: event.pointerId,
        down,
        screenPos: {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
      };
    }
  );

  return {
    ofEvent,
    runtime: {
      InputEvtType: { PointerMoveEvt: 1 } as typeof import("js-draw")["InputEvtType"],
      Pointer: { ofEvent } as unknown as typeof import("js-draw")["Pointer"],
    },
  };
}

function buildEditor() {
  const onPointerEvent = vi.fn();
  const dispatchInputEvent = vi.fn(() => true);
  return {
    dispatchInputEvent,
    onPointerEvent,
    editor: {
      display: { onPointerEvent } as unknown as JsDrawEditor["display"],
      toolController: {
        dispatchInputEvent,
      } as unknown as JsDrawEditor["toolController"],
      viewport: {} as JsDrawEditor["viewport"],
    },
  };
}

const pointerAt = (clientX: number, clientY: number) =>
  ({ clientX, clientY, pointerId: 7 }) as PointerEvent;

describe("direct notebook ink input", () => {
  it("dispatches every exact move without a minimum-distance gate", () => {
    const { host } = buildInkLayout({ windowLeft: 0, windowTop: 0 });
    const { ofEvent, runtime } = buildJsDraw();
    const { editor, onPointerEvent, dispatchInputEvent } = buildEditor();
    const event = pointerAt(0.35, 0.4);

    const handled = dispatchPreciseNotebookPointerMove({
      editor,
      event,
      host,
      jsDraw: runtime,
    });

    expect(handled).toBe(true);
    expect(onPointerEvent).toHaveBeenCalledWith(event);
    expect(dispatchInputEvent).toHaveBeenCalledWith({
      kind: 1,
      current: ofEvent.mock.results[0]!.value,
      allPointers: [ofEvent.mock.results[0]!.value],
    });
  });

  it("measures against js-draw's render region, not the ink surface", () => {
    const { host, region } = buildInkLayout({ windowLeft: 0, windowTop: 0 });
    const { ofEvent, runtime } = buildJsDraw();
    const { editor } = buildEditor();

    dispatchPreciseNotebookPointerMove({
      editor,
      event: pointerAt(120, 200),
      host,
      jsDraw: runtime,
    });

    expect(ofEvent.mock.calls[0]![3]).toBe(region);
  });

  it("puts a zoomed move under the pen rather than a window away from it", () => {
    // A page scrolled well down at high zoom: the painted slice starts 640px
    // into the sheet, so surface-relative and region-relative disagree by that.
    const windowTop = 640;
    const { host, surface } = buildInkLayout({ windowLeft: 0, windowTop });
    const { ofEvent, runtime } = buildJsDraw();
    const { editor } = buildEditor();
    const event = pointerAt(300, 900);

    dispatchPreciseNotebookPointerMove({ editor, event, host, jsDraw: runtime });

    const dispatched = ofEvent.mock.results[0]!.value;
    // What js-draw's own pointerdown produced, against the same region.
    expect(dispatched.screenPos).toEqual({ x: 300, y: 900 - windowTop });
    // The old behaviour: measured against the full-sheet surface, every move
    // landed `windowTop` below the pen, drawing a line straight down the page.
    const surfaceRelative = event.clientY - surface.getBoundingClientRect().top;
    expect(dispatched.screenPos.y).not.toBe(surfaceRelative);
  });

  it("keeps the horizontal case honest too, near the top of a page", () => {
    // At the top of a sheet the vertical slice offset is clamped to zero, so
    // any displacement is sideways -- the horizontal line users saw there.
    const windowLeft = 384;
    const { host } = buildInkLayout({ windowLeft, windowTop: 0 });
    const { ofEvent, runtime } = buildJsDraw();
    const { editor } = buildEditor();

    dispatchPreciseNotebookPointerMove({
      editor,
      event: pointerAt(700, 90),
      host,
      jsDraw: runtime,
    });

    expect(ofEvent.mock.results[0]!.value.screenPos).toEqual({
      x: 700 - windowLeft,
      y: 90,
    });
  });

  it("leaves a fitted page exactly where it was", () => {
    // No window, no offset: the fix must not move unzoomed drawing at all.
    const { host } = buildInkLayout({ windowLeft: 0, windowTop: 0 });
    const { ofEvent, runtime } = buildJsDraw();
    const { editor } = buildEditor();

    dispatchPreciseNotebookPointerMove({
      editor,
      event: pointerAt(410, 260),
      host,
      jsDraw: runtime,
    });

    expect(ofEvent.mock.results[0]!.value.screenPos).toEqual({ x: 410, y: 260 });
  });

  it("falls back to the host if js-draw ever stops marking its region", () => {
    const { host } = buildInkLayout({
      windowLeft: 0,
      windowTop: 0,
      withRenderRegion: false,
    });
    const { ofEvent, runtime } = buildJsDraw();
    const { editor } = buildEditor();

    dispatchPreciseNotebookPointerMove({
      editor,
      event: pointerAt(10, 10),
      host,
      jsDraw: runtime,
    });

    expect(ofEvent.mock.calls[0]![3]).toBe(host);
  });

  it("does not re-query the DOM on every sample", () => {
    const { host, region } = buildInkLayout({ windowLeft: 0, windowTop: 0 });
    const { ofEvent, runtime } = buildJsDraw();
    const { editor } = buildEditor();
    const querySelector = vi.spyOn(host, "querySelector");

    for (let index = 0; index < 5; index += 1) {
      dispatchPreciseNotebookPointerMove({
        editor,
        event: pointerAt(index, index),
        host,
        jsDraw: runtime,
      });
    }

    expect(querySelector).toHaveBeenCalledTimes(1);
    expect(ofEvent).toHaveBeenCalledTimes(5);
    expect(ofEvent.mock.calls.every((call) => call[3] === region)).toBe(true);
  });
});
