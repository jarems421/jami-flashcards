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
import { useNotebookInkEditorRefs } from "@/hooks/useNotebookInkEditorRefs";
import { useNotebookInkPointerInput } from "@/hooks/useNotebookInkPointerInput";
import { useNotebookInkRenderWindow } from "@/hooks/useNotebookInkRenderWindow";
import { useNotebookInkSnapshots } from "@/hooks/useNotebookInkSnapshots";
import { useNotebookJsDrawEditor, type NotebookInkEditorCallbacks } from "@/hooks/useNotebookJsDrawEditor";
import { getNotebookEraserToolThickness, type NotebookEraserMode } from "@/lib/workspace/notebook-eraser";
import { setNotebookInkContact } from "@/lib/workspace/notebook-ink-activity";
import type { NotebookInkRenderWindow } from "@/lib/workspace/notebook-ink-window";
import {
  applyNotebookEraserMode,
  serializeNotebookInkSynchronously,
  type NotebookInkStyle,
} from "@/lib/workspace/notebook-js-draw";

export type NotebookInkEditorHandle = {
  clear(): void;
  getHistoryState(): { undoDepth: number; redoDepth: number };
  hasInk(): boolean;
  isInteracting(): boolean;
  redo(): void;
  serialize(): string | null;
  serializeAsync(): Promise<string | null>;
  /**
   * The most recent snapshot, taken off the critical path.
   *
   * A page swipe needs the outgoing page as an SVG the instant the gesture
   * starts, and `serialize()` blocks the main thread to produce one -- on the
   * very pointermove that begins the swipe, which is where a stall is most
   * visible. This returns a snapshot that was already prepared while the page
   * sat idle, and falls back to the blocking path only when there is none.
   */
  serializeWarm(): string | null;
  setEraserMode(mode: NotebookEraserMode): void;
  undo(): void;
};

type Props = NotebookInkStyle &
  NotebookInkEditorCallbacks & {
    initialSvg: string;
    /**
     * The slice of a zoomed sheet worth painting, or null for the whole sheet.
     * See `notebook-ink-window.ts` for why a zoomed page is not painted whole.
     */
    inkWindow?: NotebookInkRenderWindow | null;
    pageHeight: number;
    pageId: string;
    pageWidth: number;
    onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void;
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void;
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void;
    readOnly?: boolean;
    /** Scribbling out with the pen deletes the strokes it covers. */
    scribbleToErase?: boolean;
  };

/**
 * A notebook page's ink: js-draw underneath, a fast live canvas over it for
 * the stroke being drawn, and the eraser's ring.
 *
 * Composed from the editor's lifecycle (`useNotebookJsDrawEditor`), the
 * pointer routing that feeds it (`useNotebookInkPointerInput`) and the SVG
 * snapshots the page saves and swipes with (`useNotebookInkSnapshots`), which
 * share their mutable state through `useNotebookInkEditorRefs`. The page
 * drives it through the handle.
 */
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
      penSettings,
      penThickness,
      readOnly = false,
      scribbleToErase = false,
    },
    forwardedRef
  ) {
    const style: NotebookInkStyle = {
      activeTool,
      eraserMode,
      eraserThickness,
      highlighterColor,
      highlighterThickness,
      penColor,
      penSettings,
      penThickness,
    };
    const refs = useNotebookInkEditorRefs(style);
    const {
      hostRef,
      inkSurfaceRef,
      eraserCursorRef,
      liveInkCanvasRef,
      editorRef,
      jsDrawRef,
      readyRef,
      pointerLifecycleRef,
      styleSyncRef,
    } = refs;
    const { inkHostStyle, renderWindowRef, syncViewportRef } = useNotebookInkRenderWindow(inkWindow);

    const callbacksRef = useRef<NotebookInkEditorCallbacks>({
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
    }, [onChange, onHistoryChange, onInteractionChange, onReady, onReadyError]);

    /** This editor's identity in the app-wide pen signal. */
    const inkActivityOwnerRef = useRef<object>({});
    /**
     * Tells the page and the rest of the app whether a pen is down. The
     * app-wide signal is what holds the PDF render and the export back.
     */
    const reportInteraction = useCallback((active: boolean) => {
      setNotebookInkContact(inkActivityOwnerRef.current, active);
      callbacksRef.current.onInteractionChange(active);
    }, []);
    const isInteracting = useCallback(
      () => pointerLifecycleRef.current?.isInteracting ?? false,
      [pointerLifecycleRef]
    );

    const snapshots = useNotebookInkSnapshots({ editorRef, readyRef, isInteracting });
    const { exportCurrentInk, currentSnapshot } = snapshots;
    const pointerInput = useNotebookInkPointerInput({
      refs,
      style,
      readOnly,
      scribbleToErase,
      inkWindow,
      reportInteraction,
      page: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    });
    useNotebookJsDrawEditor({
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
      resetPointerState: pointerInput.resetPointerState,
      snapshots,
    });

    useImperativeHandle(
      forwardedRef,
      () => {
        const serializeSynchronously = () =>
          serializeNotebookInkSynchronously(editorRef.current, readyRef.current, isInteracting);
        return {
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
          isInteracting,
          redo() {
            void editorRef.current?.history.redo();
          },
          serialize() {
            // An export already taken of exactly this ink saves blocking on
            // another, which matters most here: this runs as a student leaves.
            const snapshot = currentSnapshot();
            if (snapshot !== null && readyRef.current && !isInteracting()) return snapshot;
            return serializeSynchronously();
          },
          serializeWarm() {
            // A prepared snapshot is preferred even mid-gesture, where the
            // blocking path refuses to run at all and would otherwise hand the
            // swipe a stale SVG from the last save.
            return currentSnapshot() ?? serializeSynchronously();
          },
          async serializeAsync() {
            if (!editorRef.current || isInteracting() || !readyRef.current) {
              return null;
            }
            const svg = await exportCurrentInk();
            return isInteracting() ? null : svg;
          },
          setEraserMode(mode) {
            const styleSync = styleSyncRef.current;
            if (!styleSync) return;
            styleSync.desired = { ...styleSync.desired, eraserMode: mode };
            const editor = editorRef.current;
            const jsDraw = jsDrawRef.current;
            if (!editor || !jsDraw) return;
            applyNotebookEraserMode(editor, mode, jsDraw);
            editor.toolController
              .getMatchingTools(jsDraw.EraserTool)[0]
              ?.setThickness(getNotebookEraserToolThickness(styleSync.desired.eraserThickness));
          },
          undo() {
            void editorRef.current?.history.undo();
          },
        };
      },
      [currentSnapshot, editorRef, exportCurrentInk, isInteracting, jsDrawRef, readyRef, styleSyncRef]
    );

    return (
      <div
        data-notebook-live-ink-editor="true"
        // Its own layer, so wet ink redrawing every frame never invalidates
        // the ruled paper or PDF beneath it -- see NotebookLivePageLayers.
        className="absolute inset-0 z-20 [transform:translateZ(0)] [will-change:transform]"
      >
        <div
          ref={hostRef}
          aria-hidden="true"
          className="notebook-js-draw-host pointer-events-none absolute"
          style={inkHostStyle}
        />
        {/* Fast live ink: sized and placed at each contact, never by React. */}
        <canvas
          ref={liveInkCanvasRef}
          aria-hidden="true"
          data-notebook-live-ink-canvas="true"
          className="pointer-events-none absolute left-0 top-0"
        />
        <div
          ref={inkSurfaceRef}
          role="img"
          aria-label="Notebook drawing page"
          className={`notebook-ink-surface absolute inset-0 touch-none select-none ${
            activeTool === "eraser" ? "cursor-none" : ""
          }`}
          {...pointerInput.surfaceHandlers}
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
              width: pointerInput.eraserCursorDiameter,
              height: pointerInput.eraserCursorDiameter,
            }}
          />
        ) : null}
      </div>
    );
  }
);
