"use client";

import { useMemo, useRef } from "react";
import type { Editor as JsDrawEditor } from "js-draw";
import type { NotebookLivePenTip } from "@/lib/workspace/notebook-direct-ink-input";
import type { NotebookInkSmoother } from "@/lib/workspace/notebook-ink-smoothing";
import { NotebookInkStyleSync } from "@/lib/workspace/notebook-ink-style-sync";
import type { NotebookInkStyle } from "@/lib/workspace/notebook-ink-types";
import type { JsDrawModule } from "@/lib/workspace/notebook-js-draw";
import type { NotebookLiveInk } from "@/lib/workspace/notebook-live-ink";
import { NotebookNibAngleTracker } from "@/lib/workspace/notebook-nib-angle";
import type { NotebookPenPreviewBatch } from "@/lib/workspace/notebook-pen-preview";
import { NotebookInkPointerLifecycle } from "@/lib/workspace/notebook-pointer-lifecycle";

/**
 * What the ink editor's parts share: its elements, the js-draw editor and the
 * live ink layers built on it, and the state of the pen on the page.
 *
 * All of it is mutable and none of it is rendered, so it lives in refs that
 * the pointer handlers read at the Pencil's full rate without a React update.
 * The object itself is created once and never changes, so the parts can hold
 * it in their effects' dependencies freely.
 */
export function useNotebookInkEditorRefs(initialStyle: NotebookInkStyle) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const inkSurfaceRef = useRef<HTMLDivElement | null>(null);
  const eraserCursorRef = useRef<HTMLDivElement | null>(null);
  const liveInkCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const editorRef = useRef<JsDrawEditor | null>(null);
  const jsDrawRef = useRef<JsDrawModule | null>(null);
  /** The editor is still loading the page's ink, so its changes are not edits. */
  const loadingRef = useRef(true);
  /** The page's ink has loaded and painted. */
  const readyRef = useRef(false);
  const liveInkRef = useRef<NotebookLiveInk | null>(null);
  const penPreviewBatchRef = useRef<NotebookPenPreviewBatch | null>(null);

  const pointerLifecycleRef = useRef<NotebookInkPointerLifecycle | null>(null);
  pointerLifecycleRef.current ??= new NotebookInkPointerLifecycle();
  const inkSmoothersRef = useRef<Map<number, NotebookInkSmoother>>(new Map());
  // Which way the highlighter flat edge is facing. One per editor rather than
  // one per stroke: grip carries across strokes, so the angle a stroke opens
  // at should be the one the hand was already holding.
  const nibAngleRef = useRef<NotebookNibAngleTracker | null>(null);
  nibAngleRef.current ??= new NotebookNibAngleTracker();
  const liveTipRef = useRef<NotebookLivePenTip>({ contact: null, points: null, shown: false, paints: 0 });
  const styleSyncRef = useRef<NotebookInkStyleSync | null>(null);
  styleSyncRef.current ??= new NotebookInkStyleSync(initialStyle);

  return useMemo(
    () => ({
      hostRef,
      inkSurfaceRef,
      eraserCursorRef,
      liveInkCanvasRef,
      editorRef,
      jsDrawRef,
      loadingRef,
      readyRef,
      liveInkRef,
      penPreviewBatchRef,
      pointerLifecycleRef,
      inkSmoothersRef,
      nibAngleRef,
      liveTipRef,
      styleSyncRef,
    }),
    []
  );
}

export type NotebookInkEditorRefs = ReturnType<typeof useNotebookInkEditorRefs>;
