"use client";

import "js-draw/Editor.css";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  Editor as JsDrawEditor,
  InputEvt as JsDrawInputEvent,
  Pointer as JsDrawPointer,
} from "js-draw";
import type {
  NotebookStroke,
  NotebookStrokeColor,
} from "@/lib/workspace/notebooks";
import {
  getNotebookEraserModeValue,
  type NotebookEraserMode,
} from "@/lib/workspace/notebook-eraser";
import { getNotebookInkViewportScale } from "@/lib/workspace/notebook-viewport";
import { getNotebookInkColor } from "@/lib/workspace/notebook-ink-data";
import { NotebookInkSmoother } from "@/lib/workspace/notebook-ink-smoothing";

export type NotebookInkTool = "pen" | "highlighter" | "eraser" | "select" | "text";

export type NotebookInkEditorHandle = {
  clear(): void;
  getHistoryState(): { undoDepth: number; redoDepth: number };
  hasInk(): boolean;
  isInteracting(): boolean;
  redo(): void;
  serializeAsync(): Promise<string | null>;
  setEraserMode(mode: NotebookEraserMode): void;
  undo(): void;
};

export type PreparedNotebookStroke = NotebookStroke & {
  pathData?: string;
};

type Props = {
  activeTool: NotebookInkTool;
  eraserMode: NotebookEraserMode;
  eraserThickness: number;
  highlighterColor: NotebookStrokeColor;
  highlighterThickness: number;
  initialSvg: string;
  pageHeight: number;
  pageId: string;
  pageWidth: number;
  penColor: NotebookStrokeColor;
  penThickness: number;
  onChange(): void;
  onHistoryChange(undoDepth: number, redoDepth: number): void;
  onInteractionChange(active: boolean): void;
  onReady?(): void;
  onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void;
  readOnly?: boolean;
};

type InkStyle = Pick<
  Props,
  | "activeTool"
  | "eraserMode"
  | "eraserThickness"
  | "highlighterColor"
  | "highlighterThickness"
  | "penColor"
  | "penThickness"
>;

type EraserCursor = {
  left: number;
  top: number;
  diameter: number;
  visible: boolean;
};

type JsDrawModule = typeof import("js-draw");

let jsDrawModulePromise: Promise<JsDrawModule> | null = null;

function loadJsDraw() {
  jsDrawModulePromise ??= import("js-draw");
  return jsDrawModulePromise;
}

// js-draw quantizes each incoming pointer's canvas position to a grid of
// 10^floor(log10(1/scaleFactor)) canvas units — a whole canvas unit at this
// notebook's typical zoom. The default Bézier fitting used to hide that grid;
// faithful polyline strokes render it as visible stair-steps ("grainy" ink).
// Every pointer still carries its exact screen position, so this mapper
// re-derives the canvas position at full precision before the pen sees it.
function makePrecisePenInputMapper(jsDraw: JsDrawModule, editor: JsDrawEditor) {
  class PrecisePenInputMapper extends jsDraw.InputMapper {
    onEvent(event: JsDrawInputEvent): boolean {
      if (
        event.kind === jsDraw.InputEvtType.PointerDownEvt ||
        event.kind === jsDraw.InputEvtType.PointerMoveEvt ||
        event.kind === jsDraw.InputEvtType.PointerUpEvt
      ) {
        const withExactPosition = (pointer: JsDrawPointer) =>
          pointer.withScreenPosition(pointer.screenPos, editor.viewport);
        return this.emit({
          ...event,
          current: withExactPosition(event.current),
          allPointers: event.allPointers.map(withExactPosition),
        });
      }
      return this.emit(event);
    }
  }
  return new PrecisePenInputMapper();
}

function applyInkStyle(editor: JsDrawEditor, style: InkStyle, jsDraw: JsDrawModule) {
  const pens = editor.toolController.getMatchingTools(jsDraw.PenTool);
  const erasers = editor.toolController.getMatchingTools(jsDraw.EraserTool);
  const selections = editor.toolController.getMatchingTools(jsDraw.SelectionTool);
  const primaryPen = pens[0];
  if (!primaryPen) return;

  editor.toolController.getPrimaryTools().forEach((editorTool) => {
    editorTool.setEnabled(false);
  });
  pens.slice(1).forEach((pen) => pen.setEnabled(false));

  // Keep the eraser's mode and thickness in sync on every style application,
  // not only while the eraser is the active tool. js-draw defaults the eraser
  // to FullStroke, so configuring it unconditionally ensures the selected
  // precision/stroke mode is already correct the moment the eraser is enabled.
  applyNotebookEraserMode(editor, style.eraserMode, jsDraw);
  erasers[0]?.setThickness(style.eraserThickness);

  if (style.activeTool === "pen" || style.activeTool === "highlighter") {
    const selectedColor =
      style.activeTool === "highlighter" ? style.highlighterColor : style.penColor;
    const { color, opacity } = getNotebookInkColor(selectedColor, style.activeTool);
    const parsed = jsDraw.Color4.fromString(color);
    primaryPen.setColor(jsDraw.Color4.ofRGBA(parsed.r, parsed.g, parsed.b, opacity));
    primaryPen.setThickness(
      style.activeTool === "highlighter"
        ? style.highlighterThickness
        : style.penThickness
    );
    primaryPen.setPressureSensitivityEnabled(style.activeTool === "pen");
    // The default freehand builder re-fits one quadratic Bézier over the whole
    // uncommitted tail on every sample, so the live stroke visibly reshapes
    // ("pulls") behind the pen. The polyline builder commits each sample
    // immediately — with coalesced pointer input the ink follows the pen
    // faithfully, and what is drawn is exactly what is kept.
    primaryPen.setStrokeFactory(jsDraw.makePolylineBuilder);
    primaryPen.setEnabled(true);
  } else if (style.activeTool === "eraser") {
    erasers[0]?.setEnabled(true);
  } else if (style.activeTool === "select") {
    selections[0]?.setEnabled(true);
  }
}

// Pushes the precision/stroke selection straight to js-draw's eraser. Kept
// separate so it can be called imperatively (bypassing the deferred style
// effect), guaranteeing "stroke" maps to FullStroke and "precision" to
// PartialStroke regardless of which tool is active or whether a stale pointer
// is deferring the normal style application.
function applyNotebookEraserMode(
  editor: JsDrawEditor,
  mode: NotebookEraserMode,
  jsDraw: JsDrawModule
) {
  const eraser = editor.toolController.getMatchingTools(jsDraw.EraserTool)[0];
  eraser
    ?.getModeValue()
    .set(
      getNotebookEraserModeValue(mode) === "full-stroke"
        ? jsDraw.EraserMode.FullStroke
        : jsDraw.EraserMode.PartialStroke
    );
}

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
    },
    forwardedRef
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<JsDrawEditor | null>(null);
    const jsDrawRef = useRef<JsDrawModule | null>(null);
    const loadingRef = useRef(true);
    const readyRef = useRef(false);
    const activePointersRef = useRef<Set<number>>(new Set());
    const inkSmoothersRef = useRef<Map<number, NotebookInkSmoother>>(new Map());
    const pendingStyleRef = useRef(false);
    const initialSvgRef = useRef(initialSvg);
    const readOnlyRef = useRef(readOnly);
    const desiredStyleRef = useRef<InkStyle>({
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
    });
    const [eraserCursor, setEraserCursor] = useState<EraserCursor>({
      left: 0,
      top: 0,
      diameter: 0,
      visible: false,
    });

    useEffect(() => {
      callbacksRef.current = {
        onChange,
        onHistoryChange,
        onInteractionChange,
        onReady,
      };
    }, [onChange, onHistoryChange, onInteractionChange, onReady]);

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
          return (editorRef.current?.image.getAllComponents().length ?? 0) > 0;
        },
        isInteracting() {
          return activePointersRef.current.size > 0;
        },
        redo() {
          void editorRef.current?.history.redo();
        },
        async serializeAsync() {
          const editor = editorRef.current;
          if (!editor || activePointersRef.current.size > 0 || !readyRef.current) {
            return null;
          }
          const svg = await editor.toSVGAsync({ pauseAfterCount: 24 });
          return activePointersRef.current.size > 0 ? null : svg.outerHTML;
        },
        setEraserMode(mode) {
          desiredStyleRef.current = { ...desiredStyleRef.current, eraserMode: mode };
          const editor = editorRef.current;
          const jsDraw = jsDrawRef.current;
          if (!editor || !jsDraw) return;
          applyNotebookEraserMode(editor, mode, jsDraw);
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
      let viewportResizeObserver: ResizeObserver | null = null;
      let viewportFrame: number | null = null;
      loadingRef.current = true;
      readyRef.current = false;
      activePointersRef.current.clear();
      inkSmoothersRef.current.clear();
      host.replaceChildren();

      const activePointers = activePointersRef.current;
      const inkSmoothers = inkSmoothersRef.current;
      void loadJsDraw()
        .then(async (jsDraw) => {
          if (disposed) return;
          jsDrawRef.current = jsDraw;
          editor = new jsDraw.Editor(host, {
            wheelEventsEnabled: false,
            minZoom: 1,
            maxZoom: 1,
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
          editor.toolController
            .getMatchingTools(jsDraw.PenTool)[0]
            ?.setInputMapper(makePrecisePenInputMapper(jsDraw, editor));
          editor.toolController
            .getMatchingTools(jsDraw.EraserTool)
            .forEach((eraser) => {
              // js-draw renders its eraser cursor as a square in the wet-ink
              // layer (not a DOM element, so CSS cannot hide it). Suppress its
              // preview so our circular DOM cursor is the only indicator —
              // notably on iPad/Safari, where there is no hover cursor and the
              // square is what users were seeing.
              const previewable = eraser as unknown as {
                drawPreviewAt?: () => void;
                clearPreview?: () => void;
              };
              previewable.drawPreviewAt = function suppressedDrawPreviewAt() {
                previewable.clearPreview?.();
              };
            });
          applyInkStyle(editor, desiredStyleRef.current, jsDraw);
          editor.getRootElement().style.height = "100%";
          editor.getRootElement().style.minHeight = "0";
          editor.getRootElement().style.background = "transparent";
          editor.getRootElement().style.pointerEvents = "none";
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

          const syncViewport = () => {
            if (disposed || !editor) return;
            const scale = getNotebookInkViewportScale({
              displayWidth: editor.display.width,
              displayHeight: editor.display.height,
              pageWidth,
              pageHeight,
            });
            if (scale.x <= 0 || scale.y <= 0) return;
            editor.viewport.resetTransform(
              jsDraw.Mat33.scaling2D(jsDraw.Vec2.of(scale.x, scale.y))
            );
          };
          const scheduleViewportSync = () => {
            if (viewportFrame !== null) return;
            viewportFrame = window.requestAnimationFrame(() => {
              viewportFrame = null;
              syncViewport();
            });
          };

          viewportResizeObserver = new ResizeObserver(scheduleViewportSync);
          viewportResizeObserver.observe(host);
          viewportResizeObserver.observe(editor.getRootElement());
          window.requestAnimationFrame(() => {
            if (disposed || !editor) return;
            syncViewport();
            applyInkStyle(editor, desiredStyleRef.current, jsDraw);
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
          }
        });

      return () => {
        disposed = true;
        readyRef.current = false;
        activePointers.clear();
        inkSmoothers.clear();
        callbacksRef.current.onInteractionChange(false);
        viewportResizeObserver?.disconnect();
        if (viewportFrame !== null) {
          window.cancelAnimationFrame(viewportFrame);
        }
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
      if (activePointersRef.current.size > 0) {
        pendingStyleRef.current = true;
        return;
      }
      const jsDraw = jsDrawRef.current;
      if (!jsDraw) return;
      pendingStyleRef.current = false;
      applyInkStyle(editor, desiredStyleRef.current, jsDraw);
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

    useEffect(() => {
      const cancelInteractions = () => {
        inkSmoothersRef.current.clear();
        if (activePointersRef.current.size === 0) return;
        activePointersRef.current.clear();
        callbacksRef.current.onInteractionChange(false);
        setEraserCursor((current) =>
          current.visible ? { ...current, visible: false } : current
        );
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
    }, []);

    const finishPointerInteraction = useCallback((pointerId: number) => {
      if (!activePointersRef.current.delete(pointerId)) return;
      if (activePointersRef.current.size > 0) return;
      callbacksRef.current.onInteractionChange(false);
      if (pendingStyleRef.current && editorRef.current && jsDrawRef.current) {
        pendingStyleRef.current = false;
        applyInkStyle(
          editorRef.current,
          desiredStyleRef.current,
          jsDrawRef.current
        );
      }
    }, []);

    // Every non-touch tool draws directly through js-draw, so the ink the user
    // sees while writing is the exact ink that is kept and saved. Touch always
    // falls through to the page handlers (fingers navigate, stylus writes).
    const forwardInkPointer = (
      type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
      event: ReactPointerEvent<HTMLDivElement>
    ) => {
      if (event.pointerType === "touch" || activeTool === "text" || readOnly) {
        return false;
      }
      event.preventDefault();
      if (activeTool === "eraser") {
        const rect = event.currentTarget.getBoundingClientRect();
        const diameter = Math.max(12, (eraserThickness / pageWidth) * rect.width);
        setEraserCursor({
          left: event.clientX - rect.left,
          top: event.clientY - rect.top,
          diameter,
          visible: true,
        });
      } else if (eraserCursor.visible) {
        setEraserCursor((current) => ({ ...current, visible: false }));
      }
      if (!readyRef.current) return true;
      const surface = event.currentTarget;
      // Passes drawing input through a One Euro filter so slow strokes lose
      // hand-tremor jitter while fast strokes stay glued to the pen. Filtered
      // samples are re-issued as synthetic PointerEvents; js-draw reads only
      // their coordinates/pressure/button fields, so this is safe.
      const makeFilteredPointerEvent = (
        filteredType: "pointermove" | "pointerup",
        sample: PointerEvent
      ): PointerEvent => {
        const smoother = inkSmoothersRef.current.get(sample.pointerId);
        if (!smoother) return sample;
        const filtered = smoother.next({
          x: sample.clientX,
          y: sample.clientY,
          time: sample.timeStamp,
        });
        return new PointerEvent(filteredType, {
          clientX: filtered.x,
          clientY: filtered.y,
          pointerId: sample.pointerId,
          pointerType: sample.pointerType,
          pressure: sample.pressure,
          isPrimary: sample.isPrimary,
          buttons: sample.buttons,
        });
      };
      if (type === "pointerdown") {
        try {
          if (!surface.hasPointerCapture(event.pointerId)) {
            surface.setPointerCapture(event.pointerId);
          }
        } catch {
          // Safari can reject capture on rapid stylus re-contact; keep drawing.
        }
        activePointersRef.current.add(event.pointerId);
        if (
          (activeTool === "pen" || activeTool === "highlighter") &&
          typeof PointerEvent === "function"
        ) {
          inkSmoothersRef.current.set(
            event.pointerId,
            new NotebookInkSmoother({
              x: event.clientX,
              y: event.clientY,
              time: event.nativeEvent.timeStamp,
            })
          );
        }
        callbacksRef.current.onInteractionChange(true);
      }
      const editor = editorRef.current;
      if (editor) {
        if (type === "pointermove") {
          // Forward the coalesced samples so fast pen movement keeps its full
          // input resolution instead of being downsampled to frame rate.
          const nativeEvent = event.nativeEvent;
          const samples =
            typeof nativeEvent.getCoalescedEvents === "function"
              ? nativeEvent.getCoalescedEvents()
              : [];
          if (samples.length > 0) {
            for (const sample of samples) {
              editor.handleHTMLPointerEvent(
                "pointermove",
                makeFilteredPointerEvent("pointermove", sample)
              );
            }
          } else {
            editor.handleHTMLPointerEvent(
              type,
              makeFilteredPointerEvent("pointermove", nativeEvent)
            );
          }
        } else if (type === "pointerup") {
          editor.handleHTMLPointerEvent(
            type,
            makeFilteredPointerEvent("pointerup", event.nativeEvent)
          );
        } else {
          editor.handleHTMLPointerEvent(type, event.nativeEvent);
        }
      }
      if (type === "pointerup" || type === "pointercancel") {
        inkSmoothersRef.current.delete(event.pointerId);
        try {
          if (surface.hasPointerCapture(event.pointerId)) {
            surface.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Capture may already be gone; interaction cleanup still runs.
        }
        finishPointerInteraction(event.pointerId);
      }
      return true;
    };

    return (
      <div className="absolute inset-0 z-20">
        <div
          ref={hostRef}
          aria-hidden="true"
          className="notebook-js-draw-host pointer-events-none absolute inset-0"
        />
        <div
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
          onLostPointerCapture={(event) => {
            finishPointerInteraction(event.pointerId);
            onPointerCancel(event);
          }}
          onPointerLeave={() => {
            setEraserCursor((current) =>
              current.visible ? { ...current, visible: false } : current
            );
          }}
        />
        {activeTool === "eraser" && eraserCursor.visible ? (
          <div
            aria-hidden="true"
            data-testid="notebook-eraser-cursor"
            className="pointer-events-none absolute z-30 box-border aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950/60 bg-transparent shadow-none"
            style={{
              left: eraserCursor.left,
              top: eraserCursor.top,
              width: eraserCursor.diameter,
              height: eraserCursor.diameter,
            }}
          />
        ) : null}
      </div>
    );
  }
);
