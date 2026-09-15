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

/** The most graphs one Tutor answer carries. */
export const MAX_TUTOR_GRAPHS = 3;

/** A spec that reads as a graph, rewritten compactly; or null. */
function canonicalGraphSpec(source: string) {
  const trimmed = source
    .trim()
    .replace(/^`{0,3}\s*(?:graph)?\s*(?=\{)/i, "")
    .replace(/\s*`{1,3}n?\s*$/, "");
  if (!parseAssistantGraphSpec(trimmed)) return null;
  return JSON.stringify(JSON.parse(trimmed));
}

/**
 * The graphs the Tutor put in its answer's `graphs` field.
 *
 * Each is asked for as a JSON object written as a string, and accepted as a bare
 * object too. Anything that does not read as a graph is dropped rather than
 * drawn wrong.
 */
export function readTutorGraphSpecs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const specs = value.flatMap((item) => {
    const source =
      typeof item === "string" ? item : item && typeof item === "object" ? JSON.stringify(item) : "";
    const spec = source ? canonicalGraphSpec(source) : null;
    return spec ? [spec] : [];
  });
  return [...new Set(specs)].slice(0, MAX_TUTOR_GRAPHS);
}

/**
 * Graph blocks the Tutor wrote into the answer text itself, taken out of it.
 *
 * Asked not to, a model still sometimes does, and the worker model cannot write
 * a code fence inside a JSON string: measured on GLM 5.3 Flash, the opening
 * backticks went missing and the closing ones came out as "``n" on three runs of
 * three. Left alone that is a block of raw JSON in the middle of the answer. So
 * any block that reads as a graph -- fenced properly or not -- is lifted out, to
 * be drawn from the graphs it joins.
 */
export function extractTutorGraphs(answer: string): { answer: string; graphs: string[] } {
  const graphs: string[] = [];
  const lift = (match: string, source: string) => {
    const spec = canonicalGraphSpec(source);
    if (!spec) return match;
    graphs.push(spec);
    return "\n";
  };
  const text = answer
    .replace(/`{3}[ \t]*graph[ \t]*\n([\s\S]*?)\n[ \t]*`{2,3}n?(?=\s|$)/gi, lift)
    .replace(/(?:^|\n)[ \t]*`{0,2}[ \t]*graph[ \t]*\n[ \t]*(\{[^\n]*\})[ \t]*(?:\n[ \t]*`{1,3}n?)?(?=\n|$)/gi, lift);
  return { answer: text.replace(/\n{3,}/g, "\n\n").trim(), graphs: [...new Set(graphs)] };
}

/**
 * The answer with each graph drawn where the Tutor marked it.
 *
 * `[graph 1]` becomes the first graph's block, and so on. A graph with no marker
 * goes before the text, which starts from what was asked for; a marker with no
 * graph behind it is removed, since it would say nothing to a student.
 */
export function placeTutorGraphs(answer: string, graphs: readonly string[]) {
  let text = answer;
  const unmarked: string[] = [];
  graphs.slice(0, MAX_TUTOR_GRAPHS).forEach((spec, index) => {
    const block = "```graph\n" + spec + "\n```";
    const marker = new RegExp(`\\[{1,2}\\s*graph(?:\\s*${index + 1})?\\s*\\]{1,2}`, "i");
    if (marker.test(text)) text = text.replace(marker, () => `\n\n${block}\n\n`);
    else unmarked.push(block);
  });
  text = text.replace(/\[{1,2}\s*graph(?:\s*\d+)?\s*\]{1,2}/gi, "");
  return [...unmarked, text]
    .filter((part) => part.trim())
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
