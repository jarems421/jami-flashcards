import { describe, expect, it } from "vitest";
import {
  appendInkPoints,
  clampNotebookPageZoom,
  clampNotebookThicknessPercent,
  finalizeInkStroke,
  getHighlighterWidthFromPercent,
  getNotebookPageIndexAfterSwipe,
  getNotebookPageZoomAfterPinch,
  getNotebookSwipeDirection,
  getPenWidthFromPercent,
  getPinchDistance,
  getPointerClientSamples,
  mapClientPointToNotebookPage,
  normalizePointerPressure,
  shouldAppendInkPoint,
  shouldPointerDraw,
  shouldPointerSwipePages,
} from "@/lib/workspace/notebook-inking";
import {
  getFreehandOutline,
  getSvgPathFromStrokeOutline,
  interpolateInkPoints,
  normalizeInkPressure,
  normalizeInkTime,
  normalizeTimedInkPoint,
} from "@/lib/workspace/notebook-ink-engine";

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

  it("maps percentage thickness controls to pen and highlighter widths", () => {
    expect(clampNotebookThicknessPercent(Number.NaN)).toBe(50);
    expect(clampNotebookThicknessPercent(-20)).toBe(0);
    expect(clampNotebookThicknessPercent(24.6)).toBe(25);
    expect(clampNotebookThicknessPercent(140)).toBe(100);

    expect(getPenWidthFromPercent(0)).toBe(2);
    expect(getPenWidthFromPercent(25)).toBe(4);
    expect(getPenWidthFromPercent(50)).toBe(6);
    expect(getPenWidthFromPercent(75)).toBe(8);
    expect(getPenWidthFromPercent(100)).toBe(10);
    expect(getPenWidthFromPercent("bad")).toBe(6);

    expect(getHighlighterWidthFromPercent(0)).toBe(10);
    expect(getHighlighterWidthFromPercent(25)).toBe(15);
    expect(getHighlighterWidthFromPercent(50)).toBe(20);
    expect(getHighlighterWidthFromPercent(75)).toBe(25);
    expect(getHighlighterWidthFromPercent(100)).toBe(30);
    expect(getHighlighterWidthFromPercent("bad")).toBe(20);
  });

  it("collects coalesced pointer samples when the browser provides them", () => {
    const event = {
      clientX: 10,
      clientY: 20,
      getCoalescedEvents: () => [
        { clientX: 11, clientY: 21, pressure: 0.25, timeStamp: 7 },
        { clientX: 12, clientY: 22, pressure: 0, timeStamp: 11 },
      ],
      timeStamp: 5,
    } as unknown as PointerEvent;

    expect(getPointerClientSamples(event)).toEqual([
      { clientX: 11, clientY: 21, pressure: 0.25, time: 7 },
      { clientX: 12, clientY: 22, pressure: 0.5, time: 11 },
    ]);
  });

  it("falls back to the raw pointer event when there are no coalesced samples", () => {
    const event = {
      clientX: 10,
      clientY: 20,
      pressure: 0,
      timeStamp: 13,
      getCoalescedEvents: () => [],
    } as unknown as PointerEvent;

    expect(getPointerClientSamples(event)).toEqual([
      { clientX: 10, clientY: 20, pressure: 0.5, time: 13 },
    ]);
  });

  it("normalizes missing or zero pressure and timing to useful ink fallbacks", () => {
    expect(normalizePointerPressure(undefined)).toBe(0.5);
    expect(normalizePointerPressure(0)).toBe(0.5);
    expect(normalizePointerPressure(0.35)).toBe(0.35);
    expect(normalizePointerPressure(2)).toBe(1);
    expect(normalizeInkPressure(-1)).toBe(0.5);
    expect(normalizeInkTime(undefined, 24)).toBe(24);
    expect(normalizeInkTime(-1, 24)).toBe(24);
    expect(normalizeInkTime(24.6)).toBe(25);
    expect(normalizeTimedInkPoint({ x: 1, y: 2 }, 32)).toEqual({
      x: 1,
      y: 2,
      pressure: 0.5,
      time: 32,
    });
  });

  it("protects the first five stroke samples before filtering tiny movements", () => {
    expect(
      shouldAppendInkPoint(
        [
          { x: 10, y: 10 },
          { x: 10.1, y: 10.1 },
          { x: 10.2, y: 10.2 },
          { x: 10.3, y: 10.3 },
        ],
        { x: 10.4, y: 10.4 },
        1.35
      )
    ).toBe(true);
    expect(
      shouldAppendInkPoint(
        [
          { x: 10, y: 10 },
          { x: 10.1, y: 10.1 },
          { x: 10.2, y: 10.2 },
          { x: 10.3, y: 10.3 },
          { x: 10.4, y: 10.4 },
        ],
        { x: 10.5, y: 10.5 },
        1.35
      )
    ).toBe(false);
  });

  it("filters tiny duplicate movements after the protected stroke-start samples", () => {
    expect(
      shouldAppendInkPoint(
        [
          { x: 10, y: 10 },
          { x: 10.2, y: 10.2 },
          { x: 10.4, y: 10.4 },
          { x: 10.5, y: 10.5 },
          { x: 10.55, y: 10.55 },
        ],
        { x: 10.58, y: 10.58 },
        1.35
      )
    ).toBe(false);
  });

  it("appends initial samples for quick marks", () => {
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

  it("finalizes separate quick re-contact strokes instead of merging them", () => {
    const firstStroke = finalizeInkStroke({
      points: [
        { x: 10, y: 10, pressure: 0.5, time: 0 },
        { x: 10, y: 45, pressure: 0.5, time: 24 },
      ],
      color: "black",
      tool: "pen",
      width: 5,
    });
    const secondStroke = finalizeInkStroke({
      points: [
        { x: 0, y: 28, pressure: 0.5, time: 0 },
        { x: 30, y: 28, pressure: 0.5, time: 22 },
      ],
      color: "black",
      tool: "pen",
      width: 5,
    });

    expect(firstStroke?.points).toHaveLength(2);
    expect(secondStroke?.points).toHaveLength(2);
    expect(secondStroke?.points[0]?.time).toBe(0);
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

  it("interpolates large gaps between samples while preserving pressure and time", () => {
    const points = interpolateInkPoints(
      [
        { x: 0, y: 0, pressure: 0.2, time: 0 },
        { x: 30, y: 0, pressure: 0.8, time: 60 },
      ],
      10
    );

    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ x: 0, y: 0, pressure: 0.2, time: 0 });
    expect(points[1]).toEqual({ x: 10, y: 0, pressure: 0.4, time: 20 });
    expect(points[3]).toEqual({ x: 30, y: 0, pressure: 0.8, time: 60 });
  });

  it("creates freehand outlines for live and committed pen/highlighter strokes", () => {
    const penPoints = [
      { x: 10, y: 10, pressure: 0.4, time: 0 },
      { x: 40, y: 42, pressure: 0.7, time: 40 },
      { x: 90, y: 62, pressure: 0.5, time: 80 },
    ];
    const liveOutline = getFreehandOutline({
      points: penPoints,
      tool: "pen",
      width: 6,
      mode: "live",
    });
    const committedOutline = getFreehandOutline({
      points: penPoints,
      tool: "pen",
      width: 6,
      mode: "committed",
    });
    const highlighterOutline = getFreehandOutline({
      points: [
        { x: 10, y: 10, pressure: 0.4, time: 0 },
        { x: 90, y: 22, pressure: 0.7, time: 50 },
      ],
      tool: "highlighter",
      width: 18,
    });

    expect(liveOutline.length).toBeGreaterThan(3);
    expect(committedOutline.length).toBeGreaterThan(3);
    expect(highlighterOutline.length).toBeGreaterThan(3);
    expect(getSvgPathFromStrokeOutline(committedOutline)).toMatch(/^M .* Z$/);
  });

  it("routes stylus and mouse to drawing while touch is reserved for page gestures", () => {
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
    expect(
      getNotebookPageIndexAfterSwipe({ currentIndex: 0, pageCount: 3, direction: "previous" })
    ).toBe(0);
    expect(
      getNotebookPageIndexAfterSwipe({ currentIndex: 0, pageCount: 3, direction: "next" })
    ).toBe(1);
    expect(
      getNotebookPageIndexAfterSwipe({ currentIndex: 2, pageCount: 3, direction: "next" })
    ).toBe(2);
    expect(
      getNotebookPageIndexAfterSwipe({ currentIndex: -1, pageCount: 3, direction: "next" })
    ).toBe(-1);
  });

  it("calculates bounded notebook page pinch zoom", () => {
    expect(
      getPinchDistance(
        { clientX: 0, clientY: 0, pressure: 0.5, time: 0 },
        { clientX: 3, clientY: 4, pressure: 0.5, time: 0 }
      )
    ).toBe(5);
    expect(
      getNotebookPageZoomAfterPinch({ startDistance: 100, currentDistance: 150, startZoom: 1 })
    ).toBe(1.5);
    expect(
      getNotebookPageZoomAfterPinch({ startDistance: 100, currentDistance: 500, startZoom: 1 })
    ).toBe(2.4);
    expect(
      getNotebookPageZoomAfterPinch({ startDistance: 100, currentDistance: 20, startZoom: 1 })
    ).toBe(0.85);
    expect(clampNotebookPageZoom(Number.NaN)).toBe(1);
  });
});
