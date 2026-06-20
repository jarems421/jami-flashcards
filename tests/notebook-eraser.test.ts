import { describe, expect, it } from "vitest";
import {
  applyNotebookEraser,
  applyPrecisionEraser,
  applyStrokeEraser,
  getNotebookEraserModeValue,
} from "@/lib/workspace/notebook-eraser";
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
