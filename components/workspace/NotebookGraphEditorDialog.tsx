"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import NotebookGraphView from "@/components/workspace/NotebookGraphView";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  Input,
  OptionSwitch,
  Textarea,
} from "@/components/ui";
import { useGraphPanZoom } from "@/hooks/useGraphPanZoom";
import {
  compileGraphExpression,
  type GraphAngleUnit,
  type GraphViewWindow,
} from "@/lib/math/graph-expression";
import {
  DEFAULT_GRAPH_VIEW,
  fitGraphYRange,
  formatGraphPointsText,
  GRAPH_POINTS_COLOR,
  GRAPH_SERIES_COLORS,
  MAX_GRAPH_SERIES,
  normalizeGraphDraft,
  parseGraphPointsText,
  type NotebookGraphDraft,
  type NotebookGraphSeries,
} from "@/lib/workspace/notebook-graphs";

const PREVIEW_WIDTH = 460;
const PREVIEW_HEIGHT = 368;
/** One series is kept back for plotted points. */
const MAX_FUNCTIONS = MAX_GRAPH_SERIES - 1;
const SERIES_COLORS: readonly string[] = GRAPH_SERIES_COLORS;
const ANGLE_OPTIONS = [
  { value: "degrees", label: "Degrees", detail: "sin x peaks at x = 90" },
  { value: "radians", label: "Radians", detail: "sin x peaks at x = π/2" },
] as const;

type FunctionRow = { id: string; expression: string; color: string };
type AxisText = Record<keyof GraphViewWindow, string>;

let rowCount = 0;
const newRowId = () => `function-${Date.now().toString(36)}-${(rowCount += 1)}`;

const formatAxis = (value: number) => String(Number(value.toPrecision(4)));
const axisTextFor = (view: GraphViewWindow): AxisText => ({
  xMin: formatAxis(view.xMin),
  xMax: formatAxis(view.xMax),
  yMin: formatAxis(view.yMin),
  yMax: formatAxis(view.yMax),
});
const readAxis = (value: string) => (value.trim() ? Number(value.replace(/[−–]/g, "-")) : Number.NaN);

type Props = {
  open: boolean;
  /** The graph being edited, or null to make a new one. */
  graph: NotebookGraphDraft | null;
  onCancel: () => void;
  onSave: (draft: NotebookGraphDraft) => void;
};

export default function NotebookGraphEditorDialog({ open, ...props }: Props) {
  // Mounted fresh each time it opens, so a new graph never starts from the last one's fields.
  return open ? <GraphEditor {...props} /> : null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

function GraphEditor({ graph, onCancel, onSave }: Omit<Props, "open">) {
  const [title, setTitle] = useState(graph?.title ?? "");
  const [xLabel, setXLabel] = useState(graph?.xLabel ?? "x");
  const [yLabel, setYLabel] = useState(graph?.yLabel ?? "y");
  const [functions, setFunctions] = useState<FunctionRow[]>(() => {
    const rows =
      graph?.series.flatMap((entry) =>
        entry.kind === "function" ? [{ id: entry.id, expression: entry.expression, color: entry.color }] : []
      ) ?? [];
    return rows.length > 0 ? rows : [{ id: newRowId(), expression: "", color: GRAPH_SERIES_COLORS[0] }];
  });
  const [angleUnit, setAngleUnit] = useState<GraphAngleUnit>(() => {
    const first = graph?.series.find((entry) => entry.kind === "function");
    // School graphs of sin and cos run in degrees, so a new graph does too.
    return first?.kind === "function" ? first.angleUnit : "degrees";
  });
  const [pointsText, setPointsText] = useState(() => {
    const points = graph?.series.find((entry) => entry.kind === "points");
    return points?.kind === "points" ? formatGraphPointsText(points.points) : "";
  });
  const [joinPoints, setJoinPoints] = useState(() => {
    const points = graph?.series.find((entry) => entry.kind === "points");
    return points?.kind === "points" ? points.connect : false;
  });
  const [showGrid, setShowGrid] = useState(graph?.showGrid ?? true);
  const [view, setView] = useState<GraphViewWindow>(graph?.view ?? DEFAULT_GRAPH_VIEW);
  const [axisText, setAxisText] = useState<AxisText>(() => axisTextFor(graph?.view ?? DEFAULT_GRAPH_VIEW));

  const applyView = (next: GraphViewWindow) => {
    setView(next);
    setAxisText(axisTextFor(next));
  };

  const checks = useMemo(
    () =>
      functions.map((row) => {
        const expression = row.expression.trim();
        const compiled = expression ? compileGraphExpression(expression, angleUnit) : null;
        return { row, expression, error: compiled && !compiled.ok ? compiled.error : "" };
      }),
    [angleUnit, functions]
  );
  const parsedPoints = useMemo(() => parseGraphPointsText(pointsText), [pointsText]);
  const series = useMemo<NotebookGraphSeries[]>(
    () => [
      ...checks
        .filter((check) => check.expression && !check.error)
        .map((check) => ({
          id: check.row.id,
          kind: "function" as const,
          expression: check.expression,
          color: check.row.color,
          angleUnit,
        })),
      ...(parsedPoints.points.length > 0
        ? [
            {
              id: "points",
              kind: "points" as const,
              points: parsedPoints.points,
              connect: joinPoints,
              color: GRAPH_POINTS_COLOR,
            },
          ]
        : []),
    ],
    [angleUnit, checks, joinPoints, parsedPoints.points]
  );
  const draft = useMemo(
    () => normalizeGraphDraft({ view, series, showGrid, title, xLabel, yLabel }),
    [series, showGrid, title, view, xLabel, yLabel]
  );

  const previewRef = useRef<HTMLDivElement | null>(null);
  const panZoom = useGraphPanZoom({
    ref: previewRef,
    view,
    viewBoxWidth: PREVIEW_WIDTH,
    viewBoxHeight: PREVIEW_HEIGHT,
    hasTitle: Boolean(draft.title),
    onChange: applyView,
    wheelZoom: true,
    touchPan: true,
  });

  const usesTrig = functions.some((row) => /sin|cos|tan/i.test(row.expression));
  const axisValues = {
    xMin: readAxis(axisText.xMin),
    xMax: readAxis(axisText.xMax),
    yMin: readAxis(axisText.yMin),
    yMax: readAxis(axisText.yMax),
  };
  const axisProblem = !(axisValues.xMin < axisValues.xMax && axisValues.yMin < axisValues.yMax);
  const problem = checks.some((check) => check.error)
    ? "Fix the function marked in red to save."
    : parsedPoints.invalid.length > 0
      ? "Fix the points that could not be read to save."
      : series.length === 0
        ? "Add a function or some points to save."
        : "";

  const updateRow = (id: string, change: Partial<FunctionRow>) =>
    setFunctions((rows) => rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const addRow = () =>
    setFunctions((rows) =>
      rows.length >= MAX_FUNCTIONS
        ? rows
        : [
            ...rows,
            {
              id: newRowId(),
              expression: "",
              color:
                GRAPH_SERIES_COLORS.find((candidate) => !rows.some((row) => row.color === candidate)) ??
                GRAPH_SERIES_COLORS[rows.length % GRAPH_SERIES_COLORS.length],
            },
          ]
    );
  const removeRow = (id: string) =>
    setFunctions((rows) =>
      rows.length === 1 ? rows.map((row) => ({ ...row, expression: "" })) : rows.filter((row) => row.id !== id)
    );
  const changeAxis = (key: keyof GraphViewWindow, value: string) => {
    const nextText = { ...axisText, [key]: value };
    setAxisText(nextText);
    const next = {
      xMin: readAxis(nextText.xMin),
      xMax: readAxis(nextText.xMax),
      yMin: readAxis(nextText.yMin),
      yMax: readAxis(nextText.yMax),
    };
    if (next.xMin < next.xMax && next.yMin < next.yMax) setView(next);
  };
  const fitToCurves = () => {
    const fitted = fitGraphYRange(series, view.xMin, view.xMax);
    if (fitted) applyView(fitted);
  };

  return (
    <Dialog
      open
      className="fixed inset-0 flex items-end justify-center p-3 sm:items-center sm:p-6"
      onDismiss={onCancel}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl shadow-e3">
        <header className="border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
          <DialogTitle className="text-lg font-semibold text-text-primary">
            {graph ? "Edit graph" : "New graph"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-6 text-text-secondary">
            Plotted exactly from your functions and points. Drag the graph to move around it, and scroll or use the
            zoom buttons to scale it.
          </DialogDescription>
        </header>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
            <div
              ref={previewRef}
              {...panZoom.bindings}
              className="relative aspect-[5/4] w-full cursor-grab touch-none overflow-hidden rounded-lg border border-[var(--color-border)] bg-white active:cursor-grabbing"
            >
              <NotebookGraphView graph={draft} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />
              {series.length === 0 ? (
                <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-slate-500">
                  Type a function to see it drawn here.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="secondary" aria-label="Zoom out" onClick={() => panZoom.zoomBy(1.25)}>
                −
              </Button>
              <Button type="button" size="sm" variant="secondary" aria-label="Zoom in" onClick={() => panZoom.zoomBy(0.8)}>
                +
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={series.length === 0} onClick={fitToCurves}>
                Fit to curves
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => applyView(DEFAULT_GRAPH_VIEW)}>
                Reset view
              </Button>
              {usesTrig && angleUnit === "degrees" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => applyView({ xMin: 0, xMax: 360, yMin: -1.5, yMax: 1.5 })}
                >
                  0° to 360°
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-7">
            <Section title="Functions">
              <div className="space-y-2.5">
                {checks.map(({ row, error }, index) => (
                  <div key={row.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Change the colour of function ${index + 1}`}
                        title="Change colour"
                        className="h-6 w-6 shrink-0 rounded-full border-2 border-white shadow-e1 outline-none ring-1 ring-[var(--color-border)] focus-visible:ring-2 focus-visible:ring-accent/55"
                        style={{ backgroundColor: row.color }}
                        onClick={() =>
                          updateRow(row.id, {
                            color: SERIES_COLORS[(SERIES_COLORS.indexOf(row.color) + 1) % SERIES_COLORS.length],
                          })
                        }
                      />
                      <span className="shrink-0 font-serif text-base italic text-text-secondary">y =</span>
                      <Input
                        aria-label={`Function ${index + 1}`}
                        aria-invalid={Boolean(error)}
                        value={row.expression}
                        placeholder={index === 0 ? "2x^2 - 3x + 1" : "Another function of x"}
                        spellCheck={false}
                        autoComplete="off"
                        symbols
                        containerClassName="min-w-0 flex-1"
                        onChange={(event) => updateRow(row.id, { expression: event.target.value })}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove function ${index + 1}`}
                        disabled={functions.length === 1 && !row.expression}
                        onClick={() => removeRow(row.id)}
                      >
                        ×
                      </Button>
                    </div>
                    {error ? (
                      <p role="alert" className="pl-[4.5rem] text-xs leading-5 text-[var(--color-error-mark)]">
                        {error}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {functions.length < MAX_FUNCTIONS ? (
                  <Button type="button" size="sm" variant="secondary" onClick={addRow}>
                    Add function
                  </Button>
                ) : null}
                <p className="text-xs leading-5 text-text-muted">
                  Write in x: 3(x + 1), x^2, sqrt(x), |x|, sin x, 2^x.
                </p>
              </div>
              {usesTrig ? (
                <OptionSwitch label="Angles" value={angleUnit} options={ANGLE_OPTIONS} onChange={setAngleUnit} />
              ) : null}
            </Section>

            <Section title="Plotted points">
              <Textarea
                aria-label="Plotted points, one x, y pair to a line"
                value={pointsText}
                rows={3}
                placeholder={"1, 2\n3, 5"}
                spellCheck={false}
                onChange={(event) => setPointsText(event.target.value)}
              />
              {parsedPoints.invalid.length > 0 ? (
                <p role="alert" className="text-xs leading-5 text-[var(--color-error-mark)]">
                  Could not read {parsedPoints.invalid.slice(0, 3).map((line) => `“${line}”`).join(", ")}. Write each
                  point as x, y on its own line.
                </p>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={joinPoints}
                  onChange={(event) => setJoinPoints(event.target.checked)}
                />
                Join the points in order
              </label>
            </Section>

            <Section title="Axes">
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["xMin", "x from"],
                    ["xMax", "x to"],
                    ["yMin", "y from"],
                    ["yMax", "y to"],
                  ] as const
                ).map(([key, label]) => (
                  <Input
                    key={key}
                    label={label}
                    inputMode="decimal"
                    value={axisText[key]}
                    onChange={(event) => changeAxis(key, event.target.value)}
                    onBlur={() => setAxisText(axisTextFor(view))}
                  />
                ))}
                <Input label="x-axis label" value={xLabel} maxLength={40} onChange={(event) => setXLabel(event.target.value)} />
                <Input label="y-axis label" value={yLabel} maxLength={40} onChange={(event) => setYLabel(event.target.value)} />
              </div>
              {axisProblem ? (
                <p className="text-xs leading-5 text-text-muted">Each axis has to start below where it ends.</p>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={showGrid}
                  onChange={(event) => setShowGrid(event.target.checked)}
                />
                Show grid lines
              </label>
            </Section>

            <Section title="Title">
              <Input
                aria-label="Graph title"
                value={title}
                maxLength={80}
                placeholder="Optional, like Distance against time"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Section>
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {problem ? <p className="text-xs leading-5 text-text-muted sm:mr-auto">{problem}</p> : null}
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={Boolean(problem)} onClick={() => onSave(draft)}>
            {graph ? "Save graph" : "Add to page"}
          </Button>
        </footer>
      </DialogPanel>
    </Dialog>
  );
}
