import { describe, expect, it } from "vitest";
import {
  createNotebookGraphBlock,
  describeNotebookGraphsForTutor,
  fitGraphYRange,
  formatGraphTick,
  graphTicks,
  MAX_GRAPH_POINTS,
  moveNotebookGraphBlock,
  normalizeGraphView,
  normalizeNotebookGraphBlocks,
  panGraphView,
  parseGraphPointsText,
  resizeNotebookGraphBlock,
  zoomGraphView,
} from "@/lib/workspace/notebook-graphs";

describe("normalizeNotebookGraphBlocks", () => {
  it("keeps a valid graph and leaves absent optional fields out", () => {
    const [block] = normalizeNotebookGraphBlocks([
      {
        id: "g1",
        x: 100,
        y: 200,
        width: 400,
        height: 300,
        view: { xMin: -5, xMax: 5, yMin: -2, yMax: 8 },
        series: [{ id: "s1", kind: "function", expression: "x^2", color: "#123456", angleUnit: "degrees" }],
      },
    ]);
    expect(block).toMatchObject({ id: "g1", x: 100, y: 200, width: 400, height: 300, showGrid: true });
    expect(block.series[0]).toEqual({ id: "s1", kind: "function", expression: "x^2", color: "#123456", angleUnit: "degrees" });
    // Firestore rejects an explicit undefined, so these must be absent, not undefined.
    expect("title" in block).toBe(false);
    expect("xLabel" in block).toBe(false);
  });

  it("keeps a graph on the page and at a usable size", () => {
    const [block] = normalizeNotebookGraphBlocks([{ id: "g1", x: 5000, y: -40, width: 20, height: 99999 }]);
    expect(block.width).toBeGreaterThanOrEqual(180);
    expect(block.height).toBeLessThanOrEqual(1240);
    expect(block.x + block.width).toBeLessThanOrEqual(900);
    expect(block.y).toBe(0);
  });

  it("drops what it cannot draw, and caps what it can", () => {
    const [block] = normalizeNotebookGraphBlocks([
      {
        id: "g1",
        series: [
          { kind: "function", expression: "" },
          { kind: "points", points: [{ x: "a", y: 1 }] },
          { kind: "points", points: Array.from({ length: 500 }, (_, i) => ({ x: i, y: i })), color: "red" },
        ],
      },
    ]);
    expect(normalizeNotebookGraphBlocks([{ x: 1 }])).toEqual([]);
    expect(block.series).toHaveLength(1);
    const points = block.series[0];
    expect(points.kind === "points" && points.points.length).toBe(MAX_GRAPH_POINTS);
    expect(points.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("graph views", () => {
  it("repairs a view that is backwards or collapsed", () => {
    expect(normalizeGraphView({ xMin: 5, xMax: -5, yMin: 2, yMax: 2 })).toEqual({ xMin: -5, xMax: 5, yMin: 2, yMax: 3 });
  });

  it("zooms around its centre and pans in graph units", () => {
    expect(zoomGraphView({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, 0.5)).toEqual({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 });
    expect(panGraphView({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, 2, -1)).toEqual({ xMin: 2, xMax: 12, yMin: -1, yMax: 9 });
  });

  it("chooses round tick steps", () => {
    expect(graphTicks(-10, 10).step).toBe(5);
    expect(graphTicks(0, 1).values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(formatGraphTick(-0.0000001, 0.2)).toBe("0");
  });

  it("fits the y range to a curve, keeping the x-axis in view", () => {
    const fitted = fitGraphYRange(
      [{ id: "f", kind: "function", expression: "x^2", color: "#2563eb", angleUnit: "radians" }],
      -5,
      5
    );
    expect(fitted).not.toBeNull();
    expect(fitted!.yMin).toBeLessThanOrEqual(0);
    expect(fitted!.yMax).toBeGreaterThanOrEqual(24);
    expect(fitted!.yMax).toBeLessThanOrEqual(30);
  });

  it("does not let an asymptote flatten the rest of the curve", () => {
    const fitted = fitGraphYRange(
      [{ id: "f", kind: "function", expression: "1/(x - 0.001)", color: "#2563eb", angleUnit: "radians" }],
      -5,
      5
    );
    expect(fitted!.yMax).toBeLessThan(100);
  });
});

describe("parseGraphPointsText", () => {
  it("reads the ways a student writes a point, and reports the lines it cannot", () => {
    expect(parseGraphPointsText("1, 2\n(3, −4)\n5 6\nbad\n\n")).toEqual({
      points: [
        { x: 1, y: 2 },
        { x: 3, y: -4 },
        { x: 5, y: 6 },
      ],
      invalid: ["bad"],
    });
  });
});

describe("describeNotebookGraphsForTutor", () => {
  it("tells the Tutor exactly what each graph plots", () => {
    const graph = createNotebookGraphBlock("g1", {
      title: "Sine",
      view: { xMin: 0, xMax: 360, yMin: -1.5, yMax: 1.5 },
      series: [
        { id: "f", kind: "function", expression: "sin x", color: "#2563eb", angleUnit: "degrees" },
        { id: "p", kind: "points", points: [{ x: 90, y: 1 }], connect: false, color: "#0f172a" },
      ],
    });
    expect(describeNotebookGraphsForTutor([graph])).toBe(
      'Graphs on this page:\n1. "Sine": y = sin x (angles in degrees); points (90, 1), shown for x from 0 to 360 and y from -1.5 to 1.5'
    );
    expect(describeNotebookGraphsForTutor([])).toBe("");
  });
});

describe("placing a graph", () => {
  it("centres a new graph and moves and resizes it within the page", () => {
    const block = createNotebookGraphBlock("g1");
    expect(block.x).toBe(190);
    expect(moveNotebookGraphBlock(block, 10_000, 0).x + block.width).toBe(900);
    const grown = resizeNotebookGraphBlock(block, 100, 50, "bottom-right");
    expect([grown.width, grown.height]).toEqual([620, 470]);
    const fromTopLeft = resizeNotebookGraphBlock(block, -40, -30, "top-left");
    expect(fromTopLeft.x + fromTopLeft.width).toBe(block.x + block.width);
  });
});
