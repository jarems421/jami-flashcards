import { describe, expect, it } from "vitest";
import {
  appendInkPoints,
  clampNotebookPageZoom,
  finalizeInkStroke,
  getNotebookPageIndexAfterSwipe,
  getNotebookSwipeDirection,
  getNotebookPageZoomAfterPinch,
  getPinchDistance,
  getPointerClientSamples,
  mapClientPointToNotebookPage,
  normalizePointerPressure,
  shouldAppendInkPoint,
  shouldPointerDraw,
  shouldPointerSwipePages,
} from "@/lib/workspace/notebook-inking";

describe("notebook inking helpers", () => {
  it("maps pointer samples into notebook page coordinates", () => {
    const point = mapClientPointToNotebookPage({
      clientX: 150,
      clientY: 75,
      rect: { left: 100, top: 50, width: 200, height: 100 },
      width: 900,
      height: 620,
    });

    expect(point).toEqual({ x: 225, y: 155 });
  });

  it("collects coalesced pointer samples when the browser provides them", () => {
    const event = {
      clientX: 10,
      clientY: 20,
      getCoalescedEvents: () => [
        { clientX: 11, clientY: 21, pressure: 0.25 },
        { clientX: 12, clientY: 22, pressure: 0 },
      ],
    } as unknown as PointerEvent;

    expect(getPointerClientSamples(event)).toEqual([
      { clientX: 11, clientY: 21, pressure: 0.25 },
      { clientX: 12, clientY: 22, pressure: 0.5 },
    ]);
  });

  it("falls back to the raw pointer event when there are no coalesced samples", () => {
    const event = {
      clientX: 10,
      clientY: 20,
      pressure: 0,
      getCoalescedEvents: () => [],
    } as unknown as PointerEvent;

    expect(getPointerClientSamples(event)).toEqual([{ clientX: 10, clientY: 20, pressure: 0.5 }]);
  });

  it("normalizes missing or zero pressure to a useful live-ink fallback", () => {
    expect(normalizePointerPressure(undefined)).toBe(0.5);
    expect(normalizePointerPressure(0)).toBe(0.5);
    expect(normalizePointerPressure(0.35)).toBe(0.35);
    expect(normalizePointerPressure(2)).toBe(1);
  });

  it("keeps the first few points before filtering tiny duplicate movements", () => {
    expect(shouldAppendInkPoint([{ x: 10, y: 10 }], { x: 10.2, y: 10.2 }, 1.35)).toBe(
      true
    );
    expect(
      shouldAppendInkPoint(
        [
          { x: 10, y: 10 },
          { x: 10.2, y: 10.2 },
          { x: 10.4, y: 10.4 },
        ],
        { x: 10.5, y: 10.5 },
        1.35
      )
    ).toBe(false);
    expect(
      shouldAppendInkPoint(
        [
          { x: 10, y: 10 },
          { x: 10.2, y: 10.2 },
          { x: 10.4, y: 10.4 },
        ],
        { x: 13, y: 10 },
        1.35
      )
    ).toBe(true);

    expect(
      appendInkPoints(
        [{ x: 10, y: 10 }],
        [
          { x: 10.1, y: 10.1 },
          { x: 15, y: 15 },
        ],
        1_200
      )
    ).toEqual([
      { x: 10, y: 10 },
      { x: 10.1, y: 10.1 },
      { x: 15, y: 15 },
    ]);
  });

  it("finalizes active strokes without changing the existing persisted shape", () => {
    const stroke = finalizeInkStroke({
      points: [{ x: 10, y: 10 }],
      color: "black",
      tool: "pen",
      width: 5,
    });

    expect(stroke).toEqual({
      points: [{ x: 10, y: 10 }],
      color: "black",
      tool: "pen",
      width: 5,
    });
    expect(stroke).not.toHaveProperty("pressure");
    expect(stroke?.points[0]).not.toHaveProperty("pressure");
  });

  it("drops empty active strokes", () => {
    expect(
      finalizeInkStroke({
        points: [],
        color: "black",
        tool: "pen",
        width: 5,
      })
    ).toBeNull();
  });

  it("routes stylus and mouse to drawing while touch is reserved for page swipes", () => {
    expect(shouldPointerDraw("pen", "pen")).toBe(true);
    expect(shouldPointerDraw("mouse", "eraser")).toBe(true);
    expect(shouldPointerDraw("touch", "pen")).toBe(false);
    expect(shouldPointerDraw("pen", "text")).toBe(false);
    expect(shouldPointerSwipePages("touch")).toBe(true);
    expect(shouldPointerSwipePages("pen")).toBe(false);
    expect(shouldPointerSwipePages("mouse")).toBe(false);
  });

  it("detects intentional horizontal finger swipes for page navigation", () => {
    expect(
      getNotebookSwipeDirection({ startX: 200, startY: 100, currentX: 120, currentY: 108 })
    ).toBe("next");
    expect(
      getNotebookSwipeDirection({ startX: 120, startY: 100, currentX: 200, currentY: 108 })
    ).toBe("previous");
    expect(
      getNotebookSwipeDirection({ startX: 120, startY: 100, currentX: 160, currentY: 102 })
    ).toBeNull();
    expect(
      getNotebookSwipeDirection({ startX: 120, startY: 100, currentX: 200, currentY: 190 })
    ).toBeNull();
  });

  it("keeps page swipe navigation inside available page bounds", () => {
    expect(getNotebookPageIndexAfterSwipe({ currentIndex: 0, pageCount: 3, direction: "previous" })).toBe(0);
    expect(getNotebookPageIndexAfterSwipe({ currentIndex: 0, pageCount: 3, direction: "next" })).toBe(1);
    expect(getNotebookPageIndexAfterSwipe({ currentIndex: 2, pageCount: 3, direction: "next" })).toBe(2);
    expect(getNotebookPageIndexAfterSwipe({ currentIndex: -1, pageCount: 3, direction: "next" })).toBe(-1);
  });

  it("calculates bounded notebook page pinch zoom", () => {
    expect(getPinchDistance({ clientX: 0, clientY: 0, pressure: 0.5 }, { clientX: 3, clientY: 4, pressure: 0.5 })).toBe(5);
    expect(getNotebookPageZoomAfterPinch({ startDistance: 100, currentDistance: 150, startZoom: 1 })).toBe(1.5);
    expect(getNotebookPageZoomAfterPinch({ startDistance: 100, currentDistance: 500, startZoom: 1 })).toBe(2.4);
    expect(getNotebookPageZoomAfterPinch({ startDistance: 100, currentDistance: 20, startZoom: 1 })).toBe(0.85);
    expect(clampNotebookPageZoom(Number.NaN)).toBe(1);
  });
});
