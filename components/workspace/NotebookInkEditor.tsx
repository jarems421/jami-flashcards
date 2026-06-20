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
import {
  Color4,
  Path,
  Stroke,
  pathToRenderable,
  uniteCommands,
  type Editor as JsDrawEditor,
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
import {
  getFreehandOutline,
  getSvgPathFromStrokeOutline,
} from "@/lib/workspace/notebook-ink-engine";

export type NotebookInkTool = "pen" | "highlighter" | "eraser" | "select" | "text";

export type NotebookInkEditorHandle = {
  clear(): void;
  commitStrokes(strokes: PreparedNotebookStroke[]): Promise<void>;
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
    primaryPen.setHasStabilization(false);
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
    const suppressedChangeEventsRef = useRef(0);
    const activePointersRef = useRef<Set<number>>(new Set());
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
      };
    }, [onChange, onHistoryChange, onInteractionChange]);

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
        async commitStrokes(strokes) {
          const editor = editorRef.current;
          if (!editor || strokes.length === 0) return;
          const commands = strokes.flatMap((stroke) => {
            if (stroke.tool === "eraser" || stroke.points.length === 0) return [];
            const pathData =
              stroke.pathData ??
              getSvgPathFromStrokeOutline(
                getFreehandOutline({
                  points: stroke.points,
                  tool: stroke.tool,
                  width: stroke.width,
                  mode: "committed",
                })
              );
            if (!pathData) return [];
            const { color, opacity } = getNotebookInkColor(
              stroke.color,
              stroke.tool
            );
            const parsed = Color4.fromString(color);
            const component = new Stroke([
              pathToRenderable(Path.fromString(pathData), {
                fill: Color4.ofRGBA(
                  parsed.r,
                  parsed.g,
                  parsed.b,
                  opacity
                ),
              }),
            ]);
            return [editor.image.addComponent(component)];
          });
          if (commands.length === 0) return;
          suppressedChangeEventsRef.current += 1;
          try {
            await editor.dispatch(
              uniteCommands(commands, {
                description:
                  commands.length === 1
                    ? "Add notebook stroke"
                    : "Add notebook strokes",
              })
            );
          } finally {
            suppressedChangeEventsRef.current = Math.max(
              0,
              suppressedChangeEventsRef.current - 1
            );
          }
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
      host.replaceChildren();

      const activePointers = activePointersRef.current;
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
              if (
                !loadingRef.current &&
                suppressedChangeEventsRef.current === 0
              ) {
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

    const forwardInkPointer = (
      type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
      event: ReactPointerEvent<HTMLDivElement>
    ) => {
      if (
        event.pointerType === "touch" ||
        activeTool === "text" ||
        activeTool === "pen" ||
        activeTool === "highlighter" ||
        readOnly
      ) {
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
      if (type === "pointerdown") {
        activePointersRef.current.add(event.pointerId);
        callbacksRef.current.onInteractionChange(true);
      }
      editorRef.current?.handleHTMLPointerEvent(type, event.nativeEvent);
      if (type === "pointerup" || type === "pointercancel") {
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
