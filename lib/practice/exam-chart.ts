/**
 * An exam graph, stated as data and drawn by code.
 *
 * A graph on an exam paper is a measuring instrument: a candidate reads values
 * off it, finds a gradient, plots on its grid. So it has to be exact, and a
 * model writing SVG coordinates by hand is not -- a point meant for (40, 62)
 * lands wherever its arithmetic put it, gridlines drift off the tick values,
 * and nothing downstream can tell. The generator's other option was a bare
 * list of x,y rows, drawn with only the two ends of each axis labelled.
 *
 * Here the model states what the graph is -- axes, scales, units, points,
 * bars, bins -- and this file draws it the way exam graphs are drawn: graph
 * paper with minor squares, ticks at every major line, numbered scales, axis
 * titles with units, plotted crosses, a line of best fit computed rather than
 * guessed, histogram bars whose heights are frequency density worked out here.
 * The same SVG goes into the printed booklet and the app, so the two agree.
 *
 * It also covers the diagrams economics draws on unnumbered axes -- supply and
 * demand, costs and revenue -- with labelled lines and dashed guides to the
 * axes, because those are the same instrument without the numbers.
 *
 * The output uses only elements and attributes `svg-diagram.ts` allows, and
 * every piece of model text is escaped, so it passes the same sanitiser as any
 * other diagram on its way to the page.
 */

export type ExamChartAxis = {
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  /** The interval between numbered major gridlines. */
  step?: number;
  /** False for an unnumbered axis, as economics diagrams draw them. */
  ticks?: boolean;
};

export type ExamChartSeries = {
  label?: string;
  points: Array<[number, number]>;
  /** How the points are joined: straight lines, a smooth curve, or not at all (a scatter graph). */
  join?: "line" | "curve" | "none";
  marker?: "cross" | "dot" | "none";
  dashed?: boolean;
  /** Draw the least-squares line through these points. */
  bestFit?: boolean;
};

export type ExamChartSpec = {
  kind: "graph" | "bar" | "histogram";
  x: ExamChartAxis;
  y: ExamChartAxis;
  series?: ExamChartSeries[];
  bars?: Array<{ label: string; value: number }>;
  /** Class intervals and frequencies; the heights drawn are frequency density. */
  bins?: Array<{ from: number; to: number; frequency: number }>;
  /** Dashed lines from a point to both axes, labelled where they meet them. */
  guides?: Array<{ x: number; y: number; xLabel?: string; yLabel?: string }>;
  /** Graph paper. On by default wherever the axes are numbered. */
  grid?: boolean;
};

const WIDTH = 480;
const HEIGHT = 340;
const FONT = 'font-family="Helvetica, Arial, sans-serif"';
const INK = "#111111";
const MAJOR_GRID = "#9a9a9a";
const MINOR_GRID = "#d6d6d6";
const MINOR_PER_MAJOR = 5;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A tick interval of 1, 2 or 5 times a power of ten, giving roughly five to ten ticks. */
export function niceStep(span: number, target = 6) {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Tidy a floating-point tick value: 0.30000000000000004 prints as 0.3. */
function tickValue(value: number) {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function tickLabel(value: number) {
  return String(tickValue(value));
}

type ResolvedAxis = { label: string; unit?: string; min: number; max: number; step: number; ticks: boolean };

/** The axis the chart will actually draw: stated where stated, fitted to the data where not. */
function resolveAxis(axis: ExamChartAxis, values: number[], forceZero: boolean): ResolvedAxis {
  const ticks = axis.ticks !== false;
  const dataMin = values.length ? Math.min(...values) : 0;
  const dataMax = values.length ? Math.max(...values) : 10;
  let min = finite(axis.min) ? axis.min : forceZero || dataMin >= 0 ? 0 : dataMin;
  let max = finite(axis.max) ? axis.max : dataMax;
  if (!(max > min)) max = min + 1;
  const step = finite(axis.step) && axis.step > 0 ? axis.step : niceStep(max - min);
  // An unstated end is rounded outward to a major line, as graph paper would be ruled.
  if (!finite(axis.min)) min = Math.floor(min / step) * step;
  if (!finite(axis.max)) max = Math.ceil(max / step) * step;
  if (!(max > min)) max = min + step;
  return { label: axis.label?.trim() ?? "", unit: axis.unit?.trim() || undefined, min, max, step, ticks };
}

function axisTitle(axis: ResolvedAxis) {
  if (!axis.unit || axis.label.includes(axis.unit)) return axis.label;
  return `${axis.label} (${axis.unit})`;
}

/** Least squares through the points, or null where they cannot define a line. */
export function leastSquares(points: ReadonlyArray<readonly [number, number]>) {
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
  const sxx = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const gradient = sxy / sxx;
  return { gradient, intercept: meanY - gradient * meanX };
}

/** A smooth curve through the points that never overshoots them (monotone cubic). */
function curvePath(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const n = points.length;
  const slopes: number[] = [];
  for (let index = 0; index < n - 1; index += 1) {
    const dx = points[index + 1].x - points[index].x;
    slopes.push(dx === 0 ? 0 : (points[index + 1].y - points[index].y) / dx);
  }
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === n - 1) return slopes[n - 2];
    return slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
  });
  let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < n - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const third = (to.x - from.x) / 3;
    d += ` C${(from.x + third).toFixed(2)} ${(from.y + tangents[index] * third).toFixed(2)} ${(to.x - third).toFixed(2)} ${(to.y - tangents[index + 1] * third).toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
  }
  return d;
}

/**
 * Read a graph asset's content: the JSON spec the generator is asked for, or
 * the bare x,y rows older papers were written with.
 */
export function parseExamChart(content: string): ExamChartSpec | null {
  const trimmed = String(content ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (trimmed.startsWith("{")) {
    try {
      const value = JSON.parse(trimmed) as Partial<ExamChartSpec>;
      if (!value || typeof value !== "object" || !value.x || !value.y) return null;
      const kind = value.kind === "bar" || value.kind === "histogram" ? value.kind : "graph";
      const series = Array.isArray(value.series)
        ? value.series.flatMap((entry) => {
            if (!entry || !Array.isArray(entry.points)) return [];
            const points = entry.points.flatMap((point) =>
              Array.isArray(point) && finite(Number(point[0])) && finite(Number(point[1]))
                ? [[Number(point[0]), Number(point[1])] as [number, number]]
                : []
            );
            return [{ ...entry, points }];
          })
        : undefined;
      return {
        kind,
        x: { ...value.x, label: String(value.x.label ?? "") },
        y: { ...value.y, label: String(value.y.label ?? "") },
        ...(series ? { series } : {}),
        ...(Array.isArray(value.bars) ? { bars: value.bars.filter((bar) => bar && finite(Number(bar.value))).map((bar) => ({ label: String(bar.label ?? ""), value: Number(bar.value) })) } : {}),
        ...(Array.isArray(value.bins)
          ? {
              bins: value.bins
                .filter((bin) => bin && finite(Number(bin.from)) && finite(Number(bin.to)) && finite(Number(bin.frequency)))
                .map((bin) => ({ from: Number(bin.from), to: Number(bin.to), frequency: Number(bin.frequency) })),
            }
          : {}),
        ...(Array.isArray(value.guides) ? { guides: value.guides.filter((guide) => guide && finite(Number(guide.x)) && finite(Number(guide.y))) } : {}),
        ...(typeof value.grid === "boolean" ? { grid: value.grid } : {}),
      };
    } catch {
      return null;
    }
  }
  const points = trimmed.split("\n").flatMap((row) => {
    const numbers = row.split(/[,\s]+/).filter(Boolean).map(Number);
    return numbers.length >= 2 && finite(numbers[0]) && finite(numbers[1]) ? [[numbers[0], numbers[1]] as [number, number]] : [];
  });
  if (points.length < 2) return null;
  return { kind: "graph", x: { label: "" }, y: { label: "" }, series: [{ points, join: "line", marker: "cross" }] };
}

/**
 * What a chart states that cannot be true of itself. Arithmetic only, so it
 * runs before anything is printed and needs no model.
 */
export function examChartIssues(spec: ExamChartSpec): { code: string; detail: string }[] {
  const issues: { code: string; detail: string }[] = [];
  const fail = (code: string, detail: string) => issues.push({ code, detail });
  for (const [name, axis] of [["x", spec.x], ["y", spec.y]] as const) {
    if (axis.ticks !== false && !axis.label?.trim()) fail("chart_axis_unlabelled", `The ${name}-axis has numbers and no title.`);
    if (finite(axis.min) && finite(axis.max) && !(axis.max > axis.min)) {
      fail("chart_axis_range", `The ${name}-axis runs from ${axis.min} to ${axis.max}.`);
    }
    if (finite(axis.min) && finite(axis.max) && finite(axis.step) && axis.step > 0) {
      const count = (axis.max - axis.min) / axis.step;
      if (Math.abs(count - Math.round(count)) > 1e-6) {
        fail("chart_axis_step", `The ${name}-axis step of ${axis.step} does not divide ${axis.min} to ${axis.max} into whole squares.`);
      } else if (count > 20) {
        fail("chart_axis_step", `The ${name}-axis has ${Math.round(count)} numbered lines; a readable scale has at most 20.`);
      }
    }
  }
  const within = (value: number, axis: ExamChartAxis) =>
    (!finite(axis.min) || value >= axis.min - 1e-9) && (!finite(axis.max) || value <= axis.max + 1e-9);
  for (const [index, series] of (spec.series ?? []).entries()) {
    const outside = series.points.filter(([x, y]) => !within(x, spec.x) || !within(y, spec.y));
    if (outside.length) {
      fail("chart_point_off_scale", `Series ${index + 1} has ${outside.length} point(s) off the axes, e.g. (${outside[0].join(", ")}).`);
    }
    if (series.bestFit && series.points.length < 3) fail("chart_best_fit", `Series ${index + 1} asks for a line of best fit through fewer than three points.`);
  }
  /*
   * A guide marks a point on the drawing -- an equilibrium, a reading off a
   * curve -- so it must sit on at least one drawn line. One off every line is
   * an intersection worked out wrong, and the candidate is told a price the
   * diagram does not show.
   */
  const lines = (spec.series ?? []).filter((series) => series.join !== "none" && series.points.length > 1);
  if (lines.length) {
    const xSpan = (finite(spec.x.max) && finite(spec.x.min) ? spec.x.max - spec.x.min : 10) || 10;
    const ySpan = (finite(spec.y.max) && finite(spec.y.min) ? spec.y.max - spec.y.min : 10) || 10;
    for (const guide of spec.guides ?? []) {
      const onLine = lines.some((series) => {
        const points = [...series.points].sort(([ax], [bx]) => ax - bx);
        return points.slice(1).some(([x2, y2], index) => {
          const [x1, y1] = points[index];
          if (guide.x < Math.min(x1, x2) - 1e-9 || guide.x > Math.max(x1, x2) + 1e-9) return false;
          const expected = x2 === x1 ? y1 : y1 + ((guide.x - x1) / (x2 - x1)) * (y2 - y1);
          return Math.abs(expected - guide.y) / ySpan < 0.02 || (x2 === x1 && Math.abs(guide.x - x1) / xSpan < 0.02);
        });
      });
      if (!onLine) fail("chart_guide_off_lines", `The guide at (${guide.x}, ${guide.y}) is not on any line drawn.`);
    }
  }
  if (spec.kind === "bar") {
    if (!spec.bars?.length) fail("chart_no_bars", "A bar chart with no bars.");
    for (const bar of spec.bars ?? []) {
      if (bar.value < 0) fail("chart_bar_negative", `Bar "${bar.label}" is negative.`);
      if (!within(bar.value, spec.y)) fail("chart_point_off_scale", `Bar "${bar.label}" (${bar.value}) is off the scale.`);
    }
  }
  if (spec.kind === "histogram") {
    const bins = [...(spec.bins ?? [])].sort((left, right) => left.from - right.from);
    if (!bins.length) fail("chart_no_bins", "A histogram with no class intervals.");
    for (const [index, bin] of bins.entries()) {
      if (!(bin.to > bin.from)) fail("chart_bin_width", `Class ${bin.from} to ${bin.to} has no width.`);
      if (bin.frequency < 0) fail("chart_bin_negative", `Class ${bin.from} to ${bin.to} has a negative frequency.`);
      if (index > 0 && bin.from < bins[index - 1].to - 1e-9) {
        fail("chart_bins_overlap", `Classes ${bins[index - 1].from}-${bins[index - 1].to} and ${bin.from}-${bin.to} overlap.`);
      }
    }
  }
  const blank = spec.kind === "graph" && !(spec.series ?? []).some((series) => series.points.length > 0);
  if (blank && [spec.x, spec.y].some((axis) => axis.ticks !== false && !(finite(axis.min) && finite(axis.max)))) {
    fail("chart_blank_unscaled", "A blank grid for plotting needs both axes' ranges stated, so the candidate has a scale to plot on.");
  }
  return issues;
}

/** Frequency density for each class: what a histogram's bar heights are. */
export function frequencyDensities(bins: ReadonlyArray<{ from: number; to: number; frequency: number }>) {
  return bins.map((bin) => ({ ...bin, density: bin.to > bin.from ? bin.frequency / (bin.to - bin.from) : 0 }));
}

/** The chart as SVG, inside the allowlist every diagram is sanitised against. */
export function renderExamChartSvg(spec: ExamChartSpec): string {
  const bars = spec.kind === "bar" ? spec.bars ?? [] : [];
  const bins = spec.kind === "histogram" ? frequencyDensities(spec.bins ?? []) : [];
  const series = spec.kind === "graph" ? spec.series ?? [] : [];
  const xValues =
    spec.kind === "histogram"
      ? bins.flatMap((bin) => [bin.from, bin.to])
      : [...series.flatMap((entry) => entry.points.map(([x]) => x)), ...(spec.guides ?? []).map((guide) => guide.x)];
  const yValues =
    spec.kind === "bar"
      ? bars.map((bar) => bar.value)
      : spec.kind === "histogram"
        ? bins.map((bin) => bin.density)
        : [...series.flatMap((entry) => entry.points.map(([, y]) => y)), ...(spec.guides ?? []).map((guide) => guide.y)];
  const x = spec.kind === "bar" ? null : resolveAxis(spec.x, xValues, false);
  const y = resolveAxis(
    spec.kind === "histogram" && !spec.y.label ? { ...spec.y, label: "Frequency density" } : spec.y,
    yValues,
    spec.kind !== "graph"
  );
  const labelledLines = series.some((entry) => entry.label && entry.join !== "none");

  // Guide labels (P1, Q1) need the room a numbered scale would have, or the axis titles run into them.
  const guideY = (spec.guides ?? []).some((guide) => guide.yLabel);
  const guideX = (spec.guides ?? []).some((guide) => guide.xLabel);
  const left = y.ticks || guideY ? 66 : 40;
  const right = WIDTH - (labelledLines ? 40 : 18);
  const top = 14;
  const bottom = HEIGHT - (x?.ticks !== false || guideX ? 52 : 36);
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const px = (value: number) => (x ? left + ((value - x.min) / (x.max - x.min)) * plotWidth : left);
  const py = (value: number) => bottom - ((value - y.min) / (y.max - y.min)) * plotHeight;
  const out: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width: number, extra = "") =>
    out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="${width}"${extra}/>`);
  const text = (tx: number, ty: number, value: string, anchor: "start" | "middle" | "end", size = 11, extra = "") =>
    out.push(`<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" ${FONT} font-size="${size}" text-anchor="${anchor}" fill="${INK}"${extra}>${escapeText(value)}</text>`);

  // Graph paper: minor squares, then the numbered major lines over them.
  const grid = spec.grid ?? (y.ticks && (x?.ticks ?? true));
  if (grid) {
    // One path per layer rather than a line per rule: a dense grid as separate
    // elements outgrows the sanitiser's size cap and falls back to text.
    const verticals = x ? Math.round((x.max - x.min) / x.step) : 0;
    const horizontals = Math.round((y.max - y.min) / y.step);
    const minor: string[] = [];
    const major: string[] = [];
    for (let index = 0; index <= horizontals * MINOR_PER_MAJOR; index += 1) {
      const gy = (bottom - (index / (horizontals * MINOR_PER_MAJOR)) * plotHeight).toFixed(1);
      (index % MINOR_PER_MAJOR ? minor : major).push(`M${left} ${gy}H${right}`);
    }
    for (let index = 0; x && index <= verticals * MINOR_PER_MAJOR; index += 1) {
      const gx = (left + (index / (verticals * MINOR_PER_MAJOR)) * plotWidth).toFixed(1);
      (index % MINOR_PER_MAJOR ? minor : major).push(`M${gx} ${top}V${bottom}`);
    }
    if (minor.length) out.push(`<path d="${minor.join("")}" fill="none" stroke="${MINOR_GRID}" stroke-width="0.4"/>`);
    if (major.length) out.push(`<path d="${major.join("")}" fill="none" stroke="${MAJOR_GRID}" stroke-width="0.7"/>`);
  }

  // Axes, with numbered ticks at every major line.
  line(left, bottom, right, bottom, INK, 1.2);
  line(left, top, left, bottom, INK, 1.2);
  if (y.ticks) {
    const count = Math.round((y.max - y.min) / y.step);
    for (let index = 0; index <= count; index += 1) {
      const value = tickValue(y.min + index * y.step);
      line(left - 4, py(value), left, py(value), INK, 1);
      text(left - 7, py(value) + 3.8, tickLabel(value), "end");
    }
  }
  if (x && x.ticks) {
    const count = Math.round((x.max - x.min) / x.step);
    for (let index = 0; index <= count; index += 1) {
      const value = tickValue(x.min + index * x.step);
      line(px(value), bottom, px(value), bottom + 4, INK, 1);
      text(px(value), bottom + 16, tickLabel(value), "middle");
    }
  }
  const xTitle = spec.kind === "bar" ? spec.x.label : x ? axisTitle(x) : "";
  if (xTitle) text((left + right) / 2, HEIGHT - 8, xTitle, "middle", 12);
  const yTitle = axisTitle(y);
  if (yTitle) {
    const cx = left > 40 ? 16 : 22;
    const cy = (top + bottom) / 2;
    text(cx, cy, yTitle, "middle", 12, ` transform="rotate(-90 ${cx} ${cy.toFixed(2)})"`);
  }

  // Bars: equal widths with gaps, labelled beneath.
  if (bars.length) {
    const slot = plotWidth / bars.length;
    bars.forEach((bar, index) => {
      const barWidth = slot * 0.6;
      const bx = left + slot * index + (slot - barWidth) / 2;
      const top0 = py(Math.max(y.min, Math.min(y.max, bar.value)));
      out.push(`<rect x="${bx.toFixed(2)}" y="${top0.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(bottom - top0).toFixed(2)}" fill="#cfcfcf" stroke="${INK}" stroke-width="1"/>`);
      text(left + slot * index + slot / 2, bottom + 16, bar.label, "middle");
    });
  }

  // Histogram: touching bars, height = frequency density.
  for (const bin of bins) {
    const barTop = py(Math.max(y.min, Math.min(y.max, bin.density)));
    out.push(`<rect x="${px(bin.from).toFixed(2)}" y="${barTop.toFixed(2)}" width="${(px(bin.to) - px(bin.from)).toFixed(2)}" height="${(bottom - barTop).toFixed(2)}" fill="#cfcfcf" stroke="${INK}" stroke-width="1"/>`);
  }

  // Guides: dashed to both axes, labelled where they meet them.
  for (const guide of spec.guides ?? []) {
    const gx = px(guide.x);
    const gy = py(guide.y);
    line(left, gy, gx, gy, INK, 0.8, ' stroke-dasharray="4 3"');
    line(gx, gy, gx, bottom, INK, 0.8, ' stroke-dasharray="4 3"');
    if (guide.yLabel) text(left - 6, gy + 3.8, guide.yLabel, "end");
    if (guide.xLabel) text(gx, bottom + 16, guide.xLabel, "middle");
  }

  // Series: joined as asked, points marked as crosses the way exam graphs plot them.
  for (const entry of series) {
    const points = [...entry.points].sort(([ax], [bx]) => ax - bx).map(([vx, vy]) => ({ x: px(vx), y: py(vy) }));
    const dash = entry.dashed ? ' stroke-dasharray="6 4"' : "";
    if (points.length > 1 && entry.join !== "none") {
      const d = entry.join === "curve"
        ? curvePath(points)
        : points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
      out.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.4"${dash}/>`);
    }
    const marker = entry.marker ?? (entry.join === "none" || entry.join === undefined ? "cross" : "none");
    for (const point of points) {
      if (marker === "cross") {
        line(point.x - 3.5, point.y - 3.5, point.x + 3.5, point.y + 3.5, INK, 1.2);
        line(point.x - 3.5, point.y + 3.5, point.x + 3.5, point.y - 3.5, INK, 1.2);
      } else if (marker === "dot") {
        out.push(`<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="2.4" fill="${INK}"/>`);
      }
    }
    if (entry.bestFit && x) {
      const fit = leastSquares(entry.points);
      if (fit) {
        const xs = entry.points.map(([vx]) => vx);
        const from = Math.min(...xs);
        const to = Math.max(...xs);
        const clamp = (value: number) => Math.max(y.min, Math.min(y.max, value));
        line(px(from), py(clamp(fit.gradient * from + fit.intercept)), px(to), py(clamp(fit.gradient * to + fit.intercept)), INK, 1.2);
      }
    }
    if (entry.label && entry.join !== "none" && points.length) {
      const last = points[points.length - 1];
      text(Math.min(last.x + 5, WIDTH - 4), last.y + 4, entry.label, "start", 12, ' font-weight="bold"');
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}"><rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>${out.join("")}</svg>`;
}

/** The instruction the paper designer is given for a graph asset. */
export const EXAM_CHART_INSTRUCTION =
  'A graph asset\'s content is a JSON chart, never drawn SVG: the numbers are stated and Jami draws them. ' +
  '{"kind":"graph"|"bar"|"histogram","x":{"label":"Time","unit":"s","min":0,"max":60,"step":10},"y":{"label":"Temperature","unit":"°C","min":0,"max":100,"step":20},' +
  '"series":[{"label":"optional name","points":[[0,20],[10,34]],"join":"line"|"curve"|"none","bestFit":false}],' +
  '"bars":[{"label":"A","value":12}],"bins":[{"from":0,"to":10,"frequency":8}],"guides":[{"x":40,"y":6,"xLabel":"Q1","yLabel":"P1"}]}. ' +
  "Use join \"none\" for a scatter graph and bestFit only where the question gives one. For \"plot\" or \"draw\" questions give the axes with min, max and step and no series, " +
  "so the candidate plots on an empty grid. For a histogram give frequencies, not heights: the heights are frequency density and are worked out for you. " +
  "Economics diagrams use \"ticks\":false on both axes, labelled lines (S, D, S1) as series, and guides for equilibrium prices and quantities. " +
  "Every step must divide its axis into whole squares, and every point must lie on the axes.";
