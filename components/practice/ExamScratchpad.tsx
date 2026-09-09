"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InkColorPicker from "@/components/workspace/NotebookInkColorPicker";
import SmoothingSlider from "@/components/workspace/NotebookSmoothingSlider";
import ThicknessSlider from "@/components/workspace/NotebookThicknessSlider";
import { Button } from "@/components/ui";
import ToolbarIconButton from "@/components/workspace/NotebookToolbarIconButton";
import {
  NotebookInkEditor,
  type NotebookInkEditorHandle,
  type NotebookInkTool,
} from "@/components/workspace/NotebookInkEditor";
import {
  NOTEBOOK_DEFAULT_THICKNESS_PERCENT,
  getHighlighterWidthFromPercent,
  getPenWidthFromPercent,
} from "@/lib/workspace/notebook-inking";
import { getNotebookStrokePaintColor } from "@/lib/workspace/notebook-page-content";
import {
  readNotebookPenSmoothingPreference,
  saveNotebookPenSmoothingPreference,
} from "@/lib/workspace/notebook-pen-feel";
import type { NotebookStrokeColor } from "@/lib/workspace/notebooks";
import {
  ExamScratchpadTooLargeError,
  loadExamScratchpad,
  saveExamScratchpad,
} from "@/services/study/exam-practice";

/** The sheet's own page units, and the size the frozen snapshot is taken at. */
export const EXAM_WORKING_PAGE_WIDTH = 900;
export const EXAM_WORKING_PAGE_HEIGHT = 1_240;
const SNAPSHOT_WIDTH = 1_200;
const SNAPSHOT_HEIGHT = Math.round(
  (SNAPSHOT_WIDTH * EXAM_WORKING_PAGE_HEIGHT) / EXAM_WORKING_PAGE_WIDTH
);
const SAVE_DEBOUNCE_MS = 700;
const SETTINGS_ID = "exam-working-tool-settings";

export type ExamScratchpadSnapshot = {
  /** Whether there is any ink on the sheet at all. */
  hasInk: boolean;
  /** False when there is ink but it could not be turned into an image. */
  ok: boolean;
  png?: { mimeType: "image/png"; dataBase64: string; width: number; height: number };
};

export type ExamScratchpadHandle = {
  snapshot(): Promise<ExamScratchpadSnapshot>;
};

async function svgToPng(svg: string) {
  if (!svg.trim()) return undefined;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = SNAPSHOT_WIDTH;
    canvas.height = SNAPSHOT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    // A marker reads ink on paper, so the sheet is flattened onto white rather
    // than sent as a transparent overlay whose ground it would have to guess.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
    context.drawImage(image, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
    return {
      mimeType: "image/png" as const,
      dataBase64: canvas.toDataURL("image/png").split(",")[1],
      width: SNAPSHOT_WIDTH,
      height: SNAPSHOT_HEIGHT,
    };
  } catch {
    // A sheet that will not rasterise is still saved as ink. It simply is not
    // sent to the marker, and the answer is marked on its own.
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * One sheet of working, bound to one attempt.
 *
 * It is the notebook's ink editor with the notebook's tools, deliberately: a
 * student who has learned to write in Jami should not meet a different, worse
 * pen the moment the work is being marked. The pen feel is read from the same
 * saved preference, so a hand tuned once stays tuned here.
 *
 * What it is not is a notebook page. There is no text layer, no page history
 * and no `useNotebookInkController` — that hook exists to reconcile strokes
 * with `NotebookTextBlock[]`, which a sheet of working does not have.
 */
export default function ExamScratchpad({
  userId,
  attemptId,
  disabled = false,
  onHandle,
  onInkChange,
}: {
  userId: string;
  attemptId: string;
  disabled?: boolean;
  onHandle(handle: ExamScratchpadHandle | null): void;
  onInkChange?(hasInk: boolean): void;
}) {
  const editorRef = useRef<NotebookInkEditorHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialSvg, setInitialSvg] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveProblem, setSaveProblem] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [tool, setTool] = useState<NotebookInkTool>("pen");
  const [openMenu, setOpenMenu] = useState<NotebookInkTool | null>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [penColor, setPenColor] = useState<NotebookStrokeColor>("black");
  const [penThickness, setPenThickness] = useState(NOTEBOOK_DEFAULT_THICKNESS_PERCENT);
  // Read once, lazily: the saved pen feel is this pad's starting value, and
  // nothing on the first paint depends on it, so there is nothing to sync.
  const [penSmoothing, setPenSmoothing] = useState(readNotebookPenSmoothingPreference);
  const [highlighterColor, setHighlighterColor] = useState<NotebookStrokeColor>("yellow");
  const [highlighterThickness, setHighlighterThickness] = useState(
    NOTEBOOK_DEFAULT_THICKNESS_PERCENT
  );
  const [eraserThickness, setEraserThickness] = useState(NOTEBOOK_DEFAULT_THICKNESS_PERCENT);

  useEffect(() => {
    let active = true;
    void loadExamScratchpad(userId, attemptId)
      .then((svg) => {
        if (!active) return;
        setInitialSvg(svg);
        onInkChange?.(Boolean(svg.trim()));
      })
      // An empty sheet after a failed read is not an empty sheet: writing to it
      // would replace working that is still there. Offer a retry instead.
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [attemptId, onInkChange, reloadKey, userId]);

  const writeSheet = useCallback(async () => {
    if (disabled || !editorRef.current) return true;
    const svg = editorRef.current.serializeWarm() ?? editorRef.current.serialize() ?? "";
    if (!svg) return true;
    try {
      await saveExamScratchpad(userId, attemptId, svg);
      setSaveProblem("");
      return true;
    } catch (error) {
      setSaveProblem(
        error instanceof ExamScratchpadTooLargeError
          ? "This sheet is too detailed to save. Your last saved working is safe — erase some of it, or submit what you have."
          : "Your working could not be saved just now. It is still on the page."
      );
      return false;
    }
  }, [attemptId, disabled, userId]);

  const persist = useCallback(() => {
    // Once the answer is frozen the sheet is evidence rather than a draft, and
    // the security rules refuse the write — so it is not attempted.
    if (disabled || !editorRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void writeSheet(), SAVE_DEBOUNCE_MS);
  }, [disabled, writeSheet]);

  // Leaving flushes the sheet rather than cancelling it, for the same reason
  // the typed draft does: the last stroke is the one most worth keeping.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      void writeSheet();
    },
    [writeSheet]
  );

  useEffect(() => {
    const handle: ExamScratchpadHandle = {
      snapshot: async () => {
        const svg = (await editorRef.current?.serializeAsync()) ?? "";
        const hasInk = (editorRef.current?.getHistoryState().undoDepth ?? 0) > 0 || Boolean(svg.trim());
        if (!hasInk) return { hasInk: false, ok: true };
        await saveExamScratchpad(userId, attemptId, svg).catch(() => undefined);
        const png = await svgToPng(svg);
        // Ink that will not rasterise must not be silently left out of marking.
        return { hasInk: true, ok: Boolean(png), png };
      },
    };
    onHandle(handle);
    return () => onHandle(null);
  }, [attemptId, onHandle, userId]);

  /** Pressing the active tool opens its options; pressing another switches. */
  const selectTool = (next: NotebookInkTool) => {
    if (tool === next) {
      setOpenMenu((current) => (current === next ? null : next));
      return;
    }
    setTool(next);
    setOpenMenu(null);
  };

  const widths = useMemo(
    () => ({
      pen: getPenWidthFromPercent(penThickness),
      highlighter: getHighlighterWidthFromPercent(highlighterThickness),
      eraser: getHighlighterWidthFromPercent(eraserThickness),
    }),
    [eraserThickness, highlighterThickness, penThickness]
  );

  return (
    <div className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-shell">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2 py-1.5">
        <div className="flex items-center gap-1">
          <ToolbarIconButton
            label="Pen"
            icon="pen"
            active={tool === "pen"}
            disabled={disabled}
            expanded={openMenu === "pen"}
            controls={SETTINGS_ID}
            onClick={() => selectTool("pen")}
          />
          <ToolbarIconButton
            label="Highlighter"
            icon="highlighter"
            active={tool === "highlighter"}
            disabled={disabled}
            expanded={openMenu === "highlighter"}
            controls={SETTINGS_ID}
            onClick={() => selectTool("highlighter")}
          />
          <ToolbarIconButton
            label="Eraser"
            icon="eraser"
            active={tool === "eraser"}
            disabled={disabled}
            expanded={openMenu === "eraser"}
            controls={SETTINGS_ID}
            onClick={() => selectTool("eraser")}
          />
        </div>
        <div className="flex items-center gap-1">
          <ToolbarIconButton
            label="Undo"
            icon="undo"
            disabled={disabled || history.undo === 0}
            onClick={() => editorRef.current?.undo()}
          />
          <ToolbarIconButton
            label="Redo"
            icon="redo"
            disabled={disabled || history.redo === 0}
            onClick={() => editorRef.current?.redo()}
          />
          <ToolbarIconButton
            label="Clear working"
            icon="trash"
            disabled={disabled || history.undo === 0}
            onClick={() => editorRef.current?.clear()}
          />
        </div>
      </div>

      {openMenu && !disabled ? (
        <div
          id={SETTINGS_ID}
          role="group"
          aria-label={`${openMenu} settings`}
          className="space-y-3 border-b border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-3"
        >
          {openMenu === "pen" ? (
            <>
              <InkColorPicker
                label="Pen color"
                value={penColor}
                presets={["black", "white", "red", "green"]}
                getPresetColor={(color) => getNotebookStrokePaintColor(color, "pen")}
                onPresetSelect={setPenColor}
                onCustomColorChange={setPenColor}
              />
              <ThicknessSlider
                label="Pen thickness"
                percent={penThickness}
                color={getNotebookStrokePaintColor(penColor, "pen")}
                previewWidth={widths.pen}
                onChange={setPenThickness}
              />
              <SmoothingSlider
                percent={penSmoothing}
                onChange={(value) => {
                  setPenSmoothing(value);
                  saveNotebookPenSmoothingPreference(value);
                }}
              />
            </>
          ) : null}
          {openMenu === "highlighter" ? (
            <>
              <InkColorPicker
                label="Highlighter color"
                value={highlighterColor}
                presets={["yellow", "green", "pink"]}
                getPresetColor={(color) => getNotebookStrokePaintColor(color, "highlighter")}
                onPresetSelect={setHighlighterColor}
                onCustomColorChange={setHighlighterColor}
              />
              <ThicknessSlider
                label="Highlighter thickness"
                percent={highlighterThickness}
                color={getNotebookStrokePaintColor(highlighterColor, "highlighter")}
                previewWidth={widths.highlighter / 2}
                onChange={setHighlighterThickness}
              />
            </>
          ) : null}
          {openMenu === "eraser" ? (
            <ThicknessSlider
              label="Eraser size"
              percent={eraserThickness}
              color="var(--color-text-muted)"
              previewWidth={widths.eraser / 2}
              onChange={setEraserThickness}
            />
          ) : null}
        </div>
      ) : null}

      {saveProblem ? (
        <p className="border-b border-[var(--color-border)] bg-error/10 px-3 py-2 text-sm text-text-primary">
          {saveProblem}
        </p>
      ) : null}

      <div className="relative aspect-[9/12.4] min-h-[26rem] w-full bg-white">
        {loadFailed ? (
          <div className="absolute inset-0 grid place-items-center gap-3 p-6 text-center">
            <p className="text-sm text-text-secondary">
              Your saved working could not be opened. It has not been lost — nothing will be written
              over it until it loads.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setLoadFailed(false);
                setReloadKey((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : initialSvg !== null ? (
          <NotebookInkEditor
            ref={editorRef}
            activeTool={tool}
            eraserMode="precision"
            eraserThickness={widths.eraser}
            highlighterColor={highlighterColor}
            highlighterThickness={widths.highlighter}
            initialSvg={initialSvg}
            pageHeight={EXAM_WORKING_PAGE_HEIGHT}
            pageId={attemptId}
            pageWidth={EXAM_WORKING_PAGE_WIDTH}
            penColor={penColor}
            penSmoothing={penSmoothing}
            penThickness={widths.pen}
            readOnly={disabled}
            onChange={persist}
            onHistoryChange={(undo, redo) => {
              setHistory({ undo, redo });
              onInkChange?.(undo > 0);
            }}
            onInteractionChange={() => undefined}
            onPointerCancel={() => undefined}
            onPointerDown={() => undefined}
            onPointerMove={() => undefined}
            onPointerUp={() => undefined}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-text-muted">
            Opening your working sheet…
          </div>
        )}
      </div>
    </div>
  );
}
