import { compileGraphExpression } from "@/lib/math/graph-expression";
import {
  DEFAULT_GRAPH_VIEW,
  fitGraphYRange,
  normalizeGraphDraft,
  normalizeGraphSeries,
  type NotebookGraphDraft,
} from "@/lib/workspace/notebook-graphs";

/**
 * A graph the Tutor drew, read from the fenced `graph` block in its answer.
 *
 * Drawn as SVG, a graph is a picture of one: the curve goes wherever the
 * model's imagined coordinates put it, so a parabola whose vertex is marked at
 * (2, −4) can sit at (2.4, −3). A `graph` block names the functions and points
 * instead, and the curve is computed from them here. What the student reads off
 * it is right, it can be zoomed, and it can go onto their notebook page as a
 * graph they can still edit.
 *
 *   ```graph
 *   {"title":"y = x² − 4","x":[-5,5],"y":[-6,10],"functions":["x^2 - 4"],"points":[[2,0],[-2,0]]}
 *   ```
 */

const MAX_SPEC_LENGTH = 6_000;

function range(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [low, high] = value;
  return typeof low === "number" &&
    typeof high === "number" &&
    Number.isFinite(low) &&
    Number.isFinite(high) &&
    low !== high
    ? [Math.min(low, high), Math.max(low, high)]
    : null;
}

export function parseAssistantGraphSpec(source: string): NotebookGraphDraft | null {
  if (!source || source.length > MAX_SPEC_LENGTH) return null;
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const spec = data as Record<string, unknown>;
  const angleUnit = spec.angles === "degrees" ? "degrees" : "radians";

  const series: Array<Record<string, unknown>> = [];
  for (const [index, entry] of (Array.isArray(spec.functions) ? spec.functions : []).entries()) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const expression = typeof entry === "string" ? entry : record.expression;
    // A function the graph cannot read is left off rather than drawn wrong.
    if (typeof expression !== "string" || !compileGraphExpression(expression, angleUnit).ok) continue;
    series.push({
      id: `function-${index + 1}`,
      kind: "function",
      expression,
      angleUnit,
      label: record.label,
      color: record.color,
    });
  }
  const points = (Array.isArray(spec.points) ? spec.points : []).map((point) =>
    Array.isArray(point) ? { x: point[0], y: point[1] } : point
  );
  if (points.length > 0) {
    series.push({
      id: "points",
      kind: "points",
      points,
      connect: spec.joinPoints === true,
      label: spec.pointsLabel,
    });
  }
  const normalizedSeries = normalizeGraphSeries(series);
  if (normalizedSeries.length === 0) return null;

  const [xMin, xMax] = range(spec.x) ?? [DEFAULT_GRAPH_VIEW.xMin, DEFAULT_GRAPH_VIEW.xMax];
  const fitted = range(spec.y) ? null : fitGraphYRange(normalizedSeries, xMin, xMax);
  const [yMin, yMax]: [number, number] =
    range(spec.y) ??
    (fitted ? [fitted.yMin, fitted.yMax] : [DEFAULT_GRAPH_VIEW.yMin, DEFAULT_GRAPH_VIEW.yMax]);

  return normalizeGraphDraft({
    view: { xMin, xMax, yMin, yMax },
    series: normalizedSeries,
    showGrid: spec.grid !== false,
    title: spec.title,
    xLabel: spec.xLabel,
    yLabel: spec.yLabel,
  });
}
