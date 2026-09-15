"use client";

import { memo, useMemo } from "react";
import {
  clipGraphPolyline,
  compileGraphExpression,
  sampleGraphFunction,
} from "@/lib/math/graph-expression";
import {
  formatGraphTick,
  graphPlotArea,
  graphTicks,
  type NotebookGraphDraft,
} from "@/lib/workspace/notebook-graphs";

type Props = {
  graph: NotebookGraphDraft;
  /**
   * The drawing's own size. Text and lines are measured in these units, so a
   * smaller drawing in the same box shows them larger.
   */
  width: number;
  height: number;
  className?: string;
};

function describeGraph(graph: NotebookGraphDraft) {
  const parts = graph.series.map((series) =>
    series.kind === "function" ? `y = ${series.expression}` : `${series.points.length} plotted points`
  );
  return `${graph.title ? `${graph.title}: ` : ""}graph of ${parts.join(", ") || "empty axes"}, x from ${
    graph.view.xMin
  } to ${graph.view.xMax}, y from ${graph.view.yMin} to ${graph.view.yMax}`;
}

/**
 * A graph drawn from its data, so it is exact at any size.
 *
 * Every curve is sampled from the function itself across the current view, so
 * zooming in shows more of the curve rather than a blurred picture of it, and
 * each line is cut at the edge of the axes in arithmetic -- see
 * `clipGraphPolyline` for why there is no clip path.
 */
function NotebookGraphView({ graph, width, height, className = "" }: Props) {
  const { view, series } = graph;
  const plot = graphPlotArea(width, height, Boolean(graph.title));
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const toX = (x: number) => plot.left + ((x - view.xMin) / (view.xMax - view.xMin)) * plotWidth;
  const toY = (y: number) => plot.bottom - ((y - view.yMin) / (view.yMax - view.yMin)) * plotHeight;

  const xTicks = graphTicks(view.xMin, view.xMax, Math.max(3, Math.round(plotWidth / 60)));
  const yTicks = graphTicks(view.yMin, view.yMax, Math.max(3, Math.round(plotHeight / 44)));
  const xAxisVisible = view.yMin <= 0 && view.yMax >= 0;
  const yAxisVisible = view.xMin <= 0 && view.xMax >= 0;
  const axisY = xAxisVisible ? toY(0) : plot.bottom;
  const axisX = yAxisVisible ? toX(0) : plot.left;
  const showLegend = series.length > 1 || series.some((entry) => entry.label);

  const lines = useMemo(() => {
    const scaleX = plotWidth / (view.xMax - view.xMin);
    const scaleY = plotHeight / (view.yMax - view.yMin);
    const toPath = (piece: Array<{ x: number; y: number }>) =>
      piece
        .map((point, index) => {
          const x = plot.left + (point.x - view.xMin) * scaleX;
          const y = plot.bottom - (point.y - view.yMin) * scaleY;
          return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ");
    return series.map((entry) => {
      if (entry.kind === "points") {
        return {
          id: entry.id,
          color: entry.color,
          width: 2,
          paths: entry.connect ? clipGraphPolyline(entry.points, view).map(toPath) : [],
        };
      }
      const compiled = compileGraphExpression(entry.expression, entry.angleUnit);
      const paths = compiled.ok
        ? sampleGraphFunction(compiled.evaluate, view, Math.max(160, Math.round(plotWidth * 1.5)))
            .flatMap((segment) => clipGraphPolyline(segment, view))
            .map(toPath)
        : [];
      return { id: entry.id, color: entry.color, width: 2.4, paths };
    });
  }, [series, view, plot.left, plot.bottom, plotWidth, plotHeight]);

  const visiblePoints = (points: Array<{ x: number; y: number }>) =>
    points.filter(
      (point) => point.x >= view.xMin && point.x <= view.xMax && point.y >= view.yMin && point.y <= view.yMax
    );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={describeGraph(graph)}
      className={`block h-full w-full select-none ${className}`}
      preserveAspectRatio="none"
    >
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      {graph.title ? (
        <text x={width / 2} y={24} textAnchor="middle" fontSize={13} fontWeight={600} fill="#111827">
          {graph.title}
        </text>
      ) : null}

      {graph.showGrid ? (
        <g stroke="#e5e7eb" strokeWidth={1}>
          {xTicks.values.map((value) => (
            <line key={`gx${value}`} x1={toX(value)} x2={toX(value)} y1={plot.top} y2={plot.bottom} />
          ))}
          {yTicks.values.map((value) => (
            <line key={`gy${value}`} x1={plot.left} x2={plot.right} y1={toY(value)} y2={toY(value)} />
          ))}
        </g>
      ) : (
        <rect x={plot.left} y={plot.top} width={plotWidth} height={plotHeight} fill="none" stroke="#e5e7eb" />
      )}

      <g stroke="#374151" strokeWidth={1.4}>
        <line x1={plot.left} x2={plot.right} y1={axisY} y2={axisY} />
        <line x1={axisX} x2={axisX} y1={plot.top} y2={plot.bottom} />
      </g>

      <g fontSize={10} fill="#4b5563">
        {xTicks.values.map((value) =>
          // Where both axes cross at the origin, the y-axis labels its 0.
          value === 0 && xAxisVisible && yAxisVisible ? null : (
            <text key={`tx${value}`} x={toX(value)} y={Math.min(plot.bottom + 14, axisY + 14)} textAnchor="middle">
              {formatGraphTick(value, xTicks.step)}
            </text>
          )
        )}
        {yTicks.values.map((value) => (
          <text key={`ty${value}`} x={Math.max(plot.left - 5, axisX - 5)} y={toY(value) + 3.5} textAnchor="end">
            {formatGraphTick(value, yTicks.step)}
          </text>
        ))}
      </g>

      {graph.xLabel ? (
        <text x={plot.right} y={height - 8} textAnchor="end" fontSize={12} fontStyle="italic" fill="#111827">
          {graph.xLabel}
        </text>
      ) : null}
      {graph.yLabel ? (
        <text x={6} y={plot.top - 3} textAnchor="start" fontSize={12} fontStyle="italic" fill="#111827">
          {graph.yLabel}
        </text>
      ) : null}

      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {lines.map((line) =>
          line.paths.map((path, index) => (
            <path key={`${line.id}-${index}`} d={path} stroke={line.color} strokeWidth={line.width} />
          ))
        )}
      </g>
      {series.map((entry) =>
        entry.kind === "points" ? (
          <g key={`dots-${entry.id}`}>
            {visiblePoints(entry.points).map((point, index) => (
              <circle
                key={`${entry.id}-p${index}`}
                cx={toX(point.x)}
                cy={toY(point.y)}
                r={3.6}
                fill={entry.color}
                stroke="#ffffff"
                strokeWidth={1}
              />
            ))}
          </g>
        ) : null
      )}

      {showLegend ? (
        <g fontSize={11} fontWeight={600} textAnchor="end" stroke="#ffffff" strokeWidth={3} paintOrder="stroke">
          {series.map((entry, index) => (
            <text key={`legend-${entry.id}`} x={plot.right - 6} y={plot.top + 14 + index * 15} fill={entry.color}>
              {entry.label || (entry.kind === "function" ? `y = ${entry.expression}` : "points")}
            </text>
          ))}
        </g>
      ) : null}
    </svg>
  );
}

export default memo(NotebookGraphView);
