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
  fitGraphYRange,
  formatGraphPointsText,
  GRAPH_POINTS_COLOR,
  GRAPH_SERIES_COLORS,
  MAX_GRAPH_SERIES,
  normalizeGraphDraft,
  normalizeGraphView,
  parseGraphPointsText,
  type NotebookGraphDraft,
  type NotebookGraphSeries,
} from "@/lib/workspace/notebook-graphs";

const PREVIEW_WIDTH = 460;
const PREVIEW_HEIGHT = 368;
/** One series is kept back for plotted points. */
const MAX_EQUATIONS = MAX_GRAPH_SERIES - 1;
const EXAMPLES = ["x²", "2x + 1", "x³ − 3x", "sin x"];
const ANGLE_OPTIONS = [
  { value: "degrees", label: "Degrees" },
  { value: "radians", label: "Radians" },
] as const;
/** Settings for a field of maths: iPad autocorrect turns "sinx" into "since". */
const MATH_FIELD = { autoCapitalize: "off", autoCorrect: "off", autoComplete: "off", spellCheck: false } as const;

type Equation = { id: string; expression: string; color: string };

let equationCount = 0;
const newEquationId = () => `function-${Date.now().toString(36)}-${(equationCount += 1)}`;
const formatAxis = (value: number) => String(Number(value.toPrecision(4)));

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

function OptionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-text-secondary">{title}</p>
      {children}
    </div>
  );
}

/**
 * Making a graph, kept to what a student came for: type an equation, see it.
 *
 * The first version put every setting on screen at once -- colours, points,
 * four axis limits, two labels, a grid switch, a title -- so the one field that
 * mattered was one of a dozen. Now the equation box leads, with examples to tap
 * for anyone unsure what to write, and the graph beside it fits itself to what
 * is typed until the student moves it. Everything else waits under More options.
 */
function GraphEditor({ graph, onCancel, onSave }: Omit<Props, "open">) {
  const [equations, setEquations] = useState<Equation[]>(() => {
    const rows =
      graph?.series.flatMap((entry) =>
        entry.kind === "function" ? [{ id: entry.id, expression: entry.expression, color: entry.color }] : []
      ) ?? [];
    return rows.length > 0 ? rows : [{ id: newEquationId(), expression: "", color: GRAPH_SERIES_COLORS[0] }];
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
  const [title, setTitle] = useState(graph?.title ?? "");
  const [xLabel, setXLabel] = useState(graph?.xLabel ?? "x");
  const [yLabel, setYLabel] = useState(graph?.yLabel ?? "y");
  const [showGrid, setShowGrid] = useState(graph?.showGrid ?? true);
  /** A view the student chose by moving, zooming or typing limits; null while it fits itself. */
  const [chosenView, setChosenView] = useState<GraphViewWindow | null>(graph?.view ?? null);

  const checks = useMemo(
    () =>
      equations.map((row) => {
        const expression = row.expression.trim();
        const compiled = expression ? compileGraphExpression(expression, angleUnit) : null;
        return { row, expression, error: compiled && !compiled.ok ? compiled.error : "" };
      }),
    [angleUnit, equations]
  );
  const parsedPoints = useMemo(() => parseGraphPointsText(pointsText), [pointsText]);
  const usesTrig = equations.some((row) => /sin|cos|tan/i.test(row.expression));
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
  /*
   * Fitted to what is plotted, so whatever is typed can be seen: a fixed
   * -10 to 10 view left y = x² + 20 entirely off the top of an empty grid.
   */
  const fittedView = useMemo(() => {
    const degreesTrig = usesTrig && angleUnit === "degrees";
    const xMin = degreesTrig ? 0 : -10;
    const xMax = degreesTrig ? 360 : 10;
    return fitGraphYRange(series, xMin, xMax) ?? normalizeGraphView({ xMin, xMax, yMin: -10, yMax: 10 });
  }, [angleUnit, series, usesTrig]);
  const view = chosenView ?? fittedView;
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
    onChange: setChosenView,
    wheelZoom: true,
    touchPan: true,
  });

  const problem = checks.some((check) => check.error)
    ? "Fix the equation in red to add the graph."
    : parsedPoints.invalid.length > 0
      ? "Fix the points under More options to add the graph."
      : series.length === 0
        ? "Type an equation to see its graph."
        : "";

  const updateEquation = (id: string, expression: string) =>
    setEquations((rows) => rows.map((row) => (row.id === id ? { ...row, expression } : row)));
  const addEquation = () =>
    setEquations((rows) =>
      rows.length >= MAX_EQUATIONS
        ? rows
        : [
            ...rows,
            {
              id: newEquationId(),
              expression: "",
              color:
                GRAPH_SERIES_COLORS.find((candidate) => !rows.some((row) => row.color === candidate)) ??
                GRAPH_SERIES_COLORS[rows.length % GRAPH_SERIES_COLORS.length],
            },
          ]
    );
  const removeEquation = (id: string) => setEquations((rows) => rows.filter((row) => row.id !== id));
  const setAxis = (key: keyof GraphViewWindow, text: string) => {
    const value = Number(text.replace(/[−–]/g, "-"));
    if (!text.trim() || !Number.isFinite(value)) return;
    const next = { ...view, [key]: value };
    if (next.xMin < next.xMax && next.yMin < next.yMax) setChosenView(next);
  };

  const firstEmpty = equations.length === 1 && !equations[0]!.expression.trim();

  return (
    <Dialog open className="fixed inset-0 flex items-end justify-center p-3 sm:items-center sm:p-6" onDismiss={onCancel}>
      <DialogBackdrop className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl shadow-e3">
        <header className="px-5 pb-2 pt-5 sm:px-6">
          <DialogTitle className="text-xl font-semibold text-text-primary">
            {graph ? "Edit graph" : "Add a graph"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-text-secondary">
            Type an equation and it is drawn exactly.
          </DialogDescription>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 pb-5 pt-3 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <div className="space-y-2.5">
              {checks.map(({ row, error }, index) => (
                <div key={row.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-lg font-semibold italic text-text-secondary" aria-hidden="true">
                      y =
                    </span>
                    <Input
                      {...MATH_FIELD}
                      aria-label={equations.length > 1 ? `Equation ${index + 1}` : "Equation"}
                      aria-invalid={Boolean(error)}
                      data-dialog-autofocus={index === 0 ? "true" : undefined}
                      value={row.expression}
                      placeholder={index === 0 ? "e.g. x² − 4" : "Another equation"}
                      symbols
                      containerClassName="min-w-0 flex-1"
                      className="text-lg"
                      style={{ boxShadow: `inset 4px 0 0 ${row.color}` }}
                      onChange={(event) => updateEquation(row.id, event.target.value)}
                    />
                    {equations.length > 1 ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove equation ${index + 1}`}
                        onClick={() => removeEquation(row.id)}
                      >
                        ×
                      </Button>
                    ) : null}
                  </div>
                  {error ? (
                    <p role="alert" className="pl-11 text-xs leading-5 text-[var(--color-error-mark)]">
                      {error}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>

            {firstEmpty ? (
              <div className="flex flex-wrap items-center gap-2 pl-11">
                <span className="text-xs text-text-muted">Try</span>
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1.5 text-sm font-medium text-text-primary transition hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                    onClick={() => updateEquation(equations[0]!.id, example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            ) : equations.length < MAX_EQUATIONS ? (
              <button
                type="button"
                className="ml-11 rounded text-sm font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                onClick={addEquation}
              >
                + Add another equation
              </button>
            ) : null}

            {usesTrig ? (
              <OptionSwitch
                label="Angles"
                value={angleUnit}
                options={ANGLE_OPTIONS}
                columns={2}
                onChange={(value) => {
                  setAngleUnit(value);
                  setChosenView(null);
                }}
              />
            ) : null}

            <details className="group rounded-xl border border-[var(--color-border)]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
                More options
                <span aria-hidden="true" className="text-text-muted transition group-open:rotate-180">
                  ⌄
                </span>
              </summary>
              <div className="space-y-5 border-t border-[var(--color-border)] px-4 pb-4 pt-4">
                <OptionGroup title="Title">
                  <Input
                    aria-label="Graph title"
                    value={title}
                    maxLength={80}
                    placeholder="Optional"
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </OptionGroup>

                <OptionGroup title="Plot points">
                  <Textarea
                    {...MATH_FIELD}
                    aria-label="Points, one x, y pair to a line"
                    value={pointsText}
                    rows={3}
                    placeholder={"1, 2\n3, 5"}
                    onChange={(event) => setPointsText(event.target.value)}
                  />
                  {parsedPoints.invalid.length > 0 ? (
                    <p role="alert" className="text-xs leading-5 text-[var(--color-error-mark)]">
                      Write each point as x, y on its own line.
                    </p>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={joinPoints}
                      onChange={(event) => setJoinPoints(event.target.checked)}
                    />
                    Join the points with a line
                  </label>
                </OptionGroup>

                <OptionGroup title="Axes">
                  {/* Keyed to the view, so moving the graph refreshes them; applied when a box is left. */}
                  <div key={`${view.xMin}:${view.xMax}:${view.yMin}:${view.yMax}`} className="grid grid-cols-2 gap-2">
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
                        {...MATH_FIELD}
                        aria-label={label}
                        placeholder={label}
                        inputMode="decimal"
                        defaultValue={formatAxis(view[key])}
                        onBlur={(event) => setAxis(key, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") setAxis(key, event.currentTarget.value);
                        }}
                      />
                    ))}
                    <Input
                      aria-label="x-axis label"
                      placeholder="x-axis label"
                      value={xLabel}
                      maxLength={40}
                      onChange={(event) => setXLabel(event.target.value)}
                    />
                    <Input
                      aria-label="y-axis label"
                      placeholder="y-axis label"
                      value={yLabel}
                      maxLength={40}
                      onChange={(event) => setYLabel(event.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={showGrid}
                      onChange={(event) => setShowGrid(event.target.checked)}
                    />
                    Grid lines
                  </label>
                </OptionGroup>
              </div>
            </details>
          </div>

          <div className="space-y-2 md:sticky md:top-0 md:self-start">
            <div
              ref={previewRef}
              {...panZoom.bindings}
              className="relative aspect-[5/4] w-full cursor-grab touch-none overflow-hidden rounded-xl border border-[var(--color-border)] bg-white active:cursor-grabbing"
            >
              <NotebookGraphView graph={draft} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />
              <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/90 p-1 shadow-e1">
                <button
                  type="button"
                  aria-label="Zoom out"
                  className="grid h-8 w-8 place-items-center rounded-full text-lg font-semibold text-slate-700 hover:bg-slate-100"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => panZoom.zoomBy(1.25)}
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  className="grid h-8 w-8 place-items-center rounded-full text-lg font-semibold text-slate-700 hover:bg-slate-100"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => panZoom.zoomBy(0.8)}
                >
                  +
                </button>
                {chosenView ? (
                  <button
                    type="button"
                    className="h-8 rounded-full px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setChosenView(null)}
                  >
                    Fit
                  </button>
                ) : null}
              </div>
            </div>
            <p className="text-center text-xs text-text-muted">Drag to move around the graph.</p>
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {problem ? <p className="text-sm text-text-muted sm:mr-auto">{problem}</p> : null}
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
