"use client";

import "js-draw/Editor.css";

import {
  forwardRef,
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
  redo(): void;
  serialize(): string;
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
  onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void;
  readOnly?: boolean;
};

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
    const callbacksRef = useRef({ onChange, onHistoryChange });

    useEffect(() => {
      callbacksRef.current = { onChange, onHistoryChange };
    }, [onChange, onHistoryChange]);

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
        redo() {
          void editorRef.current?.history.redo();
        },
        serialize() {
          return editorRef.current?.toSVG().outerHTML ?? initialSvg;
        },
        undo() {
          void editorRef.current?.history.undo();
        },
      }),
      [initialSvg]
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      let disposed = false;
      loadingRef.current = true;
      host.replaceChildren();

      const editor = new Editor(host, {
        wheelEventsEnabled: false,
        minZoom: 1,
        maxZoom: 1,
      });
      editorRef.current = editor;
      editor.setReadOnly(readOnly);
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
      const objectListener = editor.notifier.on(EditorEventType.ObjectAdded, () => {
        if (!loadingRef.current) callbacksRef.current.onChange();
      });

      void editor.loadFromSVG(initialSvg, true).then(() => {
        if (disposed) return;
        const pageRect = new Rect2(0, 0, pageWidth, pageHeight);
        editor.dispatchNoAnnounce(editor.image.setImportExportRect(pageRect), false);
        window.requestAnimationFrame(() => {
          if (disposed) return;
          editor.viewport.resetTransform(
            editor.viewport.computeZoomToTransform(pageRect, true, true)
          );
          loadingRef.current = false;
          callbacksRef.current.onHistoryChange(
            editor.history.undoStackSize,
            editor.history.redoStackSize
          );
        });
      });

      return () => {
        disposed = true;
        historyListener.remove();
        objectListener.remove();
        editor.remove();
        editorRef.current = null;
      };
    }, [initialSvg, pageHeight, pageId, pageWidth, readOnly]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const pens = editor.toolController.getMatchingTools(PenTool);
      const erasers = editor.toolController.getMatchingTools(EraserTool);
      const selections = editor.toolController.getMatchingTools(SelectionTool);
      const primaryPen = pens[0];
      if (!primaryPen) return;

      if (activeTool === "pen" || activeTool === "highlighter") {
        const selectedColor = activeTool === "highlighter" ? highlighterColor : penColor;
        const { color, opacity } = getNotebookInkColor(selectedColor, activeTool);
        const parsed = Color4.fromString(color);
        primaryPen.setColor(Color4.ofRGBA(parsed.r, parsed.g, parsed.b, opacity));
        primaryPen.setThickness(activeTool === "highlighter" ? highlighterThickness : penThickness);
        primaryPen.setPressureSensitivityEnabled(activeTool === "pen");
        primaryPen.setHasStabilization(true);
        primaryPen.setEnabled(true);
      } else if (activeTool === "eraser") {
        const eraser = erasers[0];
        eraser?.setThickness(eraserThickness);
        eraser?.getModeValue().set(EraserMode.PartialStroke);
        eraser?.setEnabled(true);
      } else if (activeTool === "select") {
        selections[0]?.setEnabled(true);
      } else {
        editor.toolController.getPrimaryTools().forEach((tool) => tool.setEnabled(false));
      }
    }, [
      activeTool,
      eraserThickness,
      highlighterColor,
      highlighterThickness,
      penColor,
      penThickness,
    ]);

    const forwardInkPointer = (
      type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
      event: ReactPointerEvent<HTMLDivElement>
    ) => {
      if (event.pointerType === "touch" || activeTool === "text" || readOnly) return false;
      event.preventDefault();
      editorRef.current?.handleHTMLPointerEvent(type, event.nativeEvent);
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
          onLostPointerCapture={onPointerCancel}
        />
      </div>
    );
  }
);
