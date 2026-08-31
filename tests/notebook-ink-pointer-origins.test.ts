// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { getNotebookInkPointerOrigins } from "@/lib/workspace/notebook-ink-runtime";
import { getJsDrawPointerReferenceElement } from "@/lib/workspace/notebook-direct-ink-input";

function elementAt(left: number, top: number, className?: string) {
  const element = document.createElement("div");
  if (className) element.className = className;
  element.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left,
      bottom: top,
      width: 0,
      height: 0,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}

/**
 * A zoomed page: the ink canvas is given only the visible slice and sits at
 * that slice's origin, while the surface still spans the whole sheet.
 */
function zoomedLayout({ left, top }: { left: number; top: number }) {
  const surface = elementAt(0, 0);
  const host = elementAt(left, top);
  const region = elementAt(left, top, "imageEditorRenderArea");
  host.appendChild(region);
  document.body.appendChild(host);
  return { host, region, surface };
}

describe("eraser pointer origins", () => {
  it("keeps the cursor on the surface and the erase geometry on the region", () => {
    const { host, surface } = zoomedLayout({ left: 384, top: 640 });

    const origins = getNotebookInkPointerOrigins(
      surface,
      getJsDrawPointerReferenceElement(host)
    );

    // The cursor ring is a DOM child of the surface, so it must stay measured
    // from the surface or it would stop sitting under the nib.
    expect(origins.surface).toEqual({ left: 0, top: 0 });
    // Erase geometry goes through js-draw's screenToCanvas, which measures
    // from js-draw's own region. Sharing one offset rubbed out ink a window
    // away from the nib once zoomed.
    expect(origins.region).toEqual({ left: 384, top: 640 });
    expect(origins.region).not.toEqual(origins.surface);
  });

  it("puts an erase at the pen rather than a window below it", () => {
    const windowTop = 640;
    const { host, surface } = zoomedLayout({ left: 0, top: windowTop });
    const origins = getNotebookInkPointerOrigins(
      surface,
      getJsDrawPointerReferenceElement(host)
    );

    const pointer = { clientX: 300, clientY: 900 };
    const erasePoint = {
      x: pointer.clientX - origins.region.left,
      y: pointer.clientY - origins.region.top,
    };
    const cursorPoint = {
      x: pointer.clientX - origins.surface.left,
      y: pointer.clientY - origins.surface.top,
    };

    expect(erasePoint).toEqual({ x: 300, y: 900 - windowTop });
    // The ring and the erase legitimately differ: they are placed in different
    // coordinate spaces, which is the whole reason they are two offsets.
    expect(cursorPoint).toEqual({ x: 300, y: 900 });
  });

  it("collapses to one offset on a fitted page, changing nothing", () => {
    const surface = elementAt(0, 0);
    const host = elementAt(0, 0);
    host.appendChild(elementAt(0, 0, "imageEditorRenderArea"));

    const origins = getNotebookInkPointerOrigins(
      surface,
      getJsDrawPointerReferenceElement(host)
    );

    expect(origins.region).toEqual(origins.surface);
  });

  it("falls back to the surface when there is no region to measure from", () => {
    const surface = elementAt(12, 34);

    const origins = getNotebookInkPointerOrigins(surface, null);

    expect(origins.region).toEqual({ left: 12, top: 34 });
    expect(origins.surface).toEqual({ left: 12, top: 34 });
  });
});
