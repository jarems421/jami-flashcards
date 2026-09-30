import { describe, expect, it } from "vitest";
import {
  examChartIssues,
  frequencyDensities,
  leastSquares,
  niceStep,
  parseExamChart,
  renderExamChartSvg,
  type ExamChartSpec,
} from "@/lib/practice/exam-chart";
import { paperFigureIssues } from "@/lib/practice/asset-routing";
import { sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";

/**
 * Exam graphs are stated as data and drawn by code, so a candidate reading a
 * value off one reads the value the question was written about.
 */
const spring: ExamChartSpec = {
  kind: "graph",
  x: { label: "Force", unit: "N", min: 0, max: 6, step: 1 },
  y: { label: "Extension", unit: "cm", min: 0, max: 12, step: 2 },
  series: [{ points: [[0, 0], [1, 1.9], [2, 4.1], [3, 6], [4, 7.8], [5, 10.2], [6, 11.9]], join: "none", bestFit: true }],
};

describe("reading a graph asset", () => {
  it("reads the JSON chart, fenced or not", () => {
    expect(parseExamChart(JSON.stringify(spring))?.series?.[0].points).toHaveLength(7);
    expect(parseExamChart("```json\n" + JSON.stringify(spring) + "\n```")?.x.unit).toBe("N");
  });

  it("still reads the bare x,y rows older papers were written with", () => {
    const legacy = parseExamChart("x,y\n0,1\n1, 3\nnot a point");
    expect(legacy?.series?.[0].points).toEqual([[0, 1], [1, 3]]);
  });

  it("refuses what is not a chart", () => {
    expect(parseExamChart("a picture of a leaf")).toBeNull();
    expect(parseExamChart('{"kind":"graph"}')).toBeNull();
  });
});

describe("a chart's own arithmetic", () => {
  it("passes a chart that is consistent with itself", () => {
    expect(examChartIssues(spring)).toEqual([]);
  });

  it("refuses a point off the axes", () => {
    const codes = examChartIssues({ ...spring, series: [{ points: [[7, 3]] }] }).map((issue) => issue.code);
    expect(codes).toContain("chart_point_off_scale");
  });

  it("refuses a step that does not divide the scale into whole squares", () => {
    const codes = examChartIssues({ ...spring, y: { ...spring.y, step: 5 } }).map((issue) => issue.code);
    expect(codes).toContain("chart_axis_step");
  });

  it("refuses a blank grid with no scale to plot on", () => {
    const codes = examChartIssues({ kind: "graph", x: { label: "Time", unit: "s" }, y: { label: "Mass", unit: "g", min: 0, max: 10 } }).map((issue) => issue.code);
    expect(codes).toContain("chart_blank_unscaled");
  });

  it("refuses overlapping histogram classes", () => {
    const codes = examChartIssues({
      kind: "histogram",
      x: { label: "Height", unit: "cm" },
      y: { label: "Frequency density" },
      bins: [{ from: 0, to: 10, frequency: 4 }, { from: 5, to: 15, frequency: 6 }],
    }).map((issue) => issue.code);
    expect(codes).toContain("chart_bins_overlap");
  });

  it("refuses an equilibrium marked where no line is drawn", () => {
    const market: ExamChartSpec = {
      kind: "graph",
      x: { label: "Quantity", ticks: false, min: 0, max: 10 },
      y: { label: "Price", ticks: false, min: 0, max: 10 },
      series: [
        { label: "D", points: [[1, 9], [9, 1]], join: "line" },
        { label: "S", points: [[1, 1], [9, 9]], join: "line" },
      ],
      guides: [{ x: 5, y: 5, xLabel: "Q", yLabel: "P" }],
    };
    expect(examChartIssues(market)).toEqual([]);
    const wrong = examChartIssues({ ...market, guides: [{ x: 5, y: 7, xLabel: "Q", yLabel: "P" }] }).map((issue) => issue.code);
    expect(wrong).toContain("chart_guide_off_lines");
  });
});

describe("drawing it", () => {
  it("produces SVG the page's sanitiser keeps whole", () => {
    const svg = renderExamChartSvg(spring);
    const cleaned = sanitizeSvgDiagram(svg);
    expect(cleaned.ok).toBe(true);
    expect(svg.length).toBeLessThan(20_000);
  });

  it("numbers every major line and titles the axes with their units", () => {
    const svg = renderExamChartSvg(spring);
    for (const tick of ["0", "2", "4", "6", "8", "10", "12"]) expect(svg).toContain(`>${tick}</text>`);
    expect(svg).toContain("Force (N)");
    expect(svg).toContain("Extension (cm)");
  });

  it("escapes a label so model text can never open an element", () => {
    const svg = renderExamChartSvg({ ...spring, x: { ...spring.x, label: '<script>alert(1)</script> & "x"' } });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("draws histogram heights as frequency density, whatever the model supplied", () => {
    expect(frequencyDensities([{ from: 5, to: 15, frequency: 40 }])[0].density).toBe(4);
  });
});

describe("scales and fits", () => {
  it("picks tick steps of one, two or five times a power of ten", () => {
    expect(niceStep(60)).toBe(10);
    expect(niceStep(12)).toBe(2);
    expect(niceStep(1.2)).toBe(0.2);
  });

  it("fits the least-squares line", () => {
    const fit = leastSquares([[0, 1], [1, 3], [2, 5]]);
    expect(fit?.gradient).toBeCloseTo(2);
    expect(fit?.intercept).toBeCloseTo(1);
  });
});

describe("the paper's figure checks", () => {
  it("refuse a graph asset whose chart contradicts itself before it is printed", () => {
    const issues = paperFigureIssues(
      [{
        id: "q1",
        prompt: "Use the graph to find the gradient.",
        assets: [{ id: "g1", type: "graph", content: JSON.stringify({ ...spring, series: [{ points: [[9, 20]] }] }) }],
      }],
      { rasterEnabled: false }
    );
    expect(issues.map((issue) => issue.code)).toContain("chart_point_off_scale");
  });
});
