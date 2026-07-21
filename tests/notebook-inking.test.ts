import { describe, expect, it } from "vitest";
import {
  appendInkPoints,
  appendPendingNotebookStroke,
  clampNotebookPagePan,
  clampNotebookPageZoom,
  clampNotebookThicknessPercent,
  finalizeInkStroke,
  getHighlighterWidthFromPercent,
  interpolateInkSampleGaps,
  getNotebookCreatePagePull,
  getNotebookCreatePageThreshold,
  getBoundedLivePointerSamples,
  getNotebookPageDragIntent,
  getNotebookPageFit,
  getNotebookPageIndexAfterSwipe,
  getNotebookLivePinchTransform,
  getNotebookPagePanAfterPinch,
  getNotebookPageZoomAfterPinch,
  getNotebookSwipeDragOffset,
  getNotebookSwipeDirection,
  getNotebookSwipeReleaseDecision,
  getNotebookSwipeSettleDuration,
  getNotebookSwipeVelocity,
  shouldCreateNotebookPageOnRelease,
  getPenWidthFromPercent,
  getPinchDistance,
  getPointerClientSamples,
  mapClientPointToNotebookPage,
  normalizePointerPressure,
  NOTEBOOK_MAX_PENDING_NATIVE_STROKES,
  NOTEBOOK_MAX_LIVE_POINTER_SAMPLES_PER_EVENT,
  NOTEBOOK_NATIVE_COMMIT_IDLE_MS,
  shouldAppendInkPoint,
  shouldPointerDraw,
  shouldPointerDrawEvent,
  shouldPointerSwipePages,
  shouldSuppressTouchAfterStylus,
} from "@/lib/workspace/notebook-inking";
import {
  getFreehandOutline,
  getSvgPathFromStrokeOutline,
  interpolateInkPoints,
  normalizeInkPressure,
  normalizeInkTime,
  normalizeTimedInkPoint,
} from "@/lib/workspace/notebook-ink-engine";
import {
  isNotebookCustomStrokeColor,
  normalizeNotebookStrokeColor,
} from "@/lib/workspace/notebooks";

describe("notebook inking helpers", () => {
  it("uses a genuine idle boundary and bounds the native pending stroke queue", () => {
    const makeStroke = (x: number) => ({
      points: [{ x, y: 10 }],
      color: "black" as const,
      tool: "pen" as const,
      width: 6,
    });
    const pending = Array.from(
      { length: NOTEBOOK_MAX_PENDING_NATIVE_STROKES },
      (_, index) => makeStroke(index)
    );

    const bounded = appendPendingNotebookStroke(
      pending,
      makeStroke(NOTEBOOK_MAX_PENDING_NATIVE_STROKES)
    );

    expect(NOTEBOOK_NATIVE_COMMIT_IDLE_MS).toBe(750);
    expect(bounded).toHaveLength(NOTEBOOK_MAX_PENDING_NATIVE_STROKES);
    expect(bounded[0]?.points[0]?.x).toBe(1);
    expect(bounded.at(-1)?.points[0]?.x).toBe(
      NOTEBOOK_MAX_PENDING_NATIVE_STROKES
    );
  });

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

  it("bounds each live Pencil packet while preserving its current endpoint", () => {
    type PointerSample = {
      clientX: number;
      clientY: number;
      getCoalescedEvents?: () => readonly PointerSample[];
      pressure: number;
      timeStamp: number;
    };
    const event: PointerSample = {
      clientX: 80,
      clientY: 0,
      pressure: 0.5,
      timeStamp: 8,
      getCoalescedEvents: () =>
        Array.from({ length: 8 }, (_, index) => ({
          clientX: (index + 1) * 10,
          clientY: 0,
          pressure: 0.5,
          timeStamp: index + 1,
        })),
    };
    const eventWithoutHistory: PointerSample = {
      clientX: 10,
      clientY: 10,
      pressure: 0.4,
      timeStamp: 10,
      getCoalescedEvents: () => [],
    };
    const previous = {
      clientX: 0,
      clientY: 0,
      pressure: 0.5,
      timeStamp: 0,
    };

    const samples = getBoundedLivePointerSamples(event, previous);
    expect(NOTEBOOK_MAX_LIVE_POINTER_SAMPLES_PER_EVENT).toBe(3);
    expect(samples).toEqual([event]);
    expect(samples).toHaveLength(1);
    expect(getBoundedLivePointerSamples(eventWithoutHistory, previous)).toEqual([
      eventWithoutHistory,
    ]);
  });

  it("retains one meaningful bend from a dense Pencil packet", () => {
    const bend = {
      clientX: 5,
      clientY: 8,
      pressure: 0.5,
      timeStamp: 5,
    };
    const event = {
      clientX: 10,
      clientY: 0,
      pressure: 0.5,
      timeStamp: 10,
      getCoalescedEvents: () => [bend],
    };

    expect(
      getBoundedLivePointerSamples(event, {
        clientX: 0,
        clientY: 0,
        pressure: 0.5,
        timeStamp: 0,
      })
    ).toEqual([bend, event]);
  });

  it("retains a pressure peak without exceeding the live render budget", () => {
    const pressurePeak = {
      clientX: 5,
      clientY: 0,
      pressure: 0.9,
      timeStamp: 5,
    };
    const event = {
      clientX: 10,
      clientY: 0,
      pressure: 0.2,
      timeStamp: 10,
      getCoalescedEvents: () => [
        { clientX: 2, clientY: 0, pressure: 0.2, timeStamp: 2 },
        pressurePeak,
        { clientX: 8, clientY: 0, pressure: 0.2, timeStamp: 8 },
      ],
    };
    const samples = getBoundedLivePointerSamples(event, {
      clientX: 0,
      clientY: 0,
      pressure: 0.2,
      timeStamp: 0,
    });

    expect(samples).toEqual([
      pressurePeak,
      { clientX: 8, clientY: 0, pressure: 0.2, timeStamp: 8 },
      event,
    ]);
    expect(samples.length).toBeLessThanOrEqual(
      NOTEBOOK_MAX_LIVE_POINTER_SAMPLES_PER_EVENT
    );
  });

  it("retains two opposite bends in chronological order", () => {
    const firstBend = {
      clientX: 3,
      clientY: 8,
      pressure: 0.5,
      timeStamp: 3,
    };
    const secondBend = {
      clientX: 7,
      clientY: -8,
      pressure: 0.5,
      timeStamp: 7,
    };
    const event = {
      clientX: 10,
      clientY: 0,
      pressure: 0.5,
      timeStamp: 10,
      getCoalescedEvents: () => [firstBend, secondBend],
    };

    const samples = getBoundedLivePointerSamples(event, {
      clientX: 0,
      clientY: 0,
      pressure: 0.5,
      timeStamp: 0,
    });

    expect(samples).toEqual([firstBend, secondBend, event]);
    expect(samples).toHaveLength(NOTEBOOK_MAX_LIVE_POINTER_SAMPLES_PER_EVENT);
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

  it("suppresses touch navigation during stylus input and its palm cooldown", () => {
    expect(
      shouldSuppressTouchAfterStylus({
        stylusActive: true,
        cooldownUntil: 0,
        now: 100,
      })
    ).toBe(true);
    expect(
      shouldSuppressTouchAfterStylus({
        stylusActive: false,
        cooldownUntil: 180,
        now: 100,
      })
    ).toBe(true);
    expect(
      shouldSuppressTouchAfterStylus({
        stylusActive: false,
        cooldownUntil: 180,
        now: 181,
      })
    ).toBe(false);
  });

  it("normalizes preset and custom notebook stroke colors", () => {
    expect(isNotebookCustomStrokeColor("#3b82f6")).toBe(true);
    expect(isNotebookCustomStrokeColor("#3B82F6")).toBe(true);
    expect(isNotebookCustomStrokeColor("#fff")).toBe(false);
    expect(isNotebookCustomStrokeColor("rgb(0,0,0)")).toBe(false);
    expect(normalizeNotebookStrokeColor("red")).toBe("red");
    expect(normalizeNotebookStrokeColor("yellow")).toBe("yellow");
    expect(normalizeNotebookStrokeColor("#3B82F6")).toBe("#3b82f6");
    expect(normalizeNotebookStrokeColor("bad", "green")).toBe("green");
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

    expect(firstStroke?.points.length).toBeGreaterThanOrEqual(2);
    expect(secondStroke?.points.length).toBeGreaterThanOrEqual(2);
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

  it("densifies fast saved stroke gaps before finalizing", () => {
    const points = interpolateInkSampleGaps([
      { x: 0, y: 0, pressure: 0.2, time: 0 },
      { x: 30, y: 0, pressure: 0.8, time: 60 },
    ]);
    const finalized = finalizeInkStroke({
      points: [
        { x: 0, y: 0, pressure: 0.2, time: 0 },
        { x: 30, y: 0, pressure: 0.8, time: 60 },
      ],
      color: "black",
      tool: "pen",
      width: 6,
    });

    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 0, y: 0, pressure: 0.2, time: 0 });
    expect(points.at(-1)).toEqual({ x: 30, y: 0, pressure: 0.8, time: 60 });
    expect(finalized?.points.length).toBeGreaterThan(2);
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
    expect(shouldPointerDraw("mouse", "highlighter")).toBe(true);
    expect(shouldPointerDraw("pen", "eraser")).toBe(false);
    expect(shouldPointerDraw("mouse", "eraser")).toBe(false);
    expect(shouldPointerDraw("touch", "pen")).toBe(false);
    expect(shouldPointerDraw("pen", "text")).toBe(false);
    expect(shouldPointerDrawEvent({ pointerType: "pen" }, "pen")).toBe(true);
    expect(shouldPointerDrawEvent({ pointerType: "touch" }, "pen")).toBe(false);
    expect(
      shouldPointerDrawEvent({ pointerType: "touch", altitudeAngle: 0.9 }, "pen")
    ).toBe(false);
    expect(
      shouldPointerDrawEvent({ pointerType: "touch", azimuthAngle: 0.4, pressure: 0.8 }, "pen")
    ).toBe(false);
    expect(
      shouldPointerDrawEvent({ pointerType: "touch", tiltX: 12, tiltY: -4 }, "highlighter")
    ).toBe(false);
    expect(shouldPointerDrawEvent({ pointerType: "", pressure: 0.5 }, "highlighter")).toBe(false);
    expect(shouldPointerDrawEvent({ pointerType: "touch", altitudeAngle: 0.9 }, "text")).toBe(
      false
    );
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

  it("swipes fitted pages but never changes page during zoomed panning", () => {
    expect(
      getNotebookPageDragIntent({
        axis: "horizontal",
        canPanHorizontally: false,
        canPanVertically: true,
        zoom: 1,
      })
    ).toBe("page");
    expect(
      getNotebookPageDragIntent({
        axis: "vertical",
        canPanHorizontally: false,
        canPanVertically: true,
        zoom: 1.2,
      })
    ).toBe("pan");
    expect(
      getNotebookPageDragIntent({
        axis: "horizontal",
        canPanHorizontally: false,
        canPanVertically: true,
        zoom: 1.2,
      })
    ).toBe("none");
    expect(
      getNotebookPageDragIntent({
        axis: "horizontal",
        canPanHorizontally: true,
        canPanVertically: true,
        zoom: 1.2,
      })
    ).toBe("pan");
    expect(
      getNotebookPageDragIntent({
        axis: "vertical",
        canPanHorizontally: false,
        canPanVertically: false,
        zoom: 1,
      })
    ).toBe("none");
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

  it("calculates swipe velocity from the trailing 100ms", () => {
    expect(
      getNotebookSwipeVelocity([
        { x: 0, time: 0 },
        { x: 20, time: 80 },
        { x: 80, time: 140 },
      ])
    ).toBe(1);
    expect(
      getNotebookSwipeVelocity([
        { x: 100, time: 20 },
        { x: 70, time: 70 },
        { x: 40, time: 120 },
      ])
    ).toBe(-0.6);
    expect(
      getNotebookSwipeVelocity([
        { x: 0, time: 0 },
        { x: 80, time: 40 },
        { x: 80, time: 200 },
      ])
    ).toBe(0);
    expect(
      getNotebookSwipeVelocity([
        { x: 10, time: 100 },
        { x: 20, time: 100 },
      ])
    ).toBe(0);
  });

  it("decides swipe release using distance, signed velocity, and page bounds", () => {
    expect(
      getNotebookSwipeReleaseDecision({
        totalDx: -220,
        pageWidth: 1000,
        velocityX: 0,
        currentIndex: 1,
        pageCount: 3,
      })
    ).toEqual({ direction: "next", targetIndex: 2, shouldCommit: true });
    expect(
      getNotebookSwipeReleaseDecision({
        totalDx: -80,
        pageWidth: 1000,
        velocityX: 0.55,
        currentIndex: 1,
        pageCount: 3,
      })
    ).toEqual({ direction: "previous", targetIndex: 0, shouldCommit: true });
    expect(
      getNotebookSwipeReleaseDecision({
        totalDx: 80,
        pageWidth: 1000,
        velocityX: -0.8,
        currentIndex: 1,
        pageCount: 3,
      })
    ).toEqual({ direction: "next", targetIndex: 2, shouldCommit: true });
    expect(
      getNotebookSwipeReleaseDecision({
        totalDx: -219,
        pageWidth: 1000,
        velocityX: -0.54,
        currentIndex: 1,
        pageCount: 3,
      })
    ).toEqual({ direction: null, targetIndex: 1, shouldCommit: false });
    expect(
      getNotebookSwipeReleaseDecision({
        totalDx: -300,
        pageWidth: 1000,
        velocityX: -1,
        currentIndex: 2,
        pageCount: 3,
      })
    ).toEqual({ direction: "next", targetIndex: 2, shouldCommit: false });
  });

  it("tracks available pages directly and resists unavailable edges", () => {
    expect(getNotebookSwipeDragOffset({ totalDx: -120, currentIndex: 0, pageCount: 3 })).toBe(
      -120
    );
    expect(getNotebookSwipeDragOffset({ totalDx: 100, currentIndex: 0, pageCount: 3 })).toBe(50);
    expect(getNotebookSwipeDragOffset({ totalDx: -100, currentIndex: 2, pageCount: 3 })).toBe(
      -50
    );
    expect(getNotebookSwipeDragOffset({ totalDx: 0, currentIndex: 0, pageCount: 3 })).toBe(0);
  });

  it("calculates bounded velocity-aware swipe settle durations", () => {
    expect(
      getNotebookSwipeSettleDuration({
        currentOffset: 0,
        targetOffset: 0,
        travelDistance: 1000,
        velocityX: 0,
      })
    ).toBe(0);
    expect(
      getNotebookSwipeSettleDuration({
        currentOffset: 0,
        targetOffset: 1000,
        travelDistance: 1000,
        velocityX: 0,
      })
    ).toBe(300);
    expect(
      getNotebookSwipeSettleDuration({
        currentOffset: 500,
        targetOffset: 1000,
        travelDistance: 1000,
        velocityX: 0,
      })
    ).toBe(220);
    expect(
      getNotebookSwipeSettleDuration({
        currentOffset: 0,
        targetOffset: -1000,
        travelDistance: 1000,
        velocityX: 2,
      })
    ).toBe(220);
    expect(
      getNotebookSwipeSettleDuration({
        currentOffset: -500,
        targetOffset: 0,
        travelDistance: 1000,
        velocityX: 1,
      })
    ).toBe(180);
    expect(
      getNotebookSwipeSettleDuration({
        currentOffset: 0,
        targetOffset: 1000,
        travelDistance: 1000,
        velocityX: 20,
      })
    ).toBe(220);
    expect(
      getNotebookSwipeSettleDuration({
        currentOffset: 0,
        targetOffset: 1000,
        travelDistance: 1000,
        velocityX: 0,
        reducedMotion: true,
      })
    ).toBe(0);
  });

  it("describes the create-page pull progress and rubber-band offset", () => {
    const pageWidth = 1000;
    const threshold = getNotebookCreatePageThreshold(pageWidth);
    expect(threshold).toBe(320);

    // No forward pull yet (rightward / zero drag) → no progress, no offset.
    expect(getNotebookCreatePagePull({ totalDx: 0, pageWidth })).toEqual({
      progress: 0,
      resistedOffset: 0,
    });
    expect(getNotebookCreatePagePull({ totalDx: 40, pageWidth }).progress).toBe(0);

    // Halfway pull → half progress; offset is negative (page gives leftward).
    const halfway = getNotebookCreatePagePull({ totalDx: -160, pageWidth });
    expect(halfway.progress).toBeCloseTo(0.5, 5);
    expect(halfway.resistedOffset).toBeLessThan(0);

    // Progress clamps at 1 once the threshold is exceeded.
    expect(getNotebookCreatePagePull({ totalDx: -500, pageWidth }).progress).toBe(1);

    // Tiny pages fall back to the px floor.
    expect(getNotebookCreatePageThreshold(100)).toBe(96);
  });

  it("decides when releasing the create-page pull should add a page", () => {
    const pageWidth = 1000;
    // Full pull, no flick → create.
    expect(
      shouldCreateNotebookPageOnRelease({ totalDx: -340, pageWidth, velocityX: 0 })
    ).toBe(true);
    // Short pull, no flick → keep (rubber-band back).
    expect(
      shouldCreateNotebookPageOnRelease({ totalDx: -120, pageWidth, velocityX: 0 })
    ).toBe(false);
    // Partial pull but a fast forward (leftward) flick → create.
    expect(
      shouldCreateNotebookPageOnRelease({ totalDx: -200, pageWidth, velocityX: -1.2 })
    ).toBe(true);
    // Partial pull with a rightward flick → keep.
    expect(
      shouldCreateNotebookPageOnRelease({ totalDx: -200, pageWidth, velocityX: 1.2 })
    ).toBe(false);
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
    ).toBe(4);
    expect(
      getNotebookPageZoomAfterPinch({ startDistance: 100, currentDistance: 20, startZoom: 1 })
    ).toBe(0.92);
    expect(
      getNotebookPageZoomAfterPinch({
        startDistance: 100,
        currentDistance: 20,
        startZoom: 1,
        minZoom: 1,
      })
    ).toBe(1);
    expect(clampNotebookPageZoom(0.9, 1)).toBe(1);
    expect(clampNotebookPageZoom(0.91)).toBe(0.92);
    expect(clampNotebookPageZoom(Number.NaN)).toBe(1);
  });

  it("fits notebook pages inside responsive workspace margins", () => {
    expect(
      getNotebookPageFit({
        frameWidth: 768,
        frameHeight: 956,
        pageWidth: 900,
        pageHeight: 1240,
      })
    ).toEqual({ width: 670.6451612903226, height: 924 });
    expect(
      getNotebookPageFit({
        frameWidth: 390,
        frameHeight: 776,
        pageWidth: 900,
        pageHeight: 1240,
      })
    ).toEqual({ width: 366, height: 504.26666666666665 });
  });

  it("centres a fitted page with equal space above and below", () => {
    const frameWidth = 768;
    const frameHeight = 956;
    const fit = getNotebookPageFit({
      frameWidth,
      frameHeight,
      pageWidth: 900,
      pageHeight: 1240,
    });
    const pan = clampNotebookPagePan({
      pan: { x: 0, y: 0 },
      pageWidth: fit.width,
      pageHeight: fit.height,
      frameWidth,
      frameHeight,
    });

    expect(pan.y).toBeCloseTo(frameHeight - fit.height - pan.y);
  });

  it("clamps page pan inside a fixed frame", () => {
    // Page smaller than the frame: centered on both axes.
    expect(
      clampNotebookPagePan({
        pan: { x: 40, y: -80 },
        pageWidth: 300,
        pageHeight: 400,
        frameWidth: 500,
        frameHeight: 600,
      })
    ).toEqual({ x: 100, y: 100 });
    // Page larger than the frame: pan clamped so the frame stays covered.
    expect(
      clampNotebookPagePan({
        pan: { x: 50, y: -900 },
        pageWidth: 1000,
        pageHeight: 1400,
        frameWidth: 500,
        frameHeight: 600,
      })
    ).toEqual({ x: 0, y: -800 });
    expect(
      clampNotebookPagePan({
        pan: { x: -700, y: -100 },
        pageWidth: 1000,
        pageHeight: 1400,
        frameWidth: 500,
        frameHeight: 600,
      })
    ).toEqual({ x: -500, y: -100 });
  });

  it("keeps the pinched page anchor under the fingers and clamps the result", () => {
    expect(
      getNotebookPagePanAfterPinch({
        pinchCenterX: 350,
        pinchCenterY: 430,
        frameLeft: 10,
        frameTop: 20,
        anchorFx: 0.25,
        anchorFy: 0.5,
        pageWidth: 1000,
        pageHeight: 1400,
        frameWidth: 500,
        frameHeight: 600,
      })
    ).toEqual({ x: 0, y: -290 });

    expect(
      getNotebookPagePanAfterPinch({
        pinchCenterX: 250,
        pinchCenterY: 300,
        frameLeft: 0,
        frameTop: 0,
        anchorFx: 0.5,
        anchorFy: 0.5,
        pageWidth: 300,
        pageHeight: 400,
        frameWidth: 500,
        frameHeight: 600,
      })
    ).toEqual({ x: 100, y: 100 });
  });

  it("keeps the live pinch anchor under moving fingers", () => {
    const transform = getNotebookLivePinchTransform({
      anchorFx: 0.25,
      anchorFy: 0.5,
      basePanX: 50,
      basePanY: 100,
      currentCenterX: 120,
      currentCenterY: 330,
      frameWidth: 500,
      frameHeight: 700,
      nextZoom: 1.5,
      startCenterX: 150,
      startCenterY: 350,
      startPageHeight: 500,
      startPageWidth: 400,
      startZoom: 1,
    });

    expect(transform).toEqual({ x: -30, y: -45, scaleRatio: 1.5 });
    expect(transform.x + 0.25 * 400 * transform.scaleRatio).toBe(120);
    expect(transform.y + 0.5 * 500 * transform.scaleRatio).toBe(330);
  });
});
