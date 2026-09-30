import { describe, expect, it } from "vitest";
import { describePaperGraph, readPaperGraph } from "@/lib/practice/paper-graph";

describe("reading a paper's graph as data", () => {
  it("reads several labelled series with axes and ranges as written", () => {
    const graph = readPaperGraph(
      JSON.stringify({
        xLabel: "Time in s",
        yLabel: "Speed in m/s",
        x: [0, 10],
        y: [0, 20],
        series: [
          { label: "Trolley A", points: [[0, 0], [2, 4], [4, 8]], join: true },
          { label: "Trolley B", points: [[0, 0], [2, 3]] },
        ],
      })
    );
    expect(graph?.view).toEqual({ xMin: 0, xMax: 10, yMin: 0, yMax: 20 });
    expect(graph?.xLabel).toBe("Time in s");
    expect(graph?.series.map((entry) => (entry.kind === "points" ? [entry.label, entry.connect] : null))).toEqual([
      ["Trolley A", true],
      ["Trolley B", false],
    ]);
    // Printed in black, like the paper.
    expect(graph?.series.every((entry) => entry.color === "#111111")).toBe(true);
  });

  it("reads the Tutor's function spec", () => {
    const graph = readPaperGraph('{"x":[-5,5],"y":[-6,10],"functions":["x^2 - 4"],"points":[[2,0],[-2,0]]}');
    expect(graph?.series.map((entry) => entry.kind)).toEqual(["function", "points"]);
  });

  it("still draws the older x,y rows, starting a measured axis at 0", () => {
    const graph = readPaperGraph("Mass (kg),Extension (cm)\n1,2\n2,4.1\n3,6");
    expect(graph?.xLabel).toBe("Mass (kg)");
    expect(graph?.yLabel).toBe("Extension (cm)");
    expect(graph?.view.xMin).toBe(0);
    expect(graph?.view.yMin).toBe(0);
    expect(graph?.view.yMax).toBeGreaterThanOrEqual(6);
  });

  it("refuses content that is not a graph", () => {
    expect(readPaperGraph("A graph showing a straight line")).toBeNull();
    expect(readPaperGraph('{"functions":["not a function (("]}')).toBeNull();
  });

  it("describes a graph in words for a reader who cannot see it", () => {
    const graph = readPaperGraph('{"xLabel":"t","yLabel":"v","x":[0,4],"y":[0,8],"series":[{"points":[[0,0],[4,8]],"join":true}]}');
    expect(graph && describePaperGraph(graph)).toBe("A graph with t from 0 to 4, v from 0 to 8, showing a line through (0, 0), (4, 8).");
  });
});
