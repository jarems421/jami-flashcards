import { parseAssistantGraphSpec } from "@/lib/ai/assistant-graph";
import { compileGraphExpression } from "@/lib/math/graph-expression";
import {
  graphTicks,
  normalizeGraphDraft,
  normalizeGraphSeries,
  normalizeGraphView,
  type NotebookGraphDraft,
  type NotebookGraphSeries,
} from "@/lib/workspace/notebook-graphs";

/**
 * A question's graph, read as data and drawn exactly.
 *
 * A graph asset used to be a list of x,y rows drawn as one line with only the
 * two ends of each axis labelled, which left every value in between a guess.
 * It is now the same graph spec the Tutor and notebooks use -- functions are
 * computed, points sit where the numbers put them, the axes are ruled at round
 * steps and labelled with their quantities -- so a student reads off a paper's
 * graph what the question means them to read. The older rows still draw, as a
 * joined set of points on the same axes.
 *
 *   {"title":"Figure 1","xLabel":"Time (s)","yLabel":"Speed (m/s)","x":[0,10],"y":[0,20],
 *    "series":[{"label":"Trolley A","points":[[0,0],[2,4],[4,8]],"join":true}],
 *    "functions":["2x"]}
 */

/** What the question writers are told about graph assets. */
export const PAPER_GRAPH_INSTRUCTION =
  'A graph asset\'s content is a JSON object, never SVG or a picture: {"xLabel":"quantity (unit)",' +
  '"yLabel":"quantity (unit)","x":[min,max],"y":[min,max],"series":[{"label":"...","points":[[x,y],...],' +
  '"join":true|false}],"functions":["expression in x, e.g. 0.5*x^2 - 3"]}. Plot measured or tabulated data ' +
  "as series points (join them for a line graph, leave them unjoined for a scatter graph or a graph the " +
  "candidate must draw a line of best fit on); use functions only for exact mathematical curves. Choose x " +
  "and y ranges a real paper would print, usually starting at 0 for measured data, and make every value a " +
  "question asks the candidate to read off lie exactly on the plotted data. Bar charts and histograms are " +
  "not graph assets: draw them as SVG diagrams.";

const MAX_SERIES = 4;

function range(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [low, high] = value;
  return typeof low === "number" && typeof high === "number" && Number.isFinite(low) && Number.isFinite(high) && low !== high
    ? [Math.min(low, high), Math.max(low, high)]
    : null;
}

function pairs(value: unknown) {
  return (Array.isArray(value) ? value : []).map((point) =>
    Array.isArray(point) ? { x: point[0], y: point[1] } : point
  );
}

/** Round axis ends around the data, including 0 where a printed graph would start from it. */
function fittedRange(values: number[]): [number, number] {
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (low >= 0 && low <= (high - low) * 0.6) low = 0;
  if (high <= 0 && -high <= (high - low) * 0.6) high = 0;
  if (high - low < 1e-9) {
    low -= 1;
    high += 1;
  }
  const { step } = graphTicks(low, high, 8);
  return [Math.floor(low / step) * step, Math.ceil(high / step) * step];
}

/** Exam papers are printed in black: series are told apart by their labels. */
function inBlack(series: NotebookGraphSeries[]) {
  return series.map((entry) => ({ ...entry, color: "#111111" }));
}

function readSpec(source: string): NotebookGraphDraft | null {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const spec = data as Record<string, unknown>;
  // Several labelled sets of points: what an experiment's results look like.
  if (!Array.isArray(spec.series)) return parseAssistantGraphSpec(source);

  const angleUnit = spec.angles === "degrees" ? "degrees" : "radians";
  const raw: Array<Record<string, unknown>> = [];
  (spec.series as unknown[]).slice(0, MAX_SERIES).forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    raw.push({ id: `points-${index + 1}`, kind: "points", points: pairs(record.points), connect: record.join === true, label: record.label });
  });
  (Array.isArray(spec.functions) ? spec.functions : []).slice(0, MAX_SERIES).forEach((entry, index) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const expression = typeof entry === "string" ? entry : record.expression;
    if (typeof expression !== "string" || !compileGraphExpression(expression, angleUnit).ok) return;
    raw.push({ id: `function-${index + 1}`, kind: "function", expression, angleUnit, label: record.label });
  });
  const series = normalizeGraphSeries(raw);
  if (series.length === 0) return null;

  const xs = series.flatMap((entry) => (entry.kind === "points" ? entry.points.map((point) => point.x) : []));
  const ys = series.flatMap((entry) => (entry.kind === "points" ? entry.points.map((point) => point.y) : []));
  const [xMin, xMax] = range(spec.x) ?? (xs.length ? fittedRange(xs) : [0, 10]);
  const [yMin, yMax] = range(spec.y) ?? (ys.length ? fittedRange(ys) : [0, 10]);
  return normalizeGraphDraft({
    view: normalizeGraphView({ xMin, xMax, yMin, yMax }),
    series,
    showGrid: spec.grid !== false,
    title: spec.title,
    xLabel: spec.xLabel,
    yLabel: spec.yLabel,
  });
}

/** The older form: `x,y` rows, the first row optionally naming the axes. */
function readRows(content: string): NotebookGraphDraft | null {
  const rows = content.split("\n").map((row) => row.trim()).filter(Boolean);
  const points: Array<{ x: number; y: number }> = [];
  let labels: string[] = [];
  rows.forEach((row, index) => {
    const cells = row.split(/\s*,\s*/);
    const numbers = cells.slice(0, 2).map(Number);
    if (cells.length >= 2 && numbers.every(Number.isFinite)) points.push({ x: numbers[0]!, y: numbers[1]! });
    else if (index === 0 && cells.length >= 2) labels = cells;
  });
  if (points.length < 2) return null;
  const [xMin, xMax] = fittedRange(points.map((point) => point.x));
  const [yMin, yMax] = fittedRange(points.map((point) => point.y));
  return normalizeGraphDraft({
    view: { xMin, xMax, yMin, yMax },
    series: normalizeGraphSeries([{ id: "points", kind: "points", points, connect: true }]),
    showGrid: true,
    xLabel: labels[0],
    yLabel: labels[1],
  });
}

/** A graph asset's content as a graph to draw, or null when it is not one. */
export function readPaperGraph(content: string): NotebookGraphDraft | null {
  const trimmed = content.trim();
  const draft = trimmed.startsWith("{") ? readSpec(trimmed) : readRows(trimmed);
  return draft && draft.series.length > 0 ? { ...draft, series: inBlack(draft.series) } : null;
}

/** The graph in words, for a candidate who cannot see it and for a marker reading the paper as text. */
export function describePaperGraph(graph: NotebookGraphDraft) {
  const number = (value: number) => String(Number(value.toPrecision(4)));
  const axes = `${graph.xLabel || "x"} from ${number(graph.view.xMin)} to ${number(graph.view.xMax)}, ${
    graph.yLabel || "y"
  } from ${number(graph.view.yMin)} to ${number(graph.view.yMax)}`;
  const series = graph.series.map((entry) =>
    entry.kind === "function"
      ? `${entry.label ? `${entry.label}: ` : ""}the curve y = ${entry.expression}`
      : `${entry.label ? `${entry.label}: ` : ""}${entry.connect ? "a line through" : "points at"} ${entry.points
          .slice(0, 20)
          .map((point) => `(${number(point.x)}, ${number(point.y)})`)
          .join(", ")}`
  );
  return `A graph with ${axes}, showing ${series.join("; ")}.`;
}
