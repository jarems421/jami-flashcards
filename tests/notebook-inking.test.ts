import { describe, expect, it } from "vitest";
import {
  appendInkPoints,
  finalizeInkStroke,
  getNotebookPageIndexAfterSwipe,
  getNotebookSwipeDirection,
  getPointerClientSamples,
  mapClientPointToNotebookPage,
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
        { clientX: 11, clientY: 21 },
        { clientX: 12, clientY: 22 },
      ],
    } as unknown as PointerEvent;

    expect(getPointerClientSamples(event)).toEqual([
      { clientX: 11, clientY: 21 },
      { clientX: 12, clientY: 22 },
    ]);
  });

  it("falls back to the raw pointer event when there are no coalesced samples", () => {
    const event = {
      clientX: 10,
      clientY: 20,
      getCoalescedEvents: () => [],
    } as unknown as PointerEvent;

    expect(getPointerClientSamples(event)).toEqual([{ clientX: 10, clientY: 20 }]);
  });

  it("filters tiny duplicate movements before they bloat stroke data", () => {
    expect(shouldAppendInkPoint([{ x: 10, y: 10 }], { x: 10.2, y: 10.2 }, 1.35)).toBe(
      false
    );
    expect(shouldAppendInkPoint([{ x: 10, y: 10 }], { x: 13, y: 10 }, 1.35)).toBe(true);

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
});
