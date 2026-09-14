"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/components/ui";
import type { NotebookToolMenu } from "@/components/workspace/NotebookDrawingToolbar";
import NotebookToolSettingsPopover from "@/components/workspace/NotebookToolSettingsPopover";
import ToolbarIconButton from "@/components/workspace/NotebookToolbarIconButton";
import {
  NotebookInkEditor,
  type NotebookInkEditorHandle,
} from "@/components/workspace/NotebookInkEditor";
import {
  captureExamWorking,
  EXAM_WORKING_MAX_PAGES,
  examWorkingHasInk,
  examWorkingStackLayout,
  type ExamScratchpadHandle,
} from "@/lib/practice/exam-working";
export type { ExamScratchpadHandle } from "@/lib/practice/exam-working";
import {
  NOTEBOOK_ERASER_THICKNESS_BY_SIZE,
  type NotebookEraserMode,
  type NotebookEraserSize,
} from "@/lib/workspace/notebook-eraser";
import {
  getHighlighterWidthFromPercent,
  getPenWidthFromPercent,
} from "@/lib/workspace/notebook-inking";
import { installNotebookStylusTouchListeners } from "@/lib/workspace/notebook-interaction-lock";
import { getNotebookStrokePaintColor } from "@/lib/workspace/notebook-page-content";
import {
  readNotebookPenSmoothingPreference,
  saveNotebookPenSmoothingPreference,
} from "@/lib/workspace/notebook-pen-feel";
import {
  readNotebookScribbleErasePreference,
  saveNotebookScribbleErasePreference,
} from "@/lib/workspace/notebook-toolbar";
import type { NotebookStrokeColor } from "@/lib/workspace/notebooks";
import {
  ExamScratchpadTooLargeError,
  loadExamScratchpad,
  saveExamScratchpad,
} from "@/services/study/exam-practice";

/** The sheet's own page units, and the size each page is snapshotted at. */
export const EXAM_WORKING_PAGE_WIDTH = 900;
export const EXAM_WORKING_PAGE_HEIGHT = 1_240;
const SNAPSHOT_WIDTH = 1_200;
const SNAPSHOT_HEIGHT = Math.round(
  (SNAPSHOT_WIDTH * EXAM_WORKING_PAGE_HEIGHT) / EXAM_WORKING_PAGE_WIDTH
);
/** The band between stacked pages in the submitted image, at snapshot size. */
const SNAPSHOT_PAGE_GAP = 24;
const SAVE_DEBOUNCE_MS = 700;

/*
 * Memoised, with every callback below held stable, the way the notebook holds
 * its editor. The sheet re-rendered the editor on every one of its own renders
 * with fresh inline callbacks, so the ink surface was being reconciled while a
 * student was writing on it.
 */
const WorkingInkEditor = memo(NotebookInkEditor);
const ignorePointer = () => undefined;

function loadSvgImage(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = new Image();
  image.src = url;
  return image
    .decode()
    .then(() => image)
    .finally(() => URL.revokeObjectURL(url));
}

/**
 * Every inked page, stacked into the one image the marker reads.
 *
 * A marker reads ink on paper, so the pages are flattened onto white rather
 * than sent as transparent overlays whose ground it would have to guess, and a
 * grey band between them keeps each page its own.
 */
async function pagesToPng(pages: readonly string[]) {
  if (pages.length === 0) return undefined;
  try {
    const layout = examWorkingStackLayout({
      pageCount: pages.length,
      pageWidth: SNAPSHOT_WIDTH,
      pageHeight: SNAPSHOT_HEIGHT,
      gap: SNAPSHOT_PAGE_GAP,
    });
    const images = await Promise.all(pages.map(loadSvgImage));
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#e5e7eb";
    context.fillRect(0, 0, layout.width, layout.height);
    images.forEach((image, index) => {
      const top = layout.offsets[index] ?? 0;
      context.fillStyle = "#ffffff";
      context.fillRect(0, top, layout.width, layout.pageHeight);
      context.drawImage(image, 0, top, layout.width, layout.pageHeight);
    });
    return {
      mimeType: "image/png" as const,
      dataBase64: canvas.toDataURL("image/png").split(",")[1],
      width: layout.width,
      height: layout.height,
    };
  } catch {
    // Failure blocks submission; never silently mark the typed answer alone.
    return undefined;
  }
}

type ConfirmRequest = "clear-page" | "delete-page" | null;

/** A sheet of working has no text layer, so these are its only tools. */
type WorkingTool = "pen" | "highlighter" | "eraser";

/**
 * The pages of working for one attempt.
 *
 * It is the notebook's ink editor with the notebook's tools and settings,
 * deliberately: a student who has learned to write in Jami should not meet a
 * different, worse pen the moment the work is being marked. Pen feel and
 * scribble-to-erase are read from the same saved preferences, so a hand tuned
 * once stays tuned here.
 *
 * What it is not is a notebook page. There is no text layer and no images:
 * the typed answer sits above the sheet, and what is sent for marking is the
 * ink on these pages and nothing else.
 */
export default function ExamScratchpad({
  userId,
  attemptId,
  disabled = false,
  embedded = false,
  onHandle,
  onInkChange,
}: {
  userId: string;
  attemptId: string;
  disabled?: boolean;
  /** Drawn flush inside a surrounding sheet, without a frame of its own. */
  embedded?: boolean;
  onHandle(handle: ExamScratchpadHandle | null): void;
  onInkChange?(hasInk: boolean): void;
}) {
  const editorRef = useRef<NotebookInkEditorHandle | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const inkInteractionActiveRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The latest markup of every page; the open page is read from the editor. */
  const pagesRef = useRef<string[]>([]);
  const pageIndexRef = useRef(0);
  const loadedRef = useRef(false);
  /** What each page opens with. Refreshed whenever the open page changes. */
  const [pageSvgs, setPageSvgs] = useState<string[] | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  /** Remounts the editor when the open page's content changes underneath it. */
  const [pageMount, setPageMount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveProblem, setSaveProblem] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmRequest>(null);

  const [tool, setTool] = useState<WorkingTool>("pen");
  const [openMenu, setOpenMenu] = useState<NotebookToolMenu>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [penColor, setPenColor] = useState<NotebookStrokeColor>("black");
  const [penThicknessPercent, setPenThicknessPercent] = useState(50);
  // Read once, lazily: the saved preferences are this sheet's starting values,
  // and nothing on the first paint depends on them.
  const [penSmoothingPercent, setPenSmoothingPercent] = useState(
    readNotebookPenSmoothingPreference
  );
  const [scribbleToErase, setScribbleToErase] = useState(
    readNotebookScribbleErasePreference
  );
  const [highlighterColor, setHighlighterColor] = useState<NotebookStrokeColor>("yellow");
  const [highlighterThicknessPercent, setHighlighterThicknessPercent] = useState(50);
  const [eraserMode, setEraserMode] = useState<NotebookEraserMode>("precision");
  const [eraserSize, setEraserSize] = useState<NotebookEraserSize>("medium");

  const pageCount = pageSvgs?.length ?? 1;

  useEffect(() => {
    let active = true;
    loadedRef.current = false;
    void loadExamScratchpad(userId, attemptId)
      .then((pages) => {
        if (!active) return;
        const loaded = pages.length > 0 ? pages : [""];
        pagesRef.current = loaded;
        pageIndexRef.current = 0;
        loadedRef.current = true;
        setPageIndex(0);
        setPageSvgs(loaded);
        onInkChange?.(loaded.some((page) => examWorkingHasInk(page)));
      })
      // An empty sheet after a failed read is not an empty sheet: writing to it
      // would replace working that is still there. Offer a retry instead.
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [attemptId, onInkChange, reloadKey, userId]);

  /** Every page as it stands now, with the open page read from the editor. */
  const collectPages = useCallback(() => {
    const pages = [...pagesRef.current];
    const editor = editorRef.current;
    if (editor) {
      const current = editor.serializeWarm() ?? editor.serialize();
      if (current != null) pages[pageIndexRef.current] = current;
    }
    pagesRef.current = pages;
    return pages;
  }, []);

  const writeSheet = useCallback(async () => {
    if (disabled || !loadedRef.current) return true;
    const pages = collectPages();
    /*
     * The label follows what is on the pages, not the undo stack. Drawing a
     * stroke and erasing it leaves history behind and no ink, and the sheet
     * would still have claimed it was being sent with the answer.
     */
    onInkChange?.(pages.some((page) => examWorkingHasInk(page)));
    try {
      await saveExamScratchpad(userId, attemptId, pages);
      setSaveProblem("");
      return true;
    } catch (error) {
      setSaveProblem(
        error instanceof ExamScratchpadTooLargeError
          ? "These pages are too detailed to save. Your last saved working is safe — erase some of it, or submit what you have."
          : "Your working could not be saved just now. It is still on the page."
      );
      return false;
    }
  }, [attemptId, collectPages, disabled, onInkChange, userId]);

  const persist = useCallback(() => {
    // Once the answer is frozen the sheet is evidence rather than a draft, and
    // the security rules refuse the write — so it is not attempted.
    if (disabled) return;
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
      attemptId,
      snapshot: () =>
        captureExamWorking({
          serialize: async () => {
            const editor = editorRef.current;
            if (!loadedRef.current || !editor) return null;
            const current = await editor.serializeAsync();
            if (current == null) return null;
            const pages = [...pagesRef.current];
            pages[pageIndexRef.current] = current;
            pagesRef.current = pages;
            return pages;
          },
          save: (pages) => saveExamScratchpad(userId, attemptId, pages),
          rasterize: pagesToPng,
        }),
    };
    onHandle(handle);
    return () => onHandle(null);
  }, [attemptId, onHandle, userId]);

  /*
   * The notebook's Pencil guard, which this sheet never had.
   *
   * iPadOS Safari reads Apple Pencil movement as a native scroll or back
   * gesture even under `touch-action: none`: it cancels the stroke part way
   * and then needs a frame to settle before it delivers the next one. On the
   * notebook the page cannot scroll and this guard is installed; here the page
   * scrolls and it was not, which is what made writing break up and lag. It
   * cancels the touch default only for Pencil contact or while ink is being
   * drawn, so a finger still scrolls the page and taps on controls stay native.
   */
  const handleInteractionChange = useCallback((active: boolean) => {
    inkInteractionActiveRef.current = active;
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    return installNotebookStylusTouchListeners({
      surface,
      getInkInteractionActive: () => inkInteractionActiveRef.current,
    });
  }, []);

  const handleHistoryChange = useCallback(
    (undo: number, redo: number) => {
      setHistory({ undo, redo });
      const otherPagesHaveInk = pagesRef.current.some(
        (page, index) => index !== pageIndexRef.current && examWorkingHasInk(page)
      );
      onInkChange?.(undo > 0 || otherPagesHaveInk);
    },
    [onInkChange]
  );

  /** Opens a page, keeping what is on the one being left. */
  const showPage = useCallback(
    (pages: string[], nextIndex: number) => {
      pagesRef.current = pages;
      pageIndexRef.current = nextIndex;
      setPageSvgs(pages);
      setPageIndex(nextIndex);
      setPageMount((value) => value + 1);
      setHistory({ undo: 0, redo: 0 });
      setOpenMenu(null);
    },
    []
  );

  const goToPage = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= pageCount || nextIndex === pageIndexRef.current) return;
    showPage(collectPages(), nextIndex);
    persist();
  };

  const addPage = () => {
    if (disabled || pageCount >= EXAM_WORKING_MAX_PAGES) return;
    const pages = [...collectPages(), ""];
    showPage(pages, pages.length - 1);
    persist();
  };

  const deletePage = () => {
    if (disabled || pageCount <= 1) return;
    const pages = collectPages().filter((_page, index) => index !== pageIndexRef.current);
    showPage(pages, Math.min(pageIndexRef.current, pages.length - 1));
    persist();
  };

  /** Pressing the active tool opens its options; pressing another switches. */
  const selectTool = (next: WorkingTool) => {
    if (tool === next) {
      setOpenMenu((current) => (current === next ? null : next));
      return;
    }
    setTool(next);
    setOpenMenu(null);
  };

  const widths = useMemo(
    () => ({
      pen: getPenWidthFromPercent(penThicknessPercent),
      highlighter: getHighlighterWidthFromPercent(highlighterThicknessPercent),
      eraser: NOTEBOOK_ERASER_THICKNESS_BY_SIZE[eraserSize],
    }),
    [eraserSize, highlighterThicknessPercent, penThicknessPercent]
  );

  const currentPageHasInk =
    history.undo > 0 || examWorkingHasInk(pageSvgs?.[pageIndex] ?? "");

  return (
    <div
      className={
        embedded
          ? "relative"
          : "relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-shell"
      }
    >
      <div
        role="toolbar"
        aria-label="Working tools"
        className={`flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-glass-subtle)] py-1.5 ${
          embedded ? "px-3" : "px-2"
        }`}
      >
        {(["pen", "highlighter", "eraser"] as const).map((item) => (
          <div key={item} className="relative shrink-0">
            <ToolbarIconButton
              label={item === "pen" ? "Pen" : item === "highlighter" ? "Highlighter" : "Eraser"}
              icon={item}
              active={tool === item || openMenu === item}
              disabled={disabled}
              expanded={openMenu === item}
              controls="notebook-tool-settings"
              onClick={() => selectTool(item)}
            >
              {item !== "eraser" ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-[0.35rem] left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full"
                  style={{
                    backgroundColor: getNotebookStrokePaintColor(
                      item === "pen" ? penColor : highlighterColor,
                      item
                    ),
                  }}
                />
              ) : null}
            </ToolbarIconButton>
          </div>
        ))}
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-[var(--color-border)]" />
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

        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          <ToolbarIconButton
            label="Previous page"
            icon="back"
            disabled={pageIndex === 0}
            onClick={() => goToPage(pageIndex - 1)}
          />
          <span
            aria-live="polite"
            className="min-w-[3.25rem] text-center text-xs font-semibold tabular-nums text-text-secondary"
          >
            {pageIndex + 1} / {pageCount}
          </span>
          <ToolbarIconButton
            label="Next page"
            icon="forward"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => goToPage(pageIndex + 1)}
          />
          <ToolbarIconButton
            label={
              pageCount >= EXAM_WORKING_MAX_PAGES
                ? `Up to ${EXAM_WORKING_MAX_PAGES} pages`
                : "Add a page"
            }
            icon="plus"
            disabled={disabled || pageCount >= EXAM_WORKING_MAX_PAGES}
            onClick={addPage}
          />
          <ToolbarIconButton
            label="Delete this page"
            icon="trash"
            disabled={disabled || pageCount <= 1}
            onClick={() => (currentPageHasInk ? setConfirm("delete-page") : deletePage())}
          />
        </div>
      </div>

      <NotebookToolSettingsPopover
        dock="top"
        openMenu={disabled ? null : openMenu}
        pen={{
          color: penColor,
          thicknessPercent: penThicknessPercent,
          onColorChange: setPenColor,
          onThicknessChange: setPenThicknessPercent,
          smoothingPercent: penSmoothingPercent,
          onSmoothingChange: (percent) => {
            setPenSmoothingPercent(percent);
            saveNotebookPenSmoothingPreference(percent);
          },
          scribbleToErase,
          onScribbleToEraseChange: (enabled) => {
            setScribbleToErase(enabled);
            saveNotebookScribbleErasePreference(enabled);
          },
        }}
        highlighter={{
          color: highlighterColor,
          thicknessPercent: highlighterThicknessPercent,
          onColorChange: setHighlighterColor,
          onThicknessChange: setHighlighterThicknessPercent,
        }}
        eraser={{
          mode: eraserMode,
          size: eraserSize,
          onModeChange: setEraserMode,
          onSizeChange: setEraserSize,
          canClearPage: !disabled && currentPageHasInk,
          onClearPage: () => {
            setOpenMenu(null);
            setConfirm("clear-page");
          },
        }}
      />

      {saveProblem ? (
        <p className="border-b border-[var(--color-border)] bg-error/10 px-3 py-2 text-sm text-text-primary">
          {saveProblem}
        </p>
      ) : null}

      {/*
        * `notebook-page-surface` is the notebook sheet's own ground rules: no
        * text selection, callout or drag, no overscroll, no native pan. Paint
        * containment keeps every ink frame's repaint inside the page instead
        * of invalidating the scrolling page around it.
        */}
      <div
        ref={surfaceRef}
        className="notebook-page-surface relative w-full bg-white [contain:layout_paint]"
        style={{ aspectRatio: `${EXAM_WORKING_PAGE_WIDTH} / ${EXAM_WORKING_PAGE_HEIGHT}` }}
      >
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
        ) : pageSvgs !== null ? (
          <WorkingInkEditor
            key={`${attemptId}:${pageMount}`}
            ref={editorRef}
            activeTool={tool}
            eraserMode={eraserMode}
            eraserThickness={widths.eraser}
            highlighterColor={highlighterColor}
            highlighterThickness={widths.highlighter}
            initialSvg={pageSvgs[pageIndex] ?? ""}
            pageHeight={EXAM_WORKING_PAGE_HEIGHT}
            pageId={`${attemptId}:${pageIndex}`}
            pageWidth={EXAM_WORKING_PAGE_WIDTH}
            penColor={penColor}
            penSmoothing={penSmoothingPercent}
            penThickness={widths.pen}
            readOnly={disabled}
            scribbleToErase={scribbleToErase}
            onChange={persist}
            onHistoryChange={handleHistoryChange}
            onInteractionChange={handleInteractionChange}
            onPointerCancel={ignorePointer}
            onPointerDown={ignorePointer}
            onPointerMove={ignorePointer}
            onPointerUp={ignorePointer}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-text-muted">
            Opening your working…
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "delete-page" ? "Delete this page?" : "Clear this page?"}
        description={
          confirm === "delete-page"
            ? "Everything written on this page of working is removed."
            : "Everything written on this page is removed. You can undo it straight after."
        }
        confirmLabel={confirm === "delete-page" ? "Delete page" : "Clear page"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === "delete-page") deletePage();
          else editorRef.current?.clear();
          setConfirm(null);
        }}
      />
    </div>
  );
}
