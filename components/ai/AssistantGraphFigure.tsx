"use client";

import { useMemo, useRef, useState } from "react";
import { useAssistantGraphActions } from "@/components/ai/AssistantGraphActions";
import NotebookGraphView from "@/components/workspace/NotebookGraphView";
import { useGraphPanZoom } from "@/hooks/useGraphPanZoom";
import { parseAssistantGraphSpec } from "@/lib/ai/assistant-graph";
import type { GraphViewWindow } from "@/lib/math/graph-expression";
import { DEFAULT_GRAPH_VIEW } from "@/lib/workspace/notebook-graphs";

const WIDTH = 360;
const HEIGHT = 288;
const CONTROL_CLASS =
  "inline-grid h-8 min-w-8 place-items-center rounded-full border border-[var(--color-border)] px-2.5 text-xs font-semibold text-text-secondary transition hover:border-[var(--color-border-strong)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45";

/**
 * A graph the Tutor drew, plotted from its functions rather than pictured.
 *
 * It can be dragged and zoomed where it is, and on a notebook it can be added
 * to the page, where it stays an editable graph. A block that does not read as
 * a graph is shown as the code it was, like a figure the sanitiser refuses.
 */
export default function AssistantGraphFigure({ source }: { source: string }) {
  const graph = useMemo(() => parseAssistantGraphSpec(source), [source]);
  const actions = useAssistantGraphActions();
  // Tied to the source it was moved on, so a different graph opens on its own view.
  const [moved, setMoved] = useState<{ source: string; view: GraphViewWindow } | null>(null);
  const view = moved?.source === source ? moved.view : (graph?.view ?? DEFAULT_GRAPH_VIEW);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const panZoom = useGraphPanZoom({
    ref: surfaceRef,
    view,
    viewBoxWidth: WIDTH,
    viewBoxHeight: HEIGHT,
    hasTitle: Boolean(graph?.title),
    onChange: (next) => setMoved({ source, view: next }),
  });

  if (!graph) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-[var(--color-glass-subtle)] p-3 text-xs text-text-muted">
        <code>{source}</code>
      </pre>
    );
  }

  const shown = { ...graph, view };
  const inserted = actions?.isInserted(source) ?? false;
  const inserting = actions?.insertingKey === source;

  return (
    <figure className="my-3 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] shadow-e0">
      <div
        ref={surfaceRef}
        {...panZoom.bindings}
        className="relative aspect-[5/4] w-full cursor-grab bg-white active:cursor-grabbing"
      >
        <NotebookGraphView graph={shown} width={WIDTH} height={HEIGHT} />
      </div>
      <figcaption className="flex flex-wrap items-center gap-1.5 p-2.5">
        <button type="button" className={CONTROL_CLASS} aria-label="Zoom out" title="Zoom out" onClick={() => panZoom.zoomBy(1.25)}>
          −
        </button>
        <button type="button" className={CONTROL_CLASS} aria-label="Zoom in" title="Zoom in" onClick={() => panZoom.zoomBy(0.8)}>
          +
        </button>
        {moved?.source === source ? (
          <button type="button" className={CONTROL_CLASS} onClick={() => setMoved(null)}>
            Reset
          </button>
        ) : null}
        {actions?.canInsert ? (
          <button
            type="button"
            disabled={inserted || inserting}
            className="ml-auto rounded-full bg-accent px-3 py-1.5 text-2xs font-semibold text-accent-on transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted"
            onClick={() => actions.insert(source, shown)}
          >
            {inserted ? "Added to page" : inserting ? "Adding..." : "Add to page"}
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}
