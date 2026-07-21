import { describe, expect, it } from "vitest";
import {
  applyNotebookEraser,
  applyPrecisionEraser,
  applyStrokeEraser,
  doesNotebookPolylineTouchCircularEraserSweep,
  getContinuousNotebookEraserSamples,
  getNotebookCircularEraserSweepPoints,
  getNotebookEraserCursorDiameter,
  getNotebookEraserModeValue,
  getNotebookEraserToolThickness,
  getNotebookPrecisionEraserContactRadiusOnCanvas,
  getSpatiallySimplifiedNotebookEraserSamples,
  NOTEBOOK_ERASER_THICKNESS_BY_SIZE,
} from "@/lib/workspace/notebook-eraser";
import { Color4, Path, Vec2 } from "@js-draw/math";
// @ts-expect-error -- Direct module import avoids js-draw's browser-only package entry in node tests.
import Stroke from "../node_modules/js-draw/dist/mjs/components/Stroke.mjs";
import type { Viewport } from "js-draw";
import { orderNotebookStrokesForRendering } from "@/lib/workspace/notebook-rendering";
import type { NotebookStroke } from "@/lib/workspace/notebooks";

const makeStroke = (points: NotebookStroke["points"]): NotebookStroke => ({
  points,
  color: "black",
  width: 5,
  tool: "pen",
});

const makeEraser = (points: NotebookStroke["points"], width = 12): NotebookStroke => ({
  points,
  color: "white",
  width,
  tool: "eraser",
});

describe("notebook eraser helpers", () => {
  it("maps toolbar modes to js-draw eraser modes", () => {
    expect(getNotebookEraserModeValue("precision")).toBe("partial-stroke");
    expect(getNotebookEraserModeValue("stroke")).toBe("full-stroke");
  });

  it("maps every UI size to a matching circular precision footprint", () => {
    expect(NOTEBOOK_ERASER_THICKNESS_BY_SIZE).toEqual({
      small: 36,
      medium: 56,
      large: 76,
    });
    expect(getNotebookEraserCursorDiameter("precision", 36)).toBeCloseTo(14.4);
    expect(getNotebookEraserCursorDiameter("precision", 56)).toBeCloseTo(22.4);
    expect(getNotebookEraserCursorDiameter("precision", 76)).toBeCloseTo(30.4);
    for (const thickness of Object.values(
      NOTEBOOK_ERASER_THICKNESS_BY_SIZE
    )) {
      expect(getNotebookEraserToolThickness("precision", thickness)).toBe(
        getNotebookEraserCursorDiameter("precision", thickness)
      );
    }
    expect(getNotebookEraserCursorDiameter("stroke", 56)).toBe(56);
    expect(getNotebookEraserToolThickness("stroke", 56)).toBe(56);
  });

  it("converts visible edge contact into zoom-invariant canvas geometry", () => {
    const diameter = getNotebookEraserCursorDiameter("precision", 56);
    const atFit = getNotebookPrecisionEraserContactRadiusOnCanvas({
      cursorDiameter: diameter,
      strokeWidth: 4,
      viewportScale: 0.5,
    });
    const zoomed = getNotebookPrecisionEraserContactRadiusOnCanvas({
      cursorDiameter: diameter,
      strokeWidth: 4,
      viewportScale: 2,
    });

    expect((atFit - 2) * 0.5).toBeCloseTo(diameter / 2 + 0.25);
    expect((zoomed - 2) * 2).toBeCloseTo(diameter / 2 + 0.25);
  });

  it("uses a circular edge that clips touched thin ink at every eraser size", () => {
    const viewport = {
      roundPoint: <Point>(point: Point) => point,
    } as unknown as Viewport;

    for (const thickness of Object.values(
      NOTEBOOK_ERASER_THICKNESS_BY_SIZE
    )) {
      const diameter = getNotebookEraserCursorDiameter(
        "precision",
        thickness
      );
      for (const strokeWidth of [2, 4, 6, 10]) {
        const contactRadius =
          getNotebookPrecisionEraserContactRadiusOnCanvas({
            cursorDiameter: diameter,
            strokeWidth,
            viewportScale: 1,
          });
        const erasePath = Path.fromConvexHullOf(
          getNotebookCircularEraserSweepPoints({
            from: { x: 0, y: 0 },
            to: { x: 0, y: 0 },
            radius: contactRadius,
          }).map((point) => Vec2.of(point.x, point.y))
        );
        const touched = Stroke.fromStroked(
          `M -100 ${contactRadius - 0.01} L 100 ${contactRadius - 0.01}`,
          { width: strokeWidth, color: Color4.black }
        );
        const touchedResult = touched.withRegionErased(erasePath, viewport);
        expect(touchedResult.length).toBe(2);
        expect(touchedResult).not.toContain(touched);
        expect(
          doesNotebookPolylineTouchCircularEraserSweep({
            contactRadius,
            eraserFrom: { x: 0, y: 0 },
            eraserTo: { x: 0, y: 0 },
            strokeSegments: [
              {
                start: { x: -100, y: contactRadius + 0.5 },
                end: { x: 100, y: contactRadius + 0.5 },
              },
            ],
          })
        ).toBe(false);
      }
    }
  });

  it("keeps every coalesced bend and guarantees the current endpoint", () => {
    const samples = getContinuousNotebookEraserSamples(
      {
        clientX: 30,
        clientY: 10,
        timeStamp: 30,
        getCoalescedEvents: () => [
          { clientX: 10, clientY: 0, timeStamp: 10 },
          { clientX: 20, clientY: 20, timeStamp: 20 },
        ],
      },
      { clientX: 0, clientY: 0, timeStamp: 0 }
    );

    expect(samples).toEqual([
      { clientX: 10, clientY: 0, timeStamp: 10 },
      { clientX: 20, clientY: 20, timeStamp: 20 },
      { clientX: 30, clientY: 10, timeStamp: 30 },
    ]);
  });

  it("deduplicates a repeated endpoint without dropping a new curve point", () => {
    expect(
      getContinuousNotebookEraserSamples(
        {
          clientX: 20,
          clientY: 10,
          timeStamp: 20,
          getCoalescedEvents: () => [
            { clientX: 10, clientY: 10, timeStamp: 10 },
            { clientX: 20, clientY: 10, timeStamp: 19 },
          ],
        },
        { clientX: 10, clientY: 10, timeStamp: 5 }
      )
    ).toEqual([{ clientX: 20, clientY: 10, timeStamp: 19 }]);
  });

  it("ignores repeated WebKit coalesced history from before the last sample", () => {
    expect(
      getContinuousNotebookEraserSamples(
        {
          clientX: 30,
          clientY: 5,
          timeStamp: 30,
          getCoalescedEvents: () => [
            { clientX: 10, clientY: 40, timeStamp: 10 },
            { clientX: 15, clientY: 50, timeStamp: 15 },
          ],
        },
        { clientX: 20, clientY: 0, timeStamp: 20 }
      )
    ).toEqual([{ clientX: 30, clientY: 5, timeStamp: 30 }]);
  });

  it("keeps a new same-timestamp coalesced point before the current endpoint", () => {
    expect(
      getContinuousNotebookEraserSamples(
        {
          clientX: 30,
          clientY: 5,
          timeStamp: 21,
          getCoalescedEvents: () => [
            { clientX: 22, clientY: 8, timeStamp: 20 },
          ],
        },
        { clientX: 20, clientY: 0, timeStamp: 20 }
      )
    ).toEqual([
      { clientX: 22, clientY: 8, timeStamp: 20 },
      { clientX: 30, clientY: 5, timeStamp: 21 },
    ]);
  });

  it("slices away an equal-timestamp replay before the previous sample anchor", () => {
    expect(
      getContinuousNotebookEraserSamples(
        {
          clientX: 25,
          clientY: 2,
          timeStamp: 25,
          getCoalescedEvents: () => [
            { clientX: 10, clientY: 40, timeStamp: 20 },
            { clientX: 20, clientY: 0, timeStamp: 20 },
            { clientX: 25, clientY: 2, timeStamp: 25 },
          ],
        },
        { clientX: 20, clientY: 0, timeStamp: 20 }
      )
    ).toEqual([{ clientX: 25, clientY: 2, timeStamp: 25 }]);
  });

  it("does not move backward when the current WebKit event timestamp regresses", () => {
    expect(
      getContinuousNotebookEraserSamples(
        {
          clientX: 15,
          clientY: 20,
          timeStamp: 19,
          getCoalescedEvents: () => [
            { clientX: 10, clientY: 40, timeStamp: 18 },
          ],
        },
        { clientX: 20, clientY: 0, timeStamp: 20 }
      )
    ).toEqual([]);
  });

  it("collapses sub-half-pixel packet noise while preserving its real endpoint", () => {
    expect(
      getSpatiallySimplifiedNotebookEraserSamples(
        [
          { clientX: 1, clientY: 0.2, timeStamp: 1 },
          { clientX: 2, clientY: -0.3, timeStamp: 2 },
          { clientX: 3, clientY: 0.4, timeStamp: 3 },
          { clientX: 4, clientY: 0, timeStamp: 4 },
        ],
        { clientX: 0, clientY: 0, timeStamp: 0 }
      )
    ).toEqual([{ clientX: 4, clientY: 0, timeStamp: 4 }]);
  });

  it("retains sharp bends instead of erasing across their chord", () => {
    expect(
      getSpatiallySimplifiedNotebookEraserSamples(
        [
          { clientX: 0, clientY: 20, timeStamp: 1 },
          { clientX: 20, clientY: 20, timeStamp: 2 },
          { clientX: 20, clientY: 0, timeStamp: 3 },
        ],
        { clientX: 0, clientY: 0, timeStamp: 0 }
      )
    ).toEqual([
      { clientX: 0, clientY: 20, timeStamp: 1 },
      { clientX: 20, clientY: 20, timeStamp: 2 },
      { clientX: 20, clientY: 0, timeStamp: 3 },
    ]);
  });

  it("retains a loop bend even when the packet returns to its anchor", () => {
    expect(
      getSpatiallySimplifiedNotebookEraserSamples(
        [
          { clientX: 10, clientY: 10, timeStamp: 1 },
          { clientX: 0, clientY: 0, timeStamp: 2 },
        ],
        { clientX: 0, clientY: 0, timeStamp: 0 }
      )
    ).toEqual([
      { clientX: 10, clientY: 10, timeStamp: 1 },
      { clientX: 0, clientY: 0, timeStamp: 2 },
    ]);
  });

  it("removes whole touched strokes in stroke mode", () => {
    const touched = makeStroke([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    const untouched = makeStroke([{ x: 300, y: 300 }]);

    expect(applyStrokeEraser([touched, untouched], makeEraser([{ x: 50, y: 0 }]))).toEqual([
      untouched,
    ]);
  });

  it("splits touched strokes in precision mode", () => {
    const stroke = makeStroke([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 100, y: 0 },
      { x: 180, y: 0 },
      { x: 200, y: 0 },
    ]);

    expect(applyPrecisionEraser([stroke], makeEraser([{ x: 100, y: 0 }], 18))).toEqual([
      { ...stroke, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
      { ...stroke, points: [{ x: 180, y: 0 }, { x: 200, y: 0 }] },
    ]);
  });

  it("removes single-point strokes when precision eraser touches them", () => {
    expect(applyPrecisionEraser([makeStroke([{ x: 10, y: 10 }])], makeEraser([{ x: 10, y: 10 }]))).toEqual([]);
  });

  it("keeps untouched strokes in precision mode", () => {
    const stroke = makeStroke([{ x: 300, y: 300 }]);
    expect(applyNotebookEraser({ strokes: [stroke], eraser: makeEraser([{ x: 10, y: 10 }]), mode: "precision" })).toEqual([
      stroke,
    ]);
  });

  it("preserves pressure and timing on remaining precision-erased stroke segments", () => {
    const stroke = makeStroke([
      { x: 0, y: 0, pressure: 0.2, time: 0 },
      { x: 20, y: 0, pressure: 0.4, time: 16 },
      { x: 100, y: 0, pressure: 0.6, time: 48 },
      { x: 180, y: 0, pressure: 0.8, time: 80 },
    ]);

    expect(applyPrecisionEraser([stroke], makeEraser([{ x: 100, y: 0 }], 18))).toEqual([
      {
        ...stroke,
        points: [
          { x: 0, y: 0, pressure: 0.2, time: 0 },
          { x: 20, y: 0, pressure: 0.4, time: 16 },
        ],
      },
      { ...stroke, points: [{ x: 180, y: 0, pressure: 0.8, time: 80 }] },
    ]);
  });

  it("uses segment geometry for sparse precision-erased strokes", () => {
    const stroke = makeStroke([
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 180, y: 0 },
    ]);

    expect(applyPrecisionEraser([stroke], makeEraser([{ x: 92, y: 0 }], 12))).toEqual([
      { ...stroke, points: [{ x: 0, y: 0 }] },
      { ...stroke, points: [{ x: 180, y: 0 }] },
    ]);
  });

  it("renders highlighter strokes before pen strokes", () => {
    const pen = makeStroke([{ x: 10, y: 10 }]);
    const highlighter: NotebookStroke = {
      points: [{ x: 12, y: 12 }],
      color: "yellow",
      width: 18,
      tool: "highlighter",
    };

    expect(orderNotebookStrokesForRendering([pen, highlighter])).toEqual([
      highlighter,
      pen,
    ]);
  });
});
