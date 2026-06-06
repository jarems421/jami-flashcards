"use client";

import "js-draw/Editor.css";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Color4,
  Editor,
  EditorEventType,
  Erase,
  EraserTool,
  EraserMode,
  PenTool,
  Rect2,
  SelectionTool,
} from "js-draw";
import type { NotebookStrokeColor } from "@/lib/workspace/notebooks";
import { getNotebookInkColor } from "@/lib/workspace/notebook-ink-data";

export type NotebookInkTool = "pen" | "highlighter" | "eraser" | "select" | "text";

export type NotebookInkEditorHandle = {
  clear(): void;
  hasInk(): boolean;
  isInteracting(): boolean;
  redo(): void;
  serializeAsync(): Promise<string | null>;
  undo(): void;
};

type Props = {
  activeTool: NotebookInkTool;
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
  | "eraserThickness"
  | "highlighterColor"
  | "highlighterThickness"
  | "penColor"
  | "penThickness"
>;

function applyInkStyle(editor: Editor, style: InkStyle) {
  const pens = editor.toolController.getMatchingTools(PenTool);
  const erasers = editor.toolController.getMatchingTools(EraserTool);
  const selections = editor.toolController.getMatchingTools(SelectionTool);
  const primaryPen = pens[0];
  if (!primaryPen) return;

  editor.toolController.getPrimaryTools().forEach((editorTool) => {
    editorTool.setEnabled(false);
  });
  pens.slice(1).forEach((pen) => pen.setEnabled(false));

  if (style.activeTool === "pen" || style.activeTool === "highlighter") {
    const selectedColor =
      style.activeTool === "highlighter" ? style.highlighterColor : style.penColor;
    const { color, opacity } = getNotebookInkColor(selectedColor, style.activeTool);
    const parsed = Color4.fromString(color);
    primaryPen.setColor(Color4.ofRGBA(parsed.r, parsed.g, parsed.b, opacity));
    primaryPen.setThickness(
      style.activeTool === "highlighter"
        ? style.highlighterThickness
        : style.penThickness
    );
    primaryPen.setPressureSensitivityEnabled(style.activeTool === "pen");
    primaryPen.setHasStabilization(true);
    primaryPen.setEnabled(true);
  } else if (style.activeTool === "eraser") {
    const eraser = erasers[0];
    eraser?.setThickness(style.eraserThickness);
    eraser?.getModeValue().set(EraserMode.PartialStroke);
    eraser?.setEnabled(true);
  } else if (style.activeTool === "select") {
    selections[0]?.setEnabled(true);
  }
}

export const NotebookInkEditor = forwardRef<NotebookInkEditorHandle, Props>(
  function NotebookInkEditor(
    {
      activeTool,
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
    const editorRef = useRef<Editor | null>(null);
    const loadingRef = useRef(true);
    const readyRef = useRef(false);
    const activePointersRef = useRef<Set<number>>(new Set());
    const pendingStyleRef = useRef(false);
    const initialSvgRef = useRef(initialSvg);
    const readOnlyRef = useRef(readOnly);
    const desiredStyleRef = useRef<InkStyle>({
      activeTool,
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
          if (!editor) return;
          const components = editor.image.getAllComponents();
          if (components.length > 0) editor.dispatch(new Erase(components));
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
      loadingRef.current = true;
      readyRef.current = false;
      activePointersRef.current.clear();
      host.replaceChildren();

      const editor = new Editor(host, {
        wheelEventsEnabled: false,
        minZoom: 1,
        maxZoom: 1,
      });
      const activePointers = activePointersRef.current;
      editorRef.current = editor;
      editor.setReadOnly(readOnlyRef.current);
      applyInkStyle(editor, desiredStyleRef.current);
      editor.getRootElement().style.height = "100%";
      editor.getRootElement().style.minHeight = "0";
      editor.getRootElement().style.background = "transparent";
      editor.getRootElement().style.pointerEvents = "none";
      editor.dispatchNoAnnounce(
        editor.image.setImportExportRect(new Rect2(0, 0, pageWidth, pageHeight)),
        false
      );

      const historyListener = editor.notifier.on(EditorEventType.UndoRedoStackUpdated, (event) => {
        if (event.kind !== EditorEventType.UndoRedoStackUpdated) return;
        callbacksRef.current.onHistoryChange(event.undoStackSize, event.redoStackSize);
        if (!loadingRef.current) callbacksRef.current.onChange();
      });
      void editor.loadFromSVG(initialSvgRef.current, true).then(() => {
        if (disposed) return;
        const pageRect = new Rect2(0, 0, pageWidth, pageHeight);
        editor.dispatchNoAnnounce(editor.image.setImportExportRect(pageRect), false);
        window.requestAnimationFrame(() => {
          if (disposed) return;
          editor.viewport.resetTransform(
            editor.viewport.computeZoomToTransform(pageRect, true, true)
          );
          applyInkStyle(editor, desiredStyleRef.current);
          loadingRef.current = false;
          readyRef.current = true;
          callbacksRef.current.onHistoryChange(
            editor.history.undoStackSize,
            editor.history.redoStackSize
          );
        });
      });

      return () => {
        disposed = true;
        readyRef.current = false;
        activePointers.clear();
        callbacksRef.current.onInteractionChange(false);
        historyListener.remove();
        editor.remove();
        editorRef.current = null;
      };
    }, [pageHeight, pageId, pageWidth]);

    useEffect(() => {
      const editor = editorRef.current;
      desiredStyleRef.current = {
        activeTool,
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
      pendingStyleRef.current = false;
      applyInkStyle(editor, desiredStyleRef.current);
    }, [
      activeTool,
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

    const finishPointerInteraction = useCallback((pointerId: number) => {
      if (!activePointersRef.current.delete(pointerId)) return;
      if (activePointersRef.current.size > 0) return;
      callbacksRef.current.onInteractionChange(false);
      if (pendingStyleRef.current && editorRef.current) {
        pendingStyleRef.current = false;
        applyInkStyle(editorRef.current, desiredStyleRef.current);
      }
    }, []);

    const forwardInkPointer = (
      type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
      event: ReactPointerEvent<HTMLDivElement>
    ) => {
      if (event.pointerType === "touch" || activeTool === "text" || readOnly) return false;
      event.preventDefault();
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
          className="notebook-ink-surface absolute inset-0 touch-none select-none"
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
        />
      </div>
    );
  }
);
