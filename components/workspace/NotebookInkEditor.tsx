"use client";

import "js-draw/Editor.css";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  Editor as JsDrawEditor,
} from "js-draw";
import type {
  NotebookStroke,
} from "@/lib/workspace/notebooks";
import {
  getContinuousNotebookEraserSamples,
  getNotebookEraserCursorDiameter,
  getNotebookEraserToolThickness,
  getSpatiallySimplifiedNotebookEraserSamples,
  type NotebookEraserPointerSample,
  type NotebookEraserMode,
} from "@/lib/workspace/notebook-eraser";
import {
  applyNotebookInkStyle,
  applyNotebookEraserMode,
  applyNotebookStrokeShape,
  areNotebookInkStylesEqual,
  loadJsDraw,
  makePrecisePenInputMapper,
  serializeNotebookInkSynchronously,
  type JsDrawModule,
  type NotebookInkStyle,
  type NotebookInkTool,
} from "@/lib/workspace/notebook-js-draw";
import { NotebookPrecisionEraserGesture } from "@/lib/workspace/notebook-precision-eraser";
import {
  applyNotebookScribbleErase,
  planNotebookScribbleErase,
} from "@/lib/workspace/notebook-scribble-gesture";
import type { NotebookScribbleSample } from "@/lib/workspace/notebook-scribble-erase";
import { NotebookInkSmoother } from "@/lib/workspace/notebook-ink-smoothing";
import {
  installBatchedNotebookPenPreview,
  type NotebookBatchedPen,
  type NotebookPenPreviewBatch,
} from "@/lib/workspace/notebook-pen-preview";
import { dispatchPreciseNotebookPointerMove } from "@/lib/workspace/notebook-direct-ink-input";
import { NotebookInkPointerLifecycle } from "@/lib/workspace/notebook-pointer-lifecycle";
import { shouldSuppressNotebookNativeInkPointer } from "@/lib/workspace/notebook-interaction-lock";
import {
  getBoundedLivePointerSamples,
  shouldUseNotebookPenPressure,
} from "@/lib/workspace/notebook-inking";
import {
  dispatchBatchedNotebookPointerSamples,
  installNotebookInkViewportSynchronizer,
  installNotebookNativeInkGuards,
  positionNotebookEraserCursor,
  shouldContinueNotebookPrecisionGesture,
  shouldExpectNotebookCaptureLoss,
  shouldUseNotebookPrecisionGesture,
  suppressNotebookEraserPreview,
} from "@/lib/workspace/notebook-ink-runtime";

export type { NotebookInkTool };

export type NotebookInkEditorHandle = {
  clear(): void;
  getHistoryState(): { undoDepth: number; redoDepth: number };
  hasInk(): boolean;
  isInteracting(): boolean;
  redo(): void;
  serialize(): string | null;
  serializeAsync(): Promise<string | null>;
  setEraserMode(mode: NotebookEraserMode): void;
  undo(): void;
};

export type PreparedNotebookStroke = NotebookStroke & {
  pathData?: string;
};

type Props = NotebookInkStyle & {
  initialSvg: string;
  pageHeight: number;
  pageId: string;
  pageWidth: number;
  onChange(): void;
  onHistoryChange(undoDepth: number, redoDepth: number): void;
  onInteractionChange(active: boolean): void;
  onReady?(): void;
  onReadyError?(error: unknown): void;
  onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void;
  readOnly?: boolean;
  /** Scribbling out with the pen deletes the strokes it covers. */
  scribbleToErase?: boolean;
  onScribbleErase?(strokeCount: number): void;
};

/**
 * Enough samples for any scribble, and a bound on the buffer.
 *
 * At roughly one per frame this is about half a minute of continuous drawing.
 * The earlier 512 was under ten seconds, which a vigorous scribble over a
 * block of several lines can genuinely exceed -- and exceeding it silently
 * turned the gesture off for that stroke.
 */
const MAX_SCRIBBLE_SAMPLES = 2048;

type ActivePrecisionEraserGesture = {
  cursorDiameter: number;
  gesture: NotebookPrecisionEraserGesture;
  lastSample: NotebookEraserPointerSample;
  pointerId: number;
  surfaceLeft: number;
  surfaceTop: number;
};

export const NotebookInkEditor = forwardRef<NotebookInkEditorHandle, Props>(
  function NotebookInkEditor(
    {
      activeTool,
      eraserMode,
      eraserThickness,
      highlighterColor,
      highlighterThickness,
      initialSvg,
      onChange,
      onHistoryChange,
      onInteractionChange,
      onReady,
      onReadyError,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      pageHeight,
      pageId,
      pageWidth,
      penColor,
      penThickness,
      readOnly = false,
      scribbleToErase = false,
      onScribbleErase,
    },
    forwardedRef
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const inkSurfaceRef = useRef<HTMLDivElement | null>(null);
    const eraserCursorRef = useRef<HTMLDivElement | null>(null);
    const eraserSurfaceOffsetRef = useRef<{
      left: number;
      top: number;
    } | null>(null);
    const eraserCursorDiameterRef = useRef(
      getNotebookEraserCursorDiameter(eraserMode, eraserThickness)
    );
    const editorRef = useRef<JsDrawEditor | null>(null);
    const jsDrawRef = useRef<JsDrawModule | null>(null);
    const loadingRef = useRef(true);
    const readyRef = useRef(false);
    const pointerLifecycleRef = useRef<NotebookInkPointerLifecycle | null>(null);
    pointerLifecycleRef.current ??= new NotebookInkPointerLifecycle();
    const inkSmoothersRef = useRef<Map<number, NotebookInkSmoother>>(new Map());
    const penPreviewBatchRef = useRef<NotebookPenPreviewBatch | null>(null);
    const lastForwardedPointerSampleRef = useRef<Map<number, PointerEvent>>(
      new Map()
    );
    const precisionEraserGestureRef =
      useRef<ActivePrecisionEraserGesture | null>(null);
    /**
     * The live pen path, for recognising a scribble-out at release.
     *
     * Bounded: a long stroke cannot be a scribble anyway, and this sits in a
     * pointer handler that runs at the Pencil's full rate.
     */
    const scribbleSamplesRef = useRef<{
      pointerId: number;
      samples: NotebookScribbleSample[];
      surfaceLeft: number;
      surfaceTop: number;
    } | null>(null);
    const pendingStyleRef = useRef(false);
    const appliedStyleRef = useRef<NotebookInkStyle | null>(null);
    const initialSvgRef = useRef(initialSvg);
    const readOnlyRef = useRef(readOnly);
    const desiredStyleRef = useRef<NotebookInkStyle>({
      activeTool,
      eraserMode,
      eraserThickness,
      highlighterColor,
      highlighterThickness,
      penColor,
      penThickness,
    });
    const callbacksRef = useRef({
      onChange,
      onHistoryChange,
      onInteractionChange,
      onReady,
      onReadyError,
      onScribbleErase,
    });
    useEffect(() => {
      callbacksRef.current = {
        onChange,
        onHistoryChange,
        onInteractionChange,
        onReady,
        onReadyError,
        onScribbleErase,
      };
    }, [
      onChange,
      onHistoryChange,
      onInteractionChange,
      onReady,
      onReadyError,
      onScribbleErase,
    ]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        clear() {
          const editor = editorRef.current;
          const jsDraw = jsDrawRef.current;
          if (!editor || !jsDraw) return;
          const components = editor.image.getAllComponents();
          if (components.length > 0) editor.dispatch(new jsDraw.Erase(components));
        },
        getHistoryState() {
          const history = editorRef.current?.history;
          return {
            undoDepth: history?.undoStackSize ?? 0,
            redoDepth: history?.redoStackSize ?? 0,
          };
        },
        hasInk() {
          return (editorRef.current?.image.estimateNumElements() ?? 0) > 0;
        },
        isInteracting() {
          return pointerLifecycleRef.current?.isInteracting ?? false;
        },
        redo() {
          void editorRef.current?.history.redo();
        },
        serialize() {
          return serializeNotebookInkSynchronously(
            editorRef.current,
            readyRef.current,
            () => pointerLifecycleRef.current?.isInteracting ?? false
          );
        },
        async serializeAsync() {
          const editor = editorRef.current;
          const pointerLifecycle = pointerLifecycleRef.current;
          if (!editor || pointerLifecycle?.isInteracting || !readyRef.current) {
            return null;
          }
          const svg = await editor.toSVGAsync({ pauseAfterCount: 24 });
          return pointerLifecycle?.isInteracting ? null : svg.outerHTML;
        },
        setEraserMode(mode) {
          desiredStyleRef.current = { ...desiredStyleRef.current, eraserMode: mode };
          const editor = editorRef.current;
          const jsDraw = jsDrawRef.current;
          if (!editor || !jsDraw) return;
          applyNotebookEraserMode(editor, mode, jsDraw);
          editor.toolController
            .getMatchingTools(jsDraw.EraserTool)[0]
            ?.setThickness(
              getNotebookEraserToolThickness(
                mode,
                desiredStyleRef.current.eraserThickness
              )
            );
        },
        undo() {
          void editorRef.current?.history.undo();
        },
      }),
      []
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      let disposed = false;
      let editor: JsDrawEditor | null = null;
      let historyListener: { remove(): void } | null = null;
      let penPreviewBatch: NotebookPenPreviewBatch | null = null;
      let viewportResizeObserver: ResizeObserver | null = null;
      let removeViewportResizeFallback: (() => void) | null = null;
      loadingRef.current = true;
      readyRef.current = false;
      pointerLifecycleRef.current?.reset();
      inkSmoothersRef.current.clear();
      appliedStyleRef.current = null;
      host.replaceChildren();

      const pointerLifecycle = pointerLifecycleRef.current;
      const inkSmoothers = inkSmoothersRef.current;
      const lastForwardedPointerSamples =
        lastForwardedPointerSampleRef.current;
      lastForwardedPointerSamples.clear();
      void loadJsDraw()
        .then(async (jsDraw) => {
          if (disposed) return;
          jsDrawRef.current = jsDraw;
          // js-draw REJECTS any viewport transform outside [minZoom, maxZoom]
          // (it resets the transform on every ViewportChanged event). The page
          // viewport scale is displaySize/pageSize — roughly 0.5 at fit and up
          // to ~4 zoomed in — so the limits must be wide or the ink silently
          // renders at identity scale, anchored to the page's top-left corner.
          // User zooming inside js-draw itself stays disabled separately (no
          // wheel events, and touch never reaches js-draw's pan-zoom tools).
          editor = new jsDraw.Editor(host, {
            wheelEventsEnabled: false,
            minZoom: 0.05,
            maxZoom: 50,
          });
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
            createScreenSize: (width, height) =>
              jsDraw.Vec2.of(width, height),
            createTransform: (scaleX, scaleY) =>
              jsDraw.Mat33.scaling2D(jsDraw.Vec2.of(scaleX, scaleY)),
            editor,
            // ResizeObserver supplies this geometry. Keeping it cached avoids
            // a forced DOM layout read whenever js-draw repaints between rapid
            // Pencil strokes.
            getDisplaySize: () => measuredDisplaySize,
            pageHeight,
            pageWidth,
            shouldSkip: () => disposed,
          });
          editorRef.current = editor;
          editor.setReadOnly(readOnlyRef.current);
          // js-draw's display cache re-renders busy scenes from 600px
          // CSS-resolution bitmap blocks. On high-DPI screens those blit
          // upscaled, so ink turns rasterized/blurry after any full re-render
          // (eraser, undo/redo) — and polyline strokes trip the cache
          // threshold almost immediately because it counts path segments.
          // Raising the threshold to Infinity forces the vector fallback, so
          // pages always re-render from geometry and stay crisp.
          const displayCache = (
            editor.display as unknown as {
              getCache?: () => {
                sharedState?: {
                  props?: { minProportionalRenderTimeToUseCache?: number };
                };
              };
            }
          ).getCache?.();
          const cacheProps = displayCache?.sharedState?.props;
          if (cacheProps) {
            cacheProps.minProportionalRenderTimeToUseCache =
              Number.POSITIVE_INFINITY;
          }
          // The notebook toolbar owns tool switching. Disable js-draw's numeric
          // and select-all shortcuts so an iPad keyboard/Scribble event cannot
          // silently activate its purple selection tool behind the app's state.
          editor.toolController
            .getMatchingTools(jsDraw.ToolSwitcherShortcut)
            .forEach((shortcut) => shortcut.setEnabled(false));
          editor.toolController
            .getMatchingTools(jsDraw.SelectAllShortcutHandler)
            .forEach((shortcut) => shortcut.setEnabled(false));
          const primaryPen = editor.toolController.getMatchingTools(jsDraw.PenTool)[0];
          if (primaryPen) {
            primaryPen.setInputMapper(
              makePrecisePenInputMapper(jsDraw, editor, inkSmoothersRef.current)
            );
            // The nib is swapped with the tool, but set the pen's here too so
            // the very first stroke cannot land on js-draw's default fitter.
            applyNotebookStrokeShape(primaryPen, "pen", jsDraw);
            penPreviewBatch = installBatchedNotebookPenPreview(
              primaryPen as unknown as NotebookBatchedPen
            );
            penPreviewBatchRef.current = penPreviewBatch;
          }
          editor.toolController
            .getMatchingTools(jsDraw.EraserTool)
            .forEach((eraser) => {
              // js-draw renders its eraser cursor as a square in the wet-ink
              // layer (not a DOM element, so CSS cannot hide it). Suppress its
              // preview so our circular DOM cursor is the only indicator —
              // notably on iPad/Safari, where there is no hover cursor and the
              // square is what users were seeing.
              suppressNotebookEraserPreview(
                eraser as unknown as { drawPreviewAt?: () => void }
              );
            });
          applyNotebookInkStyle(editor, desiredStyleRef.current, jsDraw);
          appliedStyleRef.current = { ...desiredStyleRef.current };
          editorRoot.style.width = "100%";
          editorRoot.style.height = "100%";
          editorRoot.style.minWidth = "0";
          editorRoot.style.minHeight = "0";
          editorRoot.style.background = "transparent";
          editorRoot.style.pointerEvents = "none";
          const updateMeasuredDisplaySize = (width: number, height: number) => {
            if (width <= 0 || height <= 0) return;
            if (
              measuredDisplaySize.width === width &&
              measuredDisplaySize.height === height
            ) {
              return;
            }
            measuredDisplaySize = { width, height };
            syncViewport();
          };
          if (typeof ResizeObserver !== "undefined") {
            viewportResizeObserver = new ResizeObserver(([entry]) => {
              if (!entry) return;
              updateMeasuredDisplaySize(
                entry.contentRect.width,
                entry.contentRect.height
              );
            });
            viewportResizeObserver.observe(host);
          } else {
            const handleViewportResize = () => {
              const rect = host.getBoundingClientRect();
              updateMeasuredDisplaySize(rect.width, rect.height);
            };
            window.addEventListener("resize", handleViewportResize);
            removeViewportResizeFallback = () =>
              window.removeEventListener("resize", handleViewportResize);
          }
          editor.dispatchNoAnnounce(
            editor.image.setImportExportRect(
              new jsDraw.Rect2(0, 0, pageWidth, pageHeight)
            ),
            false
          );

          historyListener = editor.notifier.on(
            jsDraw.EditorEventType.UndoRedoStackUpdated,
            (event) => {
              if (event.kind !== jsDraw.EditorEventType.UndoRedoStackUpdated) return;
              callbacksRef.current.onHistoryChange(
                event.undoStackSize,
                event.redoStackSize
              );
              if (!loadingRef.current) {
                callbacksRef.current.onChange();
              }
            }
          );
          await editor.loadFromSVG(initialSvgRef.current, true);
          if (disposed || !editor) return;
          const pageRect = new jsDraw.Rect2(0, 0, pageWidth, pageHeight);
          editor.dispatchNoAnnounce(editor.image.setImportExportRect(pageRect), false);

          window.requestAnimationFrame(() => {
            if (disposed || !editor) return;
            syncViewport();
            applyNotebookInkStyle(editor, desiredStyleRef.current, jsDraw);
            appliedStyleRef.current = { ...desiredStyleRef.current };
            loadingRef.current = false;
            readyRef.current = true;
            callbacksRef.current.onHistoryChange(
              editor.history.undoStackSize,
              editor.history.redoStackSize
            );
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
        pointerLifecycle?.reset();
        inkSmoothers.clear();
        lastForwardedPointerSamples.clear();
        viewportResizeObserver?.disconnect();
        removeViewportResizeFallback?.();
        penPreviewBatch?.dispose();
        if (penPreviewBatchRef.current === penPreviewBatch) {
          penPreviewBatchRef.current = null;
        }
        precisionEraserGestureRef.current?.gesture.cancel();
        precisionEraserGestureRef.current = null;
        eraserSurfaceOffsetRef.current = null;
        callbacksRef.current.onInteractionChange(false);
        historyListener?.remove();
        editor?.remove();
        editorRef.current = null;
        jsDrawRef.current = null;
      };
    }, [pageHeight, pageId, pageWidth]);

    useEffect(() => {
      const editor = editorRef.current;
      desiredStyleRef.current = {
        activeTool,
        eraserMode,
        eraserThickness,
        highlighterColor,
        highlighterThickness,
        penColor,
        penThickness,
      };
      if (!editor) return;
      if (pointerLifecycleRef.current?.isInteracting) {
        pendingStyleRef.current = true;
        return;
      }
      const jsDraw = jsDrawRef.current;
      if (!jsDraw) return;
      pendingStyleRef.current = false;
      applyNotebookInkStyle(editor, desiredStyleRef.current, jsDraw);
      appliedStyleRef.current = { ...desiredStyleRef.current };
    }, [
      activeTool,
      eraserMode,
      eraserThickness,
      highlighterColor,
      highlighterThickness,
      penColor,
      penThickness,
    ]);

    useEffect(() => {
      readOnlyRef.current = readOnly;
      editorRef.current?.setReadOnly(readOnly);
    }, [readOnly]);

    useLayoutEffect(() => {
      const surface = inkSurfaceRef.current;
      if (!surface) return;

      // WebKit can decide that a fast horizontal Pencil stroke is a native
      // navigation gesture before React's delegated pointer handler runs. An
      // active, non-passive capture listener on the real ink target closes
      // that timing gap without affecting finger page navigation.
      return installNotebookNativeInkGuards(surface, (event) =>
        shouldSuppressNotebookNativeInkPointer({
            activeTool,
            pointerType: event.pointerType,
            readOnly,
          })
      );
    }, [activeTool, readOnly]);

    const cancelEditorGesture = useCallback(() => {
      inkSmoothersRef.current.clear();
      lastForwardedPointerSampleRef.current.clear();
      scribbleSamplesRef.current = null;
      precisionEraserGestureRef.current?.gesture.cancel();
      precisionEraserGestureRef.current = null;
      eraserSurfaceOffsetRef.current = null;
      if (eraserCursorRef.current) {
        eraserCursorRef.current.style.opacity = "0";
      }
      const editor = editorRef.current;
      const jsDraw = jsDrawRef.current;
      if (!editor || !jsDraw) return;
      editor.toolController.dispatchInputEvent({
        kind: jsDraw.InputEvtType.GestureCancelEvt,
      });
    }, []);

    useEffect(() => {
      const cancelInteractions = () => {
        cancelEditorGesture();
        const pointerLifecycle = pointerLifecycleRef.current;
        const wasInteracting = pointerLifecycle?.isInteracting ?? false;
        pointerLifecycle?.reset();
        if (!wasInteracting) return;
        callbacksRef.current.onInteractionChange(false);
        if (eraserCursorRef.current) {
          eraserCursorRef.current.style.opacity = "0";
        }
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState !== "visible") cancelInteractions();
      };
      window.addEventListener("blur", cancelInteractions);
      window.addEventListener("pagehide", cancelInteractions);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        window.removeEventListener("blur", cancelInteractions);
        window.removeEventListener("pagehide", cancelInteractions);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    }, [cancelEditorGesture]);

    const finishPointerInteraction = useCallback((input: {
      pointerId: number;
      expectCaptureLoss?: boolean;
      timeStamp: number;
    }) => {
      const endedInteraction =
        pointerLifecycleRef.current?.finish({
          pointerId: input.pointerId,
          expectCaptureLoss: input.expectCaptureLoss ?? false,
          timeStamp: input.timeStamp,
        }) ?? false;
      if (!endedInteraction) return;
      callbacksRef.current.onInteractionChange(false);
      if (pendingStyleRef.current && editorRef.current && jsDrawRef.current) {
        pendingStyleRef.current = false;
        applyNotebookInkStyle(
          editorRef.current,
          desiredStyleRef.current,
          jsDrawRef.current
        );
        appliedStyleRef.current = { ...desiredStyleRef.current };
      }
    }, []);

    // Every non-touch tool draws directly through js-draw, so the ink the user
    // sees while writing is the exact ink that is kept and saved. Touch always
    // falls through to the page handlers (fingers navigate, stylus writes).
    const forwardInkPointer = (
      type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
      event: ReactPointerEvent<HTMLDivElement>
    ) => {
      const existingPrecisionGesture = precisionEraserGestureRef.current;
      const continuesPrecisionGesture =
        shouldContinueNotebookPrecisionGesture({
          activePointerId: existingPrecisionGesture?.pointerId,
          pointerId: event.pointerId,
          type,
        });
      // A gesture owns its pointer until release/cancellation. Props can change
      // while Pencil is still down (for example via a finger toolbar tap), but
      // its provisional split must still be finished or restored.
      if (
        type === "pointerdown" &&
        existingPrecisionGesture &&
        event.pointerType !== "touch" &&
        (activeTool === "text" || readOnly)
      ) {
        const strandedPointerId = existingPrecisionGesture.pointerId;
        cancelEditorGesture();
        finishPointerInteraction({
          pointerId: strandedPointerId,
          timeStamp: event.timeStamp,
        });
        try {
          if (event.currentTarget.hasPointerCapture(strandedPointerId)) {
            event.currentTarget.releasePointerCapture(strandedPointerId);
          }
        } catch {
          // Safari may already have discarded the stranded capture.
        }
      }
      if (
        !continuesPrecisionGesture &&
        (event.pointerType === "touch" || activeTool === "text" || readOnly)
      ) {
        return false;
      }
      event.preventDefault();
      const precisionEraserSelected =
        activeTool === "eraser" && eraserMode === "precision";
      const precisionEraserActive = shouldUseNotebookPrecisionGesture({
        continuing: continuesPrecisionGesture,
        precisionEraserSelected,
      });
      let eraserSurfaceOffset: { left: number; top: number } | null = null;
      if (activeTool === "eraser") {
        const activePrecisionGesture = precisionEraserGestureRef.current;
        if (type === "pointerdown") {
          // Refresh once at contact in case the page moved or the viewport
          // changed since Pencil hover entered the surface.
          const rect = event.currentTarget.getBoundingClientRect();
          eraserSurfaceOffset = { left: rect.left, top: rect.top };
          eraserSurfaceOffsetRef.current = eraserSurfaceOffset;
        } else if (
          activePrecisionGesture?.pointerId === event.pointerId
        ) {
          eraserSurfaceOffset = {
            left: activePrecisionGesture.surfaceLeft,
            top: activePrecisionGesture.surfaceTop,
          };
        } else {
          eraserSurfaceOffset = eraserSurfaceOffsetRef.current;
        }
        // Pointer enter normally primes the cache. Keep this one-read fallback
        // for browsers that begin a captured Pencil stream without hover.
        if (!eraserSurfaceOffset) {
          const rect = event.currentTarget.getBoundingClientRect();
          eraserSurfaceOffset = { left: rect.left, top: rect.top };
          eraserSurfaceOffsetRef.current = eraserSurfaceOffset;
        }
        // js-draw measures eraser thickness in screen pixels. Keep the DOM ring
        // in the same coordinate space so the visible boundary is authoritative.
        const diameter = getNotebookEraserCursorDiameter(
          eraserMode,
          eraserThickness
        );
        const cursorDiameter = continuesPrecisionGesture && existingPrecisionGesture
          ? existingPrecisionGesture.cursorDiameter
          : diameter;
        const cursor = eraserCursorRef.current;
        if (cursor) {
          eraserCursorDiameterRef.current = positionNotebookEraserCursor({
            clientX: event.clientX,
            clientY: event.clientY,
            cursor,
            cursorDiameter,
            previousDiameter: eraserCursorDiameterRef.current,
            surfaceLeft: eraserSurfaceOffset.left,
            surfaceTop: eraserSurfaceOffset.top,
          });
        }
      }
      if (!readyRef.current) return true;
      const surface = event.currentTarget;
      const editor = editorRef.current;
      if (type === "pointerdown") {
        const jsDraw = jsDrawRef.current;
        if (editor && jsDraw) {
          // A clean pointerdown can go straight to js-draw. Only cancel when a
          // previous contact is genuinely stranded; cancelling every new
          // stroke creates a race with rapid Pencil re-contact on Safari.
          const pointerStyle: NotebookInkStyle = {
            activeTool,
            eraserMode,
            eraserThickness,
            highlighterColor,
            highlighterThickness,
            penColor,
            penThickness,
          };
          desiredStyleRef.current = pointerStyle;
          const pointerStart =
            pointerLifecycleRef.current?.begin(event.pointerId);
          if (pointerStart?.shouldCancelStaleGesture) {
            cancelEditorGesture();
            eraserSurfaceOffsetRef.current = eraserSurfaceOffset;
            if (eraserCursorRef.current && activeTool === "eraser") {
              eraserCursorRef.current.style.opacity = "1";
            }
          }
          pendingStyleRef.current = false;
          if (!areNotebookInkStylesEqual(appliedStyleRef.current, pointerStyle)) {
            applyNotebookInkStyle(editor, pointerStyle, jsDraw);
            appliedStyleRef.current = { ...pointerStyle };
          }
          const primaryPen =
            editor.toolController.getMatchingTools(jsDraw.PenTool)[0];
          if (primaryPen) {
            const pressureEnabled =
              activeTool === "pen" &&
              shouldUseNotebookPenPressure({
                maxTouchPoints: navigator.maxTouchPoints,
                platform: navigator.platform,
                pointerType: event.pointerType,
                userAgent: navigator.userAgent,
              });
            if (
              primaryPen.getPressureSensitivityEnabled() !== pressureEnabled
            ) {
              primaryPen.setPressureSensitivityEnabled(pressureEnabled);
            }
          }
          // Reassert mutable eraser state at contact time. Precision routing no
          // longer trusts js-draw's mode, but Stroke mode still uses its tool.
          if (activeTool === "eraser") {
            applyNotebookEraserMode(editor, eraserMode, jsDraw);
            editor.toolController
              .getMatchingTools(jsDraw.EraserTool)[0]
              ?.setThickness(
                getNotebookEraserToolThickness(eraserMode, eraserThickness)
              );
          }
        }
        if (!precisionEraserSelected) {
          lastForwardedPointerSampleRef.current.set(
            event.pointerId,
            event.nativeEvent
          );
        }
        if (scribbleToErase && activeTool === "pen") {
          const rect = surface.getBoundingClientRect();
          scribbleSamplesRef.current = {
            pointerId: event.pointerId,
            samples: [
              {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                time: event.timeStamp,
              },
            ],
            surfaceLeft: rect.left,
            surfaceTop: rect.top,
          };
        } else {
          scribbleSamplesRef.current = null;
        }
        try {
          if (!surface.hasPointerCapture(event.pointerId)) {
            surface.setPointerCapture(event.pointerId);
          }
        } catch {
          // Safari can reject capture on rapid stylus re-contact; keep drawing.
        }
        callbacksRef.current.onInteractionChange(true);
      }
      const pointerJsDraw = jsDrawRef.current;
      const scribbleTrack = scribbleSamplesRef.current;
      if (
        scribbleTrack?.pointerId === event.pointerId &&
        (type === "pointermove" || type === "pointerup")
      ) {
        scribbleTrack.samples.push({
          x: event.clientX - scribbleTrack.surfaceLeft,
          y: event.clientY - scribbleTrack.surfaceTop,
          time: event.timeStamp,
        });
        // Past the cap the gesture has run far longer than any scribble, and a
        // truncated path cannot be judged honestly. Stop watching this stroke.
        if (scribbleTrack.samples.length > MAX_SCRIBBLE_SAMPLES) {
          scribbleSamplesRef.current = null;
        }
      }

      /*
       * A scribble is answered before the release reaches js-draw.
       *
       * Cancelling the pen's gesture discards the stroke in progress, so the
       * scribble never becomes a component and never enters the undo history:
       * one press of undo brings back what was erased, with nothing left over.
       * A scribble over blank paper plans nothing and commits as ordinary ink.
       */
      if (
        type === "pointerup" &&
        editor &&
        pointerJsDraw &&
        scribbleSamplesRef.current?.pointerId === event.pointerId &&
        scribbleTrack
      ) {
        const plan = planNotebookScribbleErase({
          editor,
          jsDraw: pointerJsDraw,
          samples: scribbleTrack.samples,
          strokeWidth: penThickness,
        });
        scribbleSamplesRef.current = null;
        if (plan) {
          cancelEditorGesture();
          applyNotebookScribbleErase(editor, pointerJsDraw, plan);
          callbacksRef.current.onScribbleErase?.(plan.components.length);
          finishPointerInteraction({
            pointerId: event.pointerId,
            timeStamp: event.timeStamp,
          });
          try {
            if (surface.hasPointerCapture(event.pointerId)) {
              surface.releasePointerCapture(event.pointerId);
            }
          } catch {
            // Capture may already be gone; the interaction is finished either way.
          }
          inkSmoothersRef.current.delete(event.pointerId);
          lastForwardedPointerSampleRef.current.delete(event.pointerId);
          return true;
        }
      }
      if (type === "pointerup" || type === "pointercancel") {
        scribbleSamplesRef.current = null;
      }
      if (editor) {
        if (precisionEraserActive) {
          if (
            type === "pointerdown" &&
            eraserSurfaceOffset &&
            jsDrawRef.current
          ) {
            const sample = {
              clientX: event.clientX,
              clientY: event.clientY,
              timeStamp: event.timeStamp,
            };
            const cursorDiameter = getNotebookEraserCursorDiameter(
              eraserMode,
              eraserThickness
            );
            const gesture = new NotebookPrecisionEraserGesture(
              editor,
              jsDrawRef.current,
              cursorDiameter
            );
            precisionEraserGestureRef.current = {
              cursorDiameter,
              gesture,
              lastSample: sample,
              pointerId: event.pointerId,
              surfaceLeft: eraserSurfaceOffset.left,
              surfaceTop: eraserSurfaceOffset.top,
            };
            gesture.begin({
              x: sample.clientX - eraserSurfaceOffset.left,
              y: sample.clientY - eraserSurfaceOffset.top,
            });
          } else {
            const activeGesture = precisionEraserGestureRef.current;
            if (
              activeGesture &&
              activeGesture.pointerId === event.pointerId
            ) {
              if (type === "pointercancel") {
                activeGesture.gesture.cancel();
                precisionEraserGestureRef.current = null;
              } else {
                const samples = getContinuousNotebookEraserSamples(
                  event.nativeEvent,
                  activeGesture.lastSample
                );
                const spatialSamples =
                  getSpatiallySimplifiedNotebookEraserSamples(
                    samples,
                    activeGesture.lastSample
                  );
                activeGesture.gesture.moveBatch(
                  spatialSamples.map((sample) => ({
                    x: sample.clientX - activeGesture.surfaceLeft,
                    y: sample.clientY - activeGesture.surfaceTop,
                  }))
                );
                const latestSample = samples[samples.length - 1];
                if (latestSample) activeGesture.lastSample = latestSample;
                if (type === "pointerup") {
                  activeGesture.gesture.finish();
                  precisionEraserGestureRef.current = null;
                  const selectedDiameter = getNotebookEraserCursorDiameter(
                    eraserMode,
                    eraserThickness
                  );
                  eraserCursorDiameterRef.current = selectedDiameter;
                  const cursor = eraserCursorRef.current;
                  if (cursor) {
                    cursor.style.width = `${selectedDiameter}px`;
                    cursor.style.height = `${selectedDiameter}px`;
                  }
                }
              }
            }
          }
        } else if (
          type === "pointermove" &&
          (activeTool === "pen" || activeTool === "highlighter") &&
          pointerJsDraw
        ) {
          // Safari groups high-frequency Pencil input into coalesced packets.
          // Feed those exact points through js-draw's normal tool pipeline,
          // bypassing only its coarse two-CSS-pixel move filter. The wet canvas
          // is repainted once, immediately, after the whole packet is added.
          const liveSamples = getBoundedLivePointerSamples(
            event.nativeEvent,
            lastForwardedPointerSampleRef.current.get(event.pointerId)
          );
          const previewBatch = penPreviewBatchRef.current;
          dispatchBatchedNotebookPointerSamples({
            batch: previewBatch ?? undefined,
            samples: liveSamples,
            dispatch: (sample) => {
              dispatchPreciseNotebookPointerMove({
                editor,
                event: sample,
                jsDraw: pointerJsDraw,
                surface,
              });
            },
          });
          lastForwardedPointerSampleRef.current.set(
            event.pointerId,
            event.nativeEvent
          );
        } else {
          editor.handleHTMLPointerEvent(type, event.nativeEvent);
          if (
            type === "pointerdown" &&
            (activeTool === "pen" || activeTool === "highlighter")
          ) {
            // Show contact immediately instead of waiting for the first move.
            penPreviewBatchRef.current?.paintNow();
          }
        }
      }
      if (type === "pointercancel") {
        // js-draw normalizes pointercancel to pointerup. Explicitly cancel its
        // gesture too so an iPadOS navigation cancellation cannot leave an
        // input filter active and delay the next Pencil stroke.
        cancelEditorGesture();
      }
      if (type === "pointerup" || type === "pointercancel") {
        inkSmoothersRef.current.delete(event.pointerId);
        lastForwardedPointerSampleRef.current.delete(event.pointerId);
        let hadPointerCapture = false;
        try {
          hadPointerCapture = surface.hasPointerCapture(event.pointerId);
        } catch {
          // Capture state may be unavailable after a browser cancellation.
        }
        // Mark the release before capture is dropped. Safari can dispatch the
        // resulting lostpointercapture after the next contact has begun. A
        // pointercancel also ends implicit capture, even when Safari has
        // already stopped reporting it through hasPointerCapture().
        finishPointerInteraction({
          pointerId: event.pointerId,
          expectCaptureLoss: shouldExpectNotebookCaptureLoss(
            type,
            hadPointerCapture
          ),
          timeStamp: event.timeStamp,
        });
        try {
          if (hadPointerCapture) {
            surface.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Capture may already be gone; interaction cleanup still runs.
        }
      }
      return true;
    };

    const renderedEraserCursorDiameter =
      precisionEraserGestureRef.current?.cursorDiameter ??
      getNotebookEraserCursorDiameter(eraserMode, eraserThickness);

    return (
      <div
        data-notebook-live-ink-editor="true"
        className="absolute inset-0 z-20"
      >
        <div
          ref={hostRef}
          aria-hidden="true"
          className="notebook-js-draw-host pointer-events-none absolute inset-0"
        />
        <div
          ref={inkSurfaceRef}
          role="img"
          aria-label="Notebook drawing page"
          className={`notebook-ink-surface absolute inset-0 touch-none select-none ${
            activeTool === "eraser" ? "cursor-none" : ""
          }`}
          onPointerDown={(event) => {
            if (!forwardInkPointer("pointerdown", event)) onPointerDown(event);
          }}
          onPointerMove={(event) => {
            if (!forwardInkPointer("pointermove", event)) onPointerMove(event);
          }}
          onPointerUp={(event) => {
            if (!forwardInkPointer("pointerup", event)) onPointerUp(event);
          }}
          onPointerCancel={(event) => {
            if (!forwardInkPointer("pointercancel", event)) onPointerCancel(event);
          }}
          onPointerEnter={(event) => {
            if (activeTool !== "eraser") return;
            const rect = event.currentTarget.getBoundingClientRect();
            eraserSurfaceOffsetRef.current = {
              left: rect.left,
              top: rect.top,
            };
          }}
          onLostPointerCapture={(event) => {
            if (event.pointerType === "touch") {
              onPointerCancel(event);
              return;
            }
            const pointerId = event.pointerId;
            const decision = pointerLifecycleRef.current?.handleLostCapture(
              pointerId,
              event.timeStamp
            );
            if (decision?.kind !== "cancel-active") return;
            if (
              !pointerLifecycleRef.current?.isCurrent(
                pointerId,
                decision.generation
              )
            ) {
              return;
            }
            cancelEditorGesture();
            finishPointerInteraction({
              pointerId,
              timeStamp: event.timeStamp,
            });
          }}
          onPointerLeave={() => {
            if (eraserCursorRef.current) {
              eraserCursorRef.current.style.opacity = "0";
            }
            if (!pointerLifecycleRef.current?.isInteracting) {
              eraserSurfaceOffsetRef.current = null;
            }
          }}
        />
        {activeTool === "eraser" ? (
          <div
            ref={eraserCursorRef}
            aria-hidden="true"
            data-testid="notebook-eraser-cursor"
            className="pointer-events-none absolute left-0 top-0 z-30 box-border aspect-square rounded-full border-2 border-slate-950/60 bg-transparent opacity-0 shadow-none will-change-transform"
            style={{
              width: renderedEraserCursorDiameter,
              height: renderedEraserCursorDiameter,
            }}
          />
        ) : null}
      </div>
    );
  }
);
