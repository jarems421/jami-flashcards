// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNotebookViewportController,
  type NotebookViewportController,
} from "@/hooks/useNotebookViewportController";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

type PagePan = { x: number; y: number };

type HarnessHandles = {
  controller: NotebookViewportController;
  /** The pan currently committed to React state. */
  pan: PagePan;
  setFrameSize: (size: { width: number; height: number }) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: PagePan) => void;
};

let container: HTMLDivElement;
let root: Root;
let handles: HarnessHandles;
let surface: HTMLDivElement;
let frame: HTMLDivElement;

const takeover = vi.fn();
const clearSwipeCandidate = vi.fn();
const swipeEnd = vi.fn();
let navigationLocked = false;
let stylusSuppressing = false;

function stubRect(element: HTMLElement, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
}

function Harness() {
  const surfaceRef = { current: surface };
  const frameRef = { current: frame };
  const [frameSize, setFrameSize] = useState({ width: 800, height: 1000 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PagePan>({ x: 0, y: 0 });

  const controller = useNotebookViewportController({
    frameSize,
    pageZoom: zoom,
    pagePan: pan,
    pageWidth: NOTEBOOK_PAGE_COORDINATE_WIDTH,
    pageHeight: NOTEBOOK_PAGE_COORDINATE_HEIGHT,
    setPageZoom: setZoom,
    setPagePan: setPan,
    pageSurfaceRef: surfaceRef,
    pageFrameRef: frameRef,
    isNavigationLocked: () => navigationLocked,
    isStylusSuppressingTouch: () => stylusSuppressing,
    onPinchTakeover: takeover,
    onClearSwipeCandidate: clearSwipeCandidate,
    onSwipeEnd: swipeEnd,
  });

  useEffect(() => {
    handles = { controller, pan, setFrameSize, setZoom, setPan };
  }, [controller, pan, setFrameSize, setPan, setZoom]);
  return null;
}

/** Minimal stand-in for the React pointer event fields the controller reads. */
function pointerEvent(
  overrides: Partial<{
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
  }> = {}
) {
  const captured = new Set<number>();
  const pointerId = overrides.pointerId ?? 1;
  const target = {
    hasPointerCapture: (id: number) => captured.has(id),
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  };
  return {
    pointerId,
    pointerType: overrides.pointerType ?? "touch",
    clientX: overrides.clientX ?? 0,
    clientY: overrides.clientY ?? 0,
    currentTarget: target,
    nativeEvent: { timeStamp: 0 },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  takeover.mockClear();
  clearSwipeCandidate.mockClear();
  swipeEnd.mockClear();
  navigationLocked = false;
  stylusSuppressing = false;

  container = document.createElement("div");
  document.body.append(container);
  surface = document.createElement("div");
  frame = document.createElement("div");
  stubRect(surface, { left: 100, top: 50, width: 400, height: 560 });
  stubRect(frame, { left: 0, top: 0, width: 800, height: 1000 });

  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("useNotebookViewportController", () => {
  it("derives fit, page size, and travel from the frame", () => {
    const { controller } = handles;
    expect(controller.pageFit.width).toBeGreaterThan(0);
    expect(controller.pageWidthPx).toBeGreaterThan(0);
    expect(controller.pageTrackTravelDistance).toBeGreaterThan(0);
    // At zoom 1 the sheet is pinned to the middle of the frame.
    const { panBounds } = controller.layout;
    expect(panBounds.minX).toBe(panBounds.maxX);
    expect(panBounds.minY).toBe(panBounds.maxY);
  });

  it("frees a zoomed sheet that is still narrower than the frame", () => {
    // Landscape fits the sheet by height, so it stays narrower than the frame
    // until roughly 2x. That whole range used to pin the sheet to the middle of
    // the frame, which is what made a pinch zoom into the centre of the page.
    act(() => {
      handles.setFrameSize({ width: 1194, height: 790 });
    });
    const fitted = handles.controller.layout.panBounds;
    expect(fitted.minX).toBe(fitted.maxX);

    act(() => {
      handles.setZoom(1.5);
    });
    const zoomed = handles.controller.layout.panBounds;
    const pageWidth = handles.controller.pageWidthPx;
    expect(pageWidth).toBeLessThan(1194);
    // Free to sit anywhere, right up to the point of leaving the frame.
    expect(zoomed.minX).toBeLessThan(0);
    expect(zoomed.maxX).toBeGreaterThan(1194 - pageWidth);
  });

  it("ignores non-touch pointers", () => {
    const event = pointerEvent({ pointerType: "pen" });
    let handled = true;
    act(() => {
      handled = handles.controller.handleTouchPointerDown(event);
    });
    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("swallows touch while navigation is locked", () => {
    navigationLocked = true;
    const event = pointerEvent();
    let handled = false;
    act(() => {
      handled = handles.controller.handleTouchPointerDown(event);
    });
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(handles.controller.isPinchActive()).toBe(false);
  });

  it("swallows touch during the stylus cooldown so a palm cannot pan", () => {
    stylusSuppressing = true;
    const event = pointerEvent();
    let handled = false;
    act(() => {
      handled = handles.controller.handleTouchPointerDown(event);
    });
    expect(handled).toBe(true);
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("leaves a single finger to the page instead of starting a pinch", () => {
    let handled = true;
    act(() => {
      handled = handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
    });
    expect(handled).toBe(false);
    expect(handles.controller.isPinchActive()).toBe(false);
    expect(takeover).not.toHaveBeenCalled();
  });

  it("starts an anchored pinch on the second finger and unwinds any swipe", () => {
    act(() => {
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 2, clientX: 400, clientY: 400 })
      );
    });
    expect(handles.controller.isPinchActive()).toBe(true);
    expect(takeover).toHaveBeenCalledTimes(1);
    expect(surface.style.willChange).toBe("transform");
  });

  it("writes a compositor transform while pinching without committing state", () => {
    act(() => {
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 2, clientX: 400, clientY: 400 })
      );
    });
    const zoomBefore = handles.controller.layout.zoom;

    act(() => {
      handles.controller.handleTouchPointerMove(
        pointerEvent({ pointerId: 2, clientX: 600, clientY: 600 })
      );
    });

    expect(surface.style.transform).toContain("scale(");
    // The pinch stays on the compositor until release.
    expect(handles.controller.layout.zoom).toBe(zoomBefore);
  });

  it("only drops the swipe candidate mid-pinch, never re-runs the takeover", () => {
    act(() => {
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 2, clientX: 400, clientY: 400 })
      );
    });
    takeover.mockClear();

    act(() => {
      handles.controller.handleTouchPointerMove(
        pointerEvent({ pointerId: 2, clientX: 500, clientY: 500 })
      );
      handles.controller.handleTouchPointerMove(
        pointerEvent({ pointerId: 2, clientX: 560, clientY: 560 })
      );
    });

    expect(takeover).not.toHaveBeenCalled();
    expect(clearSwipeCandidate).toHaveBeenCalled();
  });

  it("commits zoom and pan when the pinch ends", () => {
    act(() => {
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 2, clientX: 400, clientY: 400 })
      );
      handles.controller.handleTouchPointerMove(
        pointerEvent({ pointerId: 2, clientX: 700, clientY: 700 })
      );
    });

    act(() => {
      handles.controller.handleTouchPointerEnd(pointerEvent({ pointerId: 2 }));
    });

    expect(handles.controller.isPinchActive()).toBe(false);
    expect(handles.controller.layout.zoom).toBeGreaterThan(1);
    expect(swipeEnd).not.toHaveBeenCalled();
  });

  it("delegates a single-finger release to page navigation", () => {
    act(() => {
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
    });

    act(() => {
      handles.controller.handleTouchPointerEnd(pointerEvent({ pointerId: 1 }), {
        allowTextTap: true,
      });
    });

    expect(swipeEnd).toHaveBeenCalledTimes(1);
    expect(swipeEnd.mock.calls[0]?.[1]).toEqual({ allowTextTap: true });
  });

  it("cancelActivePinch reports whether a gesture was running", () => {
    let idleResult = true;
    act(() => {
      idleResult = handles.controller.cancelActivePinch();
    });
    expect(idleResult).toBe(false);

    act(() => {
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 2, clientX: 400, clientY: 400 })
      );
    });

    let activeResult = false;
    act(() => {
      activeResult = handles.controller.cancelActivePinch({
        clearPointers: true,
        commitPan: true,
      });
    });
    expect(activeResult).toBe(true);
    expect(handles.controller.isPinchActive()).toBe(false);
    // The live transform is dropped back to a plain translate.
    expect(surface.style.transform).not.toContain("scale(");
  });

  it("does not commit a pan when no pinch was running", () => {
    // The resize/teardown paths call this on every run. Committing a pan
    // unconditionally would push a state update on every frame change.
    act(() => {
      handles.setPan({ x: 12, y: 34 });
    });
    const panBefore = handles.pan;
    expect(panBefore).toEqual({ x: 12, y: 34 });

    act(() => {
      handles.controller.cancelActivePinch({
        clearPointers: true,
        commitPan: true,
      });
    });

    expect(handles.pan).toBe(panBefore);
  });

  it("resetViewportGestures clears live pan for a notebook switch", () => {
    act(() => {
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 2, clientX: 400, clientY: 400 })
      );
      handles.controller.handleTouchPointerMove(
        pointerEvent({ pointerId: 2, clientX: 700, clientY: 700 })
      );
    });

    act(() => {
      handles.controller.resetViewportGestures();
    });

    expect(handles.controller.isPinchActive()).toBe(false);
    expect(handles.controller.pagePanLiveRef.current).toEqual({ x: 0, y: 0 });
  });

  it("recovers when a second finger arrives with no measurable surface", () => {
    stubRect(surface, { left: 0, top: 0, width: 0, height: 0 });
    act(() => {
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 })
      );
      handles.controller.handleTouchPointerDown(
        pointerEvent({ pointerId: 2, clientX: 400, clientY: 400 })
      );
    });
    // No pinch state is created, so a later move cannot divide by zero.
    expect(handles.controller.isPinchActive()).toBe(false);
    act(() => {
      handles.controller.handleTouchPointerMove(
        pointerEvent({ pointerId: 2, clientX: 500, clientY: 500 })
      );
    });
    expect(handles.controller.layout.zoom).toBe(1);
  });
});
