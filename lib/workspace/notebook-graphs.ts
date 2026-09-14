import {
  compileGraphExpression,
  type GraphAngleUnit,
  type GraphViewWindow,
} from "@/lib/math/graph-expression";

/**
 * A graph placed on a notebook page, kept as the graph itself rather than a picture of one.
 *
 * An illustration of y = x² is only as accurate as whatever drew it, and it
 * cannot be read off, zoomed or corrected. A graph block stores its axes and
 * the functions and points on it, so it is drawn exactly at any size, can be
 * zoomed and re-scaled, and can still be edited after it is on the page.
 */

export const MAX_NOTEBOOK_GRAPHS = 6;
export const MAX_GRAPH_SERIES = 6;
export const MAX_GRAPH_POINTS = 200;
export const MIN_NOTEBOOK_GRAPH_WIDTH = 180;
export const MIN_NOTEBOOK_GRAPH_HEIGHT = 150;

/** The notebook's fixed page coordinate space; see NOTEBOOK_PAGE_COORDINATE_* in notebooks.ts. */
const PAGE_WIDTH = 900;
const PAGE_HEIGHT = 1240;
const LIMIT = 1_000_000;

export const GRAPH_SERIES_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"] as const;
export const GRAPH_POINTS_COLOR = "#0f172a";

export type NotebookGraphPoint = { x: number; y: number };

export type NotebookGraphSeries =
  | {
      id: string;
      kind: "function";
      expression: string;
      color: string;
      angleUnit: GraphAngleUnit;
      label?: string;
    }
  | {
      id: string;
      kind: "points";
      points: NotebookGraphPoint[];
      /** Join the points in order, for a line graph rather than a scatter. */
      connect: boolean;
      color: string;
      label?: string;
    };

/** What a graph shows, independent of where it sits on a page. */
export type NotebookGraphDraft = {
  view: GraphViewWindow;
  showGrid: boolean;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  series: NotebookGraphSeries[];
};

export type NotebookGraphBlock = NotebookGraphDraft & {
  id: string;
  /** Placement in the fixed 900 x 1240 notebook coordinate space. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NotebookGraphResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const text = (value: unknown, maximum: number) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(-LIMIT, Math.min(LIMIT, value)) : fallback;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export const DEFAULT_GRAPH_VIEW: GraphViewWindow = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

/** A view the graph can draw: finite, the right way round, and not collapsed to nothing. */
export function normalizeGraphView(value: unknown): GraphViewWindow {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  let xMin = finite(data.xMin, DEFAULT_GRAPH_VIEW.xMin);
  let xMax = finite(data.xMax, DEFAULT_GRAPH_VIEW.xMax);
  let yMin = finite(data.yMin, DEFAULT_GRAPH_VIEW.yMin);
  let yMax = finite(data.yMax, DEFAULT_GRAPH_VIEW.yMax);
  if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
  if (yMin > yMax) [yMin, yMax] = [yMax, yMin];
  if (xMax - xMin < 1e-6) xMax = xMin + 1;
  if (yMax - yMin < 1e-6) yMax = yMin + 1;
  return { xMin, xMax, yMin, yMax };
}

const color = (value: unknown, index: number) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : GRAPH_SERIES_COLORS[index % GRAPH_SERIES_COLORS.length];

export function normalizeGraphSeries(value: unknown): NotebookGraphSeries[] {
  if (!Array.isArray(value)) return [];
  const series: NotebookGraphSeries[] = [];
  for (const [index, entry] of value.slice(0, MAX_GRAPH_SERIES).entries()) {
    if (!entry || typeof entry !== "object") continue;
    const data = entry as Record<string, unknown>;
    const id = text(data.id, 80) || `series-${index + 1}`;
    const label = text(data.label, 60);
    if (data.kind === "points") {
      const points = (Array.isArray(data.points) ? data.points : [])
        .flatMap((point) => {
          if (!point || typeof point !== "object") return [];
          const { x, y } = point as Record<string, unknown>;
          return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
            ? [{ x: finite(x, 0), y: finite(y, 0) }]
            : [];
        })
        .slice(0, MAX_GRAPH_POINTS);
      if (points.length === 0) continue;
      series.push({
        id,
        kind: "points",
        points,
        connect: data.connect === true,
        color: color(data.color, index),
        ...(label ? { label } : {}),
      });
      continue;
    }
    const expression = text(data.expression, 200);
    if (!expression) continue;
    series.push({
      id,
      kind: "function",
      expression,
      color: color(data.color, index),
      angleUnit: data.angleUnit === "degrees" ? "degrees" : "radians",
      ...(label ? { label } : {}),
    });
  }
  return series;
}

export function normalizeGraphDraft(value: unknown): NotebookGraphDraft {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const title = text(data.title, 80);
  const xLabel = text(data.xLabel, 40);
  const yLabel = text(data.yLabel, 40);
  // Absent optional fields are left out: Firestore rejects an explicit undefined.
  return {
    view: normalizeGraphView(data.view),
    showGrid: data.showGrid !== false,
    series: normalizeGraphSeries(data.series),
    ...(title ? { title } : {}),
    ...(xLabel ? { xLabel } : {}),
    ...(yLabel ? { yLabel } : {}),
  };
}

export function normalizeNotebookGraphBlocks(value: unknown): NotebookGraphBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: NotebookGraphBlock[] = [];
  for (const entry of value.slice(0, MAX_NOTEBOOK_GRAPHS)) {
    if (!entry || typeof entry !== "object") continue;
    const data = entry as Record<string, unknown>;
    const id = text(data.id, 160);
    if (!id) continue;
    const width = clamp(finite(data.width, 520), MIN_NOTEBOOK_GRAPH_WIDTH, PAGE_WIDTH);
    const height = clamp(finite(data.height, 420), MIN_NOTEBOOK_GRAPH_HEIGHT, PAGE_HEIGHT);
    blocks.push({
      id,
      x: clamp(finite(data.x, 0), 0, PAGE_WIDTH - width),
      y: clamp(finite(data.y, 0), 0, PAGE_HEIGHT - height),
      width,
      height,
      ...normalizeGraphDraft(data),
    });
  }
  return blocks;
}

/** A new graph, centred on the page. */
export function createNotebookGraphBlock(
  id: string,
  draft: Partial<NotebookGraphDraft> = {}
): NotebookGraphBlock {
  const width = 520;
  const height = 420;
  return normalizeNotebookGraphBlocks([
    {
      ...draft,
      id,
      x: Math.round((PAGE_WIDTH - width) / 2),
      y: Math.round((PAGE_HEIGHT - height) / 2),
      width,
      height,
    },
  ])[0]!;
}

export function moveNotebookGraphBlock(block: NotebookGraphBlock, deltaX: number, deltaY: number) {
  return normalizeNotebookGraphBlocks([{ ...block, x: block.x + deltaX, y: block.y + deltaY }])[0]!;
}

/**
 * Resize by one corner, keeping the opposite corner pinned. Unlike an image a
 * graph has no fixed shape, so width and height follow the pointer freely.
 */
export function resizeNotebookGraphBlock(
  block: NotebookGraphBlock,
  deltaX: number,
  deltaY: number,
  corner: NotebookGraphResizeCorner = "bottom-right"
) {
  const growsRight = corner === "top-right" || corner === "bottom-right";
  const growsDown = corner === "bottom-left" || corner === "bottom-right";
  const right = block.x + block.width;
  const bottom = block.y + block.height;
  const width = clamp(
    block.width + (growsRight ? deltaX : -deltaX),
    MIN_NOTEBOOK_GRAPH_WIDTH,
    growsRight ? PAGE_WIDTH - block.x : right
  );
  const height = clamp(
    block.height + (growsDown ? deltaY : -deltaY),
    MIN_NOTEBOOK_GRAPH_HEIGHT,
    growsDown ? PAGE_HEIGHT - block.y : bottom
  );
  return normalizeNotebookGraphBlocks([
    {
      ...block,
      x: growsRight ? block.x : right - width,
      y: growsDown ? block.y : bottom - height,
      width,
      height,
    },
  ])[0]!;
}

/** Room around the plotted area for tick labels and a title, in drawing units. */
export const GRAPH_PLOT_PADDING = { left: 44, right: 14, top: 14, bottom: 34 };
const TITLE_HEIGHT = 18;

/** Where the plotted area sits inside a drawing of the given size. */
export function graphPlotArea(width: number, height: number, hasTitle: boolean) {
  const top = GRAPH_PLOT_PADDING.top + (hasTitle ? TITLE_HEIGHT : 0);
  return {
    left: GRAPH_PLOT_PADDING.left,
    right: Math.max(GRAPH_PLOT_PADDING.left + 20, width - GRAPH_PLOT_PADDING.right),
    top,
    bottom: Math.max(top + 20, height - GRAPH_PLOT_PADDING.bottom),
  };
}

/** Evenly spaced round numbers across a range: steps of 1, 2 or 5 times a power of ten. */
export function graphTicks(minimum: number, maximum: number, target = 8) {
  const span = maximum - minimum;
  if (!(span > 0) || !Number.isFinite(span)) return { step: 1, values: [] as number[] };
  const raw = span / Math.max(1, target);
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const values: number[] = [];
  for (
    let value = Math.ceil(minimum / step) * step;
    value <= maximum + step * 1e-9 && values.length < 200;
    value += step
  ) {
    values.push(Number(value.toFixed(decimals)));
  }
  return { step, values };
}

export function formatGraphTick(value: number, step: number) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Zoom around a point of the view: a factor above 1 zooms out, below 1 zooms in. */
export function zoomGraphView(
  view: GraphViewWindow,
  factor: number,
  focus: { x: number; y: number } = { x: (view.xMin + view.xMax) / 2, y: (view.yMin + view.yMax) / 2 }
) {
  const scale = clamp(factor, 0.05, 20);
  return normalizeGraphView({
    xMin: focus.x - (focus.x - view.xMin) * scale,
    xMax: focus.x + (view.xMax - focus.x) * scale,
    yMin: focus.y - (focus.y - view.yMin) * scale,
    yMax: focus.y + (view.yMax - focus.y) * scale,
  });
}

/** Move the view by a distance in the graph's own units. */
export function panGraphView(view: GraphViewWindow, deltaX: number, deltaY: number) {
  return normalizeGraphView({
    xMin: view.xMin + deltaX,
    xMax: view.xMax + deltaX,
    yMin: view.yMin + deltaY,
    yMax: view.yMax + deltaY,
  });
}

/**
 * A view whose y range shows what is plotted across the given x range.
 *
 * The most extreme values are ignored so an asymptote does not squash the rest
 * of a curve into a flat line, the x-axis is kept in view when the curve comes
 * near it, and the ends are rounded out to tick marks.
 */
export function fitGraphYRange(series: NotebookGraphSeries[], xMin: number, xMax: number) {
  const values: number[] = [];
  for (const entry of series) {
    if (entry.kind === "points") {
      for (const point of entry.points) {
        if (point.x >= xMin && point.x <= xMax) values.push(point.y);
      }
      continue;
    }
    const compiled = compileGraphExpression(entry.expression, entry.angleUnit);
    if (!compiled.ok) continue;
    for (let index = 0; index <= 200; index += 1) {
      const y = compiled.evaluate(xMin + ((xMax - xMin) * index) / 200);
      if (Number.isFinite(y)) values.push(y);
    }
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const trim = values.length > 50 ? Math.floor(values.length * 0.02) : 0;
  let low = values[trim]!;
  let high = values[values.length - 1 - trim]!;
  if (high - low < 1e-9) {
    low -= 1;
    high += 1;
  }
  const pad = (high - low) * 0.1;
  low -= pad;
  high += pad;
  if (low > 0 && low <= high - low) low = -pad;
  if (high < 0 && -high <= high - low) high = pad;
  const { step } = graphTicks(low, high);
  return normalizeGraphView({
    xMin,
    xMax,
    yMin: Math.floor(low / step) * step,
    yMax: Math.ceil(high / step) * step,
  });
}

/** Points typed one pair to a line: `1, 2`, `(1, 2)` or `1 2`. */
export function parseGraphPointsText(value: string) {
  const points: NotebookGraphPoint[] = [];
  const invalid: string[] = [];
  for (const raw of value.replace(/[−–]/g, "-").split(/[\n;]+/)) {
    const line = raw.trim().replace(/^\(\s*/, "").replace(/\s*\)$/, "");
    if (!line) continue;
    const parts = line.split(/\s*,\s*|\s+/).filter(Boolean);
    const [x, y] = parts.map(Number);
    if (parts.length === 2 && Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x: x!, y: y! });
    } else {
      invalid.push(raw.trim());
    }
  }
  return { points: points.slice(0, MAX_GRAPH_POINTS), invalid };
}

export function formatGraphPointsText(points: NotebookGraphPoint[]) {
  return points.map((point) => `${point.x}, ${point.y}`).join("\n");
}

/**
 * The graphs on a page, in words, for the Tutor.
 *
 * The page picture the Tutor reads is drawn from ink, text and images, so the
 * graphs would otherwise be invisible to it. Saying exactly what is plotted is
 * also more use to it than a picture of the curve would be.
 */
export function describeNotebookGraphsForTutor(graphs: NotebookGraphBlock[]) {
  if (graphs.length === 0) return "";
  const number = (value: number) => String(Number(value.toPrecision(4)));
  const lines = graphs.map((graph, index) => {
    const plotted = graph.series.map((entry) => {
      if (entry.kind === "function") {
        const degrees = entry.angleUnit === "degrees" && /sin|cos|tan/i.test(entry.expression);
        return `y = ${entry.expression}${degrees ? " (angles in degrees)" : ""}`;
      }
      const shown = entry.points.slice(0, 20).map((point) => `(${point.x}, ${point.y})`);
      const more = entry.points.length > 20 ? ` and ${entry.points.length - 20} more` : "";
      return `points ${shown.join(", ")}${more}${entry.connect ? ", joined" : ""}`;
    });
    const { xMin, xMax, yMin, yMax } = graph.view;
    return `${index + 1}. ${graph.title ? `"${graph.title}": ` : ""}${plotted.join("; ") || "empty axes"}, shown for x from ${number(xMin)} to ${number(xMax)} and y from ${number(yMin)} to ${number(yMax)}`;
  });
  return `Graphs on this page:\n${lines.join("\n")}`;
}
