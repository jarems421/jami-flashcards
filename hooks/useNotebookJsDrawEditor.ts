"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Editor as JsDrawEditor } from "js-draw";
import type { NotebookInkEditorCallbacks } from "@/components/workspace/notebook-ink-editor-types";
import type { NotebookInkEditorRefs } from "@/hooks/useNotebookInkEditorRefs";
import { installNotebookInkViewportSynchronizer } from "@/lib/workspace/notebook-ink-runtime";
import type { NotebookInkRenderWindow } from "@/lib/workspace/notebook-ink-window";
import {
  createNotebookJsDrawEditor,
  installNotebookPrimaryPen,
  observeNotebookInkHostSize,
  suppressNotebookJsDrawEraserPreviews,
} from "@/lib/workspace/notebook-js-draw-setup";
import type { NotebookInkStyle } from "@/lib/workspace/notebook-ink-types";
import { loadJsDraw } from "@/lib/workspace/notebook-js-draw";
import { installNotebookLiveInk, type NotebookLiveInk } from "@/lib/workspace/notebook-live-ink";
import { NIB_ANGLE_DEFAULT } from "@/lib/workspace/notebook-nib-angle";
import { getNotebookInkSmoothingOptions } from "@/lib/workspace/notebook-pen-feel";
import type { NotebookPenPreviewBatch } from "@/lib/workspace/notebook-pen-preview";

/**
 * The js-draw editor behind one notebook page, from building it to taking it
 * down.
 *
 * Built afresh for each page: it loads the page's ink, reports the undo
 * history and every edit, and says when the ink has painted so the page can
 * drop the static underlay it shows meanwhile. Its tools follow the toolbar,
 * except that a change arriving mid-stroke waits for the pen to lift. The fast
 * live canvas is sized whenever the visible slice of the page moves.
 */
export function useNotebookJsDrawEditor({
  refs,
  style,
  readOnly,
  initialSvg,
  pageId,
  pageWidth,
  pageHeight,
  inkWindow,
  renderWindowRef,
  syncViewportRef,
  callbacksRef,
  reportInteraction,
  resetPointerState,
  snapshots,
}: {
  refs: NotebookInkEditorRefs;
  style: NotebookInkStyle;
  readOnly: boolean;
  initialSvg: string;
  pageId: string;
  pageWidth: number;
  pageHeight: number;
  inkWindow: NotebookInkRenderWindow | null;
  renderWindowRef: RefObject<NotebookInkRenderWindow | null>;
  syncViewportRef: RefObject<(() => void) | null>;
  callbacksRef: RefObject<NotebookInkEditorCallbacks>;
  reportInteraction: (active: boolean) => void;
  /** Forgets every pen contact, for an editor being built or taken down. */
  resetPointerState: () => void;
  snapshots: {
    noteInkChanged: () => void;
    scheduleWarmSnapshot: () => void;
    discardSnapshots: () => void;
  };
}) {
  const {
    hostRef,
    inkSurfaceRef,
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
  } = refs;
  const { noteInkChanged, scheduleWarmSnapshot, discardSnapshots } = snapshots;
  const initialSvgRef = useRef(initialSvg);
  const readOnlyRef = useRef(readOnly);

  /** Sizes the live canvas once the page has settled, coalesced to one frame. */
  const prepareLiveInkFrameRef = useRef(0);
  const prepareLiveInk = useCallback(() => {
    if (prepareLiveInkFrameRef.current) return;
    prepareLiveInkFrameRef.current = window.requestAnimationFrame(() => {
      prepareLiveInkFrameRef.current = 0;
      const surface = inkSurfaceRef.current;
      const liveInk = liveInkRef.current;
      if (!surface || !liveInk || pointerLifecycleRef.current?.isInteracting) {
        return;
      }
      liveInk.prepare({
        surfaceRect: surface.getBoundingClientRect(),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
    });
  }, [inkSurfaceRef, liveInkRef, pointerLifecycleRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let editor: JsDrawEditor | null = null;
    let historyListener: { remove(): void } | null = null;
    let penPreviewBatch: NotebookPenPreviewBatch | null = null;
    let liveInk: NotebookLiveInk | null = null;
    let stopObservingHostSize: (() => void) | null = null;
    loadingRef.current = true;
    readyRef.current = false;
    resetPointerState();
    styleSyncRef.current?.forgetApplied();
    host.replaceChildren();

    void loadJsDraw()
      .then(async (jsDraw) => {
        if (disposed) return;
        const styleSync = styleSyncRef.current;
        if (!styleSync) return;
        jsDrawRef.current = jsDraw;
        editor = createNotebookJsDrawEditor(host, jsDraw);
        const editorRoot = editor.getRootElement();
        // js-draw normally paints its fixed import/export rectangle as a
        // translucent grey editor aid on every rerender. The notebook sheet
        // already owns the page edge, so keep the fixed export coordinates
        // while suppressing that extra canvas-drawn frame. Synchronizing the
        // viewport inside the same render also prevents js-draw's resize
        // observer from painting one frame with the previous zoom in the
        // page's top-left corner.
        const initialDisplayRect = host.getBoundingClientRect();
        let measuredDisplaySize = {
          width: initialDisplayRect.width,
          height: initialDisplayRect.height,
        };
        const syncViewport = installNotebookInkViewportSynchronizer({
          createScreenSize: (width, height) => jsDraw.Vec2.of(width, height),
          // Scale the page, then shift the painted slice to the top-left of
          // the canvas. js-draw reads screen positions against this same
          // element, so pointers and ink agree without either knowing there
          // is a window at all.
          createTransform: (scaleX, scaleY, offsetX, offsetY) =>
            jsDraw.Mat33.translation(jsDraw.Vec2.of(-offsetX, -offsetY)).rightMul(
              jsDraw.Mat33.scaling2D(jsDraw.Vec2.of(scaleX, scaleY))
            ),
          editor,
          // Only consulted for an unwindowed sheet: a window carries the size
          // the host was given, and the synchronizer takes both from it so
          // the two cannot fall out of step.
          getDisplaySize: () => measuredDisplaySize,
          getRenderWindow: () => renderWindowRef.current,
          pageHeight,
          pageWidth,
          shouldSkip: () => disposed,
        });
        syncViewportRef.current = syncViewport;
        editorRef.current = editor;
        editor.setReadOnly(readOnlyRef.current);
        penPreviewBatch = installNotebookPrimaryPen(editor, jsDraw, {
          smoothers: inkSmoothersRef.current,
          // The filter settings a stroke starting now would use, read at each
          // pointer-down -- so a settings change takes effect on the next stroke.
          getSmoothingOptions: () => getNotebookInkSmoothingOptions(styleSync.desired.penSettings),
          getNibAngle: () => nibAngleRef.current?.current() ?? NIB_ANGLE_DEFAULT,
          tip: liveTipRef.current,
        });
        penPreviewBatchRef.current = penPreviewBatch;
        /*
         * Every stroke goes to the fast live canvas. It was a setting with a
         * "classic" way back until 1 Oct 2026; the classic path was only ever a
         * slower version of the same ink, so it went. If js-draw's internals
         * ever stop matching, `installNotebookLiveInk` returns null and
         * js-draw's own wet ink takes over by itself.
         */
        const liveInkCanvas = liveInkCanvasRef.current;
        liveInk = liveInkCanvas ? installNotebookLiveInk({ editor, jsDraw, canvas: liveInkCanvas }) : null;
        liveInkRef.current = liveInk;
        liveInk?.setParked(true);
        suppressNotebookJsDrawEraserPreviews(editor, jsDraw);
        styleSync.applyDesired(editor, jsDraw);
        editorRoot.style.width = "100%";
        editorRoot.style.height = "100%";
        editorRoot.style.minWidth = "0";
        editorRoot.style.minHeight = "0";
        editorRoot.style.background = "transparent";
        editorRoot.style.pointerEvents = "none";
        stopObservingHostSize = observeNotebookInkHostSize(host, (width, height) => {
          if (width <= 0 || height <= 0) return;
          if (measuredDisplaySize.width === width && measuredDisplaySize.height === height) {
            return;
          }
          measuredDisplaySize = { width, height };
          syncViewport();
        });
        editor.dispatchNoAnnounce(
          editor.image.setImportExportRect(new jsDraw.Rect2(0, 0, pageWidth, pageHeight)),
          false
        );

        historyListener = editor.notifier.on(jsDraw.EditorEventType.UndoRedoStackUpdated, (event) => {
          if (event.kind !== jsDraw.EditorEventType.UndoRedoStackUpdated) return;
          callbacksRef.current.onHistoryChange(event.undoStackSize, event.redoStackSize);
          if (!loadingRef.current) {
            noteInkChanged();
            callbacksRef.current.onChange();
          }
        });
        await editor.loadFromSVG(initialSvgRef.current, true);
        if (disposed || !editor) return;
        const pageRect = new jsDraw.Rect2(0, 0, pageWidth, pageHeight);
        editor.dispatchNoAnnounce(editor.image.setImportExportRect(pageRect), false);

        window.requestAnimationFrame(() => {
          if (disposed || !editor) return;
          syncViewport();
          styleSync.applyDesired(editor, jsDraw);
          loadingRef.current = false;
          readyRef.current = true;
          // The first swipe of a session deserves a prepared snapshot too.
          scheduleWarmSnapshot();
          callbacksRef.current.onHistoryChange(editor.history.undoStackSize, editor.history.redoStackSize);
          prepareLiveInk();
          // Signal that the page's ink has loaded and painted, so the page can
          // drop the static ink underlay it shows during the swap (avoids the
          // brief blank flash while js-draw deserializes the SVG).
          callbacksRef.current.onReady?.();
        });
      })
      .catch((error) => {
        if (!disposed) {
          console.error("Notebook ink editor failed to initialize.", error);
          callbacksRef.current.onReadyError?.(error);
        }
      });

    return () => {
      disposed = true;
      readyRef.current = false;
      discardSnapshots();
      resetPointerState();
      stopObservingHostSize?.();
      penPreviewBatch?.dispose();
      if (penPreviewBatchRef.current === penPreviewBatch) {
        penPreviewBatchRef.current = null;
      }
      liveInk?.dispose();
      if (liveInkRef.current === liveInk) liveInkRef.current = null;
      if (prepareLiveInkFrameRef.current) {
        window.cancelAnimationFrame(prepareLiveInkFrameRef.current);
        prepareLiveInkFrameRef.current = 0;
      }
      reportInteraction(false);
      historyListener?.remove();
      editor?.remove();
      editorRef.current = null;
      jsDrawRef.current = null;
      syncViewportRef.current = null;
    };
  }, [
    callbacksRef,
    discardSnapshots,
    editorRef,
    hostRef,
    inkSmoothersRef,
    jsDrawRef,
    liveInkCanvasRef,
    liveInkRef,
    liveTipRef,
    loadingRef,
    nibAngleRef,
    noteInkChanged,
    pageHeight,
    pageId,
    pageWidth,
    penPreviewBatchRef,
    prepareLiveInk,
    readyRef,
    renderWindowRef,
    reportInteraction,
    resetPointerState,
    scheduleWarmSnapshot,
    styleSyncRef,
    syncViewportRef,
  ]);

  const {
    activeTool,
    eraserMode,
    eraserThickness,
    highlighterColor,
    highlighterThickness,
    penColor,
    penSettings,
    penThickness,
  } = style;
  useEffect(() => {
    const styleSync = styleSyncRef.current;
    if (!styleSync) return;
    styleSync.desired = {
      activeTool,
      eraserMode,
      eraserThickness,
      highlighterColor,
      highlighterThickness,
      penColor,
      penSettings,
      penThickness,
    };
    const editor = editorRef.current;
    if (!editor) return;
    if (pointerLifecycleRef.current?.isInteracting) {
      styleSync.defer();
      return;
    }
    const jsDraw = jsDrawRef.current;
    if (!jsDraw) return;
    styleSync.applyDesired(editor, jsDraw);
  }, [
    activeTool,
    editorRef,
    eraserMode,
    eraserThickness,
    highlighterColor,
    highlighterThickness,
    jsDrawRef,
    penColor,
    penSettings,
    penThickness,
    pointerLifecycleRef,
    styleSyncRef,
  ]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    editorRef.current?.setReadOnly(readOnly);
  }, [editorRef, readOnly]);

  // A pan or zoom moves which part of the page is on screen, so the live
  // canvas is resized for it now rather than on the next pointerdown.
  const windowLeft = inkWindow?.left ?? 0;
  const windowTop = inkWindow?.top ?? 0;
  const windowWidth = inkWindow?.width ?? 0;
  const windowHeight = inkWindow?.height ?? 0;
  useEffect(() => {
    prepareLiveInk();
  }, [prepareLiveInk, windowHeight, windowLeft, windowTop, windowWidth]);

  useEffect(() => {
    window.addEventListener("resize", prepareLiveInk);
    return () => window.removeEventListener("resize", prepareLiveInk);
  }, [prepareLiveInk]);
}
