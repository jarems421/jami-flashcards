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
import type { Editor as JsDrawEditor } from "js-draw";
import type { NotebookStroke } from "@/lib/workspace/notebooks";
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
  applyNotebookNibThickness,
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
import type { NotebookInkRenderWindow } from "@/lib/workspace/notebook-ink-window";
import {
  installBatchedNotebookPenPreview,
  type NotebookBatchedPen,
  type NotebookPenPreviewBatch,
} from "@/lib/workspace/notebook-pen-preview";
import {
  dispatchPreciseNotebookPointerMove,
  getJsDrawPointerReferenceElement,
} from "@/lib/workspace/notebook-direct-ink-input";
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
  keepNotebookStraightenedLineAimable,
  relaxNotebookStraightenHold,
  getNotebookInkPointerOrigins,
  positionNotebookEraserCursor,
  type NotebookInkPointerOrigins,
  shouldContinueNotebookPrecisionGesture,
  shouldExpectNotebookCaptureLoss,
  shouldUseNotebookPrecisionGesture,
  suppressNotebookEraserPreview,
} from "@/lib/workspace/notebook-ink-runtime";
import { useNotebookInkRenderWindow } from "@/hooks/useNotebookInkRenderWindow";
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
  /**
   * The slice of a zoomed sheet worth painting, or null for the whole sheet.
   * See `notebook-ink-window.ts` for why a zoomed page is not painted whole.
   */
  inkWindow?: NotebookInkRenderWindow | null;
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
  origins: NotebookInkPointerOrigins;
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
      inkWindow = null,
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
      penSmoothing,
      penThickness,
      readOnly = false,
      scribbleToErase = false,
    },
    forwardedRef
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const inkSurfaceRef = useRef<HTMLDivElement | null>(null);
    const eraserCursorRef = useRef<HTMLDivElement | null>(null);
    const eraserOriginsRef = useRef<NotebookInkPointerOrigins | null>(null);
    const eraserCursorDiameterRef = useRef(
      getNotebookEraserCursorDiameter(eraserThickness)
    );
    const editorRef = useRef<JsDrawEditor | null>(null);
    const jsDrawRef = useRef<JsDrawModule | null>(null);
    const loadingRef = useRef(true);
    const readyRef = useRef(false);
    const pointerLifecycleRef = useRef<NotebookInkPointerLifecycle | null>(null);
    pointerLifecycleRef.current ??= new NotebookInkPointerLifecycle();
    const inkSmoothersRef = useRef<Map<number, NotebookInkSmoother>>(new Map());
    const { inkHostStyle, renderWindowRef, syncViewportRef } =
      useNotebookInkRenderWindow(inkWindow);
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
      penSmoothing,
      penThickness,
    });
    const callbacksRef = useRef({
      onChange,
      onHistoryChange,
      onInteractionChange,
      onReady,
      onReadyError,
    });
    useEffect(() => {
      callbacksRef.current = {
        onChange,
        onHistoryChange,
        onInteractionChange,
        onReady,
        onReadyError,
      };
    }, [
      onChange,
      onHistoryChange,
      onInteractionChange,
      onReady,
      onReadyError,
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
              getNotebookEraserToolThickness(desiredStyleRef.current.eraserThickness)
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
            // Scale the page, then shift the painted slice to the top-left of
            // the canvas. js-draw reads screen positions against this same
            // element, so pointers and ink agree without either knowing there
            // is a window at all.
            createTransform: (scaleX, scaleY, offsetX, offsetY) =>
              jsDraw.Mat33.translation(
                jsDraw.Vec2.of(-offsetX, -offsetY)
              ).rightMul(jsDraw.Mat33.scaling2D(jsDraw.Vec2.of(scaleX, scaleY))),
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
          /*
           * js-draw's display cache is off, and cannot be repaired from here.
           *
           * It re-renders busy scenes from bitmap blocks fixed at 600x600
           * canvas units, and decides a block is sharp enough to blit when one
           * of its pixels covers no more than `maxScale` screen pixels --
           * defined upstream as `Math.max(1, 1.3 / devicePixelRatio)`. The
           * floor is the bug: at devicePixelRatio 2 it evaluates to 1, so a
           * cache pixel may cover a whole CSS pixel, which is two device
           * pixels, and the blit is a 2x upscale. That is the blurriness after
           * every eraser and undo. js-draw's own comment beside it reads
           * "TODO: Decrease the minimum cache scale as well."
           *
           * A note left here in July said to revisit with a DPR-aware cache.
           * Checked properly on 2 September: it cannot be built from
           * application code, for three separate reasons.
           *
           *  - `blockResolution` cannot be raised after construction. The
           *    cache's `createRenderer` closes over the original 600 to size
           *    its canvas, so changing the prop alone leaves the canvas and the
           *    cache disagreeing about how big a block is.
           *  - `Display.cache` is a private field and `getCache()` is marked
           *    @internal, so the cache object cannot be replaced.
           *  - `RenderingCache` is not exported from js-draw's entry point, so
           *    a correctly-sized one cannot be constructed to put there.
           *
           * Fixing it properly means patching js-draw or changing it upstream,
           * and this repo patches no dependencies. Until then the threshold
           * stays at Infinity, which forces the vector fallback: every page
           * re-renders from geometry and stays crisp at any zoom.
           *
           * The cost of that is proportional to how many path segments a page
           * holds, which is why the real fix went into what gets stored rather
           * than how it is drawn -- see notebook-ink-compaction.ts, which took
           * the worst page found from 9,540 segments to 2,835.
           */
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
            // A line that has snapped straight goes on following the pen, so
            // js-draw must not put the angle it first snapped to back when the
            // pen lifts shortly after being moved.
            keepNotebookStraightenedLineAimable(primaryPen);
            // And the hold that triggers the snap has to be one a hand resting
            // on glass can actually satisfy.
            relaxNotebookStraightenHold(primaryPen);
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
        eraserOriginsRef.current = null;
        callbacksRef.current.onInteractionChange(false);
        historyListener?.remove();
        editor?.remove();
        editorRef.current = null;
        jsDrawRef.current = null;
        syncViewportRef.current = null;
      };
    }, [pageHeight, pageId, pageWidth, renderWindowRef, syncViewportRef]);

    useEffect(() => {
      const editor = editorRef.current;
      desiredStyleRef.current = {
        activeTool,
        eraserMode,
        eraserThickness,
        highlighterColor,
        highlighterThickness,
        penColor,
        penSmoothing,
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
      penSmoothing,
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
      eraserOriginsRef.current = null;
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
      const surface = event.currentTarget;
      // js-draw measures its own events against a region inside this host, not
      // against the surface the handlers sit on. See notebook-direct-ink-input.
      const host = hostRef.current;
      const inkRegion = getJsDrawPointerReferenceElement(host);
      let eraserOrigins: NotebookInkPointerOrigins | null = null;
      if (activeTool === "eraser") {
        const activePrecisionGesture = precisionEraserGestureRef.current;
        if (type === "pointerdown") {
          // Refresh once at contact in case the page moved or the viewport
          // changed since Pencil hover entered the surface.
          eraserOrigins = getNotebookInkPointerOrigins(surface, inkRegion);
          eraserOriginsRef.current = eraserOrigins;
        } else if (activePrecisionGesture?.pointerId === event.pointerId) {
          eraserOrigins = activePrecisionGesture.origins;
        } else {
          eraserOrigins = eraserOriginsRef.current;
        }
        // Pointer enter normally primes the cache. Keep this one-read fallback
        // for browsers that begin a captured Pencil stream without hover.
        if (!eraserOrigins) {
          eraserOrigins = getNotebookInkPointerOrigins(surface, inkRegion);
          eraserOriginsRef.current = eraserOrigins;
        }
        // js-draw measures eraser thickness in screen pixels. Keep the DOM ring
        // in the same coordinate space so the visible boundary is authoritative.
        const diameter = getNotebookEraserCursorDiameter(eraserThickness);
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
            surfaceLeft: eraserOrigins.surface.left,
            surfaceTop: eraserOrigins.surface.top,
          });
        }
      }
      if (!readyRef.current) return true;
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
            penSmoothing,
            penThickness,
          };
          desiredStyleRef.current = pointerStyle;
          const pointerStart =
            pointerLifecycleRef.current?.begin(event.pointerId);
          if (pointerStart?.shouldCancelStaleGesture) {
            cancelEditorGesture();
            eraserOriginsRef.current = eraserOrigins;
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
          // The nib is set in page units but js-draw wants screen pixels, so
          // its value depends on the current zoom -- which changes without the
          // style changing, and so would otherwise be missed by the equality
          // check above. Reasserting it here pins the mark to the page.
          applyNotebookNibThickness(editor, pointerStyle, jsDraw);
          // Reassert mutable eraser state at contact time. Precision routing no
          // longer trusts js-draw's mode, but Stroke mode still uses its tool.
          if (activeTool === "eraser") {
            applyNotebookEraserMode(editor, eraserMode, jsDraw);
            editor.toolController
              .getMatchingTools(jsDraw.EraserTool)[0]
              ?.setThickness(
                getNotebookEraserToolThickness(eraserThickness)
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
          // Raw client coordinates. Recognising a scribble does not need to
          // know where the page is, and asking would force a layout flush at
          // the start of every stroke.
          scribbleSamplesRef.current = {
            pointerId: event.pointerId,
            samples: [
              {
                x: event.clientX,
                y: event.clientY,
                time: event.timeStamp,
              },
            ],
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
          x: event.clientX,
          y: event.clientY,
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
          getSurfaceOffset: () =>
            getNotebookInkPointerOrigins(surface, inkRegion).region,
          samples: scribbleTrack.samples,
          strokeWidth: penThickness,
        });
        scribbleSamplesRef.current = null;
        if (plan) {
          cancelEditorGesture();
          applyNotebookScribbleErase(editor, pointerJsDraw, plan);
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
            eraserOrigins &&
            jsDrawRef.current
          ) {
            const sample = {
              clientX: event.clientX,
              clientY: event.clientY,
              timeStamp: event.timeStamp,
            };
            const cursorDiameter = getNotebookEraserCursorDiameter(eraserThickness);
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
              origins: eraserOrigins,
            };
            gesture.begin({
              x: sample.clientX - eraserOrigins.region.left,
              y: sample.clientY - eraserOrigins.region.top,
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
                    x: sample.clientX - activeGesture.origins.region.left,
                    y: sample.clientY - activeGesture.origins.region.top,
                  }))
                );
                const latestSample = samples[samples.length - 1];
                if (latestSample) activeGesture.lastSample = latestSample;
                if (type === "pointerup") {
                  activeGesture.gesture.finish();
                  precisionEraserGestureRef.current = null;
                  const selectedDiameter = getNotebookEraserCursorDiameter(eraserThickness);
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
          pointerJsDraw &&
          host &&
          /*
           * Only while this contact is actually down.
           *
           * A Pencil reports pointermove as it hovers, before it has touched
           * anything and after it has left, and a mouse reports it whenever it
           * crosses the page. Without this, every one of those was fed to
           * js-draw as drawing input on the fast path below -- so the stroke
           * went on growing after the pen had been lifted, following it through
           * the air.
           *
           * `buttons` is the second half of it. A contact can end without this
           * component seeing the up -- capture lost to a system gesture, a
           * pointer cancelled out from under it -- and the browser is the only
           * one that always knows whether anything is currently pressed.
           */
          pointerLifecycleRef.current?.isDown(event.pointerId) &&
          event.buttons !== 0
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
                host,
                jsDraw: pointerJsDraw,
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
      getNotebookEraserCursorDiameter(eraserThickness);

    return (
      <div
        data-notebook-live-ink-editor="true"
        className="absolute inset-0 z-20"
      >
        <div
          ref={hostRef}
          aria-hidden="true"
          className="notebook-js-draw-host pointer-events-none absolute"
          style={inkHostStyle}
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
            eraserOriginsRef.current = getNotebookInkPointerOrigins(
              event.currentTarget,
              getJsDrawPointerReferenceElement(hostRef.current)
            );
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
              eraserOriginsRef.current = null;
            }
          }}
        />
        {activeTool === "eraser" ? (
          <div
            ref={eraserCursorRef}
            aria-hidden="true"
            data-testid="notebook-eraser-cursor"
            /*
             * Outlined in both polarities: a pale ring with a dark one just
             * inside and outside it. A single dark outline disappeared on a
             * black page, and a single pale one would disappear on a white
             * one -- and neither can be chosen from the page colour anyway,
             * since the ring also has to stay visible over an imported PDF
             * page, which can be anything at all.
             */
            /*
             * Drawn on both sides of the edge at once, so the swatch outline reads against
             * a white page and a black one without knowing which it is on.
             */
            // eslint-disable-next-line no-restricted-syntax
            className="pointer-events-none absolute left-0 top-0 z-30 box-border aspect-square rounded-full border-2 border-white/85 bg-transparent opacity-0 shadow-[0_0_0_1.5px_rgba(2,6,23,0.55),inset_0_0_0_1.5px_rgba(2,6,23,0.55)] will-change-transform"
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
