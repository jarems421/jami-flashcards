"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  compactExamWorkingPages,
  EXAM_WORKING_MAX_PAGES,
  EXAM_WORKING_ZOOM_STEPS,
  examWorkingFitWidth,
  examWorkingHasInk,
  examWorkingStackLayout,
  examWorkingTouchIsPalm,
  type ExamScratchpadHandle,
} from "@/lib/practice/exam-working";
export type { ExamScratchpadHandle } from "@/lib/practice/exam-working";
import { NOTEBOOK_INK_UI_SYNC_IDLE_MS } from "@/lib/workspace/notebook-autosave";
import {
  NOTEBOOK_ERASER_THICKNESS_BY_SIZE,
  type NotebookEraserMode,
  type NotebookEraserSize,
} from "@/lib/workspace/notebook-eraser";
import {
  getHighlighterWidthFromPercent,
  getPenWidthFromPercent,
} from "@/lib/workspace/notebook-inking";
import {
  installNotebookStylusTouchListeners,
  installNotebookViewportZoomBlock,
  NOTEBOOK_EDITOR_LOCK_BODY_CLASS,
} from "@/lib/workspace/notebook-interaction-lock";
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

/*
 * How long the pen has to stay lifted before the sheet is written.
 *
 * This was a 700ms debounce on every change, and it was the main reason
 * writing lagged. The editor only starts preparing a snapshot of the page
 * after 600ms of stillness, and finishes it over several frames -- so at 700ms
 * there was usually none, and the save exported the whole page on the main
 * thread instead, freezing it in exactly the pause between two words. If the
 * pen was already down again the export refused, and the save wrote the
 * previous copy of every page to Firestore in the middle of the stroke anyway.
 *
 * Now nothing is written while the pen is down, the wait restarts every time
 * it lifts, and the page is read with the editor's own non-blocking export.
 */
const SAVE_IDLE_MS = 1_500;
/** A finger has to travel this far before it scrolls, so a resting hand does not. */
const PAN_START_DISTANCE = 8;
/** Matches the full-screen sheet's `p-4`. */
const EXPANDED_SHEET_PADDING = 16;

const zoomAt = (index: number) => EXAM_WORKING_ZOOM_STEPS[index] ?? 1;

/*
 * Memoised, with every callback below held stable, the way the notebook holds
 * its editor. The sheet re-rendered the editor on every one of its own renders
 * with fresh inline callbacks, so the ink surface was being reconciled while a
 * student was writing on it.
 */
const WorkingInkEditor = memo(NotebookInkEditor);

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

/*
 * No scrolling at all while a stroke is being drawn.
 *
 * The practice page scrolls, and a notebook does not. A hand resting on the
 * question, the answer box or the margin scrolled the page under the pen, and
 * a stroke whose page moves mid-line jumps or smears. Installed only for the
 * length of a stroke: a document-wide non-passive touch listener slows every
 * scroll on the page, and between strokes a finger has to be free to move it.
 */
function lockTouchScrolling() {
  const block = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
  };
  const options: AddEventListenerOptions = { capture: true, passive: false };
  document.addEventListener("touchmove", block, options);
  return () => document.removeEventListener("touchmove", block, options);
}

/** The element a finger drag on the sheet should move: the nearest scroller above it. */
function scrollableAncestor(element: HTMLElement | null): Element | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    const scrolls = /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`);
    if (scrolls && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
      return node;
    }
  }
  return document.scrollingElement;
}

type FingerPan = {
  pointerId: number;
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  panning: boolean;
  target: Element | null;
};

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
function ExamScratchpad({
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const inkInteractionActiveRef = useRef(false);
  const releaseTouchLockRef = useRef<(() => void) | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uiSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ink on the sheet that the stored copy does not have yet. */
  const dirtyRef = useRef(false);
  const latestHistoryRef = useRef({ undo: 0, redo: 0 });
  /** The latest markup of every page; the open page is read from the editor. */
  const pagesRef = useRef<string[]>([]);
  /**
   * Whether each stored page has ink, worked out when the pages change.
   *
   * It used to be recomputed after every stroke by running the ink check over
   * every other page's markup -- a regex pass over up to hundreds of kilobytes,
   * fired dozens of times a line.
   */
  const pageInkRef = useRef<boolean[]>([]);
  const pageIndexRef = useRef(0);
  const loadedRef = useRef(false);
  const panRef = useRef<FingerPan | null>(null);
  const flushOnLeaveRef = useRef<() => void>(() => undefined);
  /** What each page opens with. Refreshed whenever the open page changes. */
  const [pageSvgs, setPageSvgs] = useState<string[] | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  /** Remounts the editor when the open page's content changes underneath it. */
  const [pageMount, setPageMount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveProblem, setSaveProblem] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmRequest>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [fitWidth, setFitWidth] = useState(0);

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

  const setPages = useCallback((pages: string[]) => {
    pagesRef.current = pages;
    pageInkRef.current = pages.map((page) => examWorkingHasInk(page));
  }, []);

  useEffect(() => {
    let active = true;
    loadedRef.current = false;
    void loadExamScratchpad(userId, attemptId)
      .then((pages) => {
        if (!active) return;
        const loaded = pages.length > 0 ? pages : [""];
        setPages(loaded);
        pageIndexRef.current = 0;
        loadedRef.current = true;
        setPageIndex(0);
        setPageSvgs(loaded);
        onInkChange?.(pageInkRef.current.some(Boolean));
      })
      // An empty sheet after a failed read is not an empty sheet: writing to it
      // would replace working that is still there. Offer a retry instead.
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [attemptId, onInkChange, reloadKey, setPages, userId]);

  /** Every page as it stands now, read at once. For page turns and leaving only. */
  const collectPages = useCallback(() => {
    const pages = [...pagesRef.current];
    const editor = editorRef.current;
    if (editor) {
      const current = editor.serializeWarm() ?? editor.serialize();
      if (current != null) pages[pageIndexRef.current] = current;
    }
    setPages(pages);
    return pages;
  }, [setPages]);

  const writePages = useCallback(
    async (pages: readonly string[]) => {
      /*
       * The label follows what is on the pages, not the undo stack. Drawing a
       * stroke and erasing it leaves history behind and no ink, and the sheet
       * would still have claimed it was being sent with the answer.
       */
      onInkChange?.(pageInkRef.current.some(Boolean));
      try {
        await saveExamScratchpad(userId, attemptId, compactExamWorkingPages(pages));
        if (mountedRef.current) setSaveProblem("");
        return true;
      } catch (error) {
        if (mountedRef.current) {
          setSaveProblem(
            error instanceof ExamScratchpadTooLargeError
              ? "These pages are too detailed to save. Your last saved working is safe — erase some of it, or submit what you have."
              : "Your working could not be saved just now. It is still on the page."
          );
        }
        return false;
      }
    },
    [attemptId, onInkChange, userId]
  );

  /** Writes the sheet once the pen has been still, without blocking the page to read it. */
  const saveWhenStill = useCallback(async () => {
    if (!mountedRef.current || disabled || !loadedRef.current || !dirtyRef.current) return;
    const editor = editorRef.current;
    if (!editor || inkInteractionActiveRef.current) return;
    const index = pageIndexRef.current;
    const current = await editor.serializeAsync();
    /*
     * The pen came down, the page turned or the editor was replaced while the
     * page was being read: that copy is already out of date. Whatever changed
     * schedules its own save, so nothing is written here.
     */
    if (current == null || editor !== editorRef.current || index !== pageIndexRef.current) return;
    const pages = [...pagesRef.current];
    pages[index] = current;
    setPages(pages);
    dirtyRef.current = false;
    if (!(await writePages(pages))) dirtyRef.current = true;
  }, [disabled, setPages, writePages]);

  const scheduleSave = useCallback(() => {
    // Once the answer is frozen the sheet is evidence rather than a draft, and
    // the security rules refuse the write — so it is not attempted.
    if (disabled) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void saveWhenStill();
    }, SAVE_IDLE_MS);
  }, [disabled, saveWhenStill]);

  const writeNow = useCallback(() => {
    if (disabled || !loadedRef.current || !dirtyRef.current) return;
    const pages = collectPages();
    dirtyRef.current = false;
    void writePages(pages);
  }, [collectPages, disabled, writePages]);

  useEffect(() => {
    flushOnLeaveRef.current = writeNow;
  }, [writeNow]);

  /*
   * Leaving flushes the sheet rather than cancelling it, for the same reason
   * the typed draft does: the last stroke is the one most worth keeping.
   *
   * A layout effect, so it runs before the editor underneath is detached: a
   * passive cleanup ran after it, found no editor, and could only save the copy
   * from the last pause.
   */
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (uiSyncTimer.current) {
        clearTimeout(uiSyncTimer.current);
        uiSyncTimer.current = null;
      }
      releaseTouchLockRef.current?.();
      releaseTouchLockRef.current = null;
      flushOnLeaveRef.current();
    };
  }, []);

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
            setPages(pages);
            return pages;
          },
          save: async (pages) => {
            await saveExamScratchpad(userId, attemptId, compactExamWorkingPages(pages));
            dirtyRef.current = false;
          },
          rasterize: pagesToPng,
        }),
    };
    onHandle(handle);
    return () => onHandle(null);
  }, [attemptId, onHandle, setPages, userId]);

  /*
   * The notebook's Pencil guard.
   *
   * iPadOS Safari reads Apple Pencil movement as a native scroll or back
   * gesture even under `touch-action: none`: it cancels the stroke part way
   * and then needs a frame to settle before it delivers the next one. It
   * cancels the touch default only for Pencil contact or while ink is being
   * drawn, so taps on controls stay native.
   */
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    return installNotebookStylusTouchListeners({
      surface,
      getInkInteractionActive: () => inkInteractionActiveRef.current,
    });
  }, []);

  /*
   * Toolbar state, a moment after the pen lifts.
   *
   * Every stroke used to set the undo state straight away, re-rendering the
   * toolbar and its settings between two strokes of the same word -- and
   * handwriting is dozens of strokes a line. The notebook commits the same
   * state 200ms after the pen lifts and cancels it when the pen comes back
   * down; this does the same.
   */
  const flushUiSync = useCallback(() => {
    uiSyncTimer.current = null;
    if (!mountedRef.current) return;
    const { undo, redo } = latestHistoryRef.current;
    setHistory((current) =>
      current.undo === undo && current.redo === redo ? current : { undo, redo }
    );
    const otherPagesHaveInk = pageInkRef.current.some(
      (hasInk, index) => hasInk && index !== pageIndexRef.current
    );
    onInkChange?.(undo > 0 || otherPagesHaveInk);
  }, [onInkChange]);

  const scheduleUiSync = useCallback(() => {
    if (uiSyncTimer.current) clearTimeout(uiSyncTimer.current);
    uiSyncTimer.current = setTimeout(flushUiSync, NOTEBOOK_INK_UI_SYNC_IDLE_MS);
  }, [flushUiSync]);

  const handleHistoryChange = useCallback(
    (undo: number, redo: number) => {
      latestHistoryRef.current = { undo, redo };
      if (!inkInteractionActiveRef.current) scheduleUiSync();
    },
    [scheduleUiSync]
  );

  const handleInkChange = useCallback(() => {
    if (disabled) return;
    dirtyRef.current = true;
    if (!inkInteractionActiveRef.current) scheduleSave();
  }, [disabled, scheduleSave]);

  const handleInteractionChange = useCallback(
    (active: boolean) => {
      inkInteractionActiveRef.current = active;
      if (active) {
        // Nothing waits to run in the middle of a stroke.
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        if (uiSyncTimer.current) {
          clearTimeout(uiSyncTimer.current);
          uiSyncTimer.current = null;
        }
        panRef.current = null;
        releaseTouchLockRef.current ??= lockTouchScrolling();
        return;
      }
      releaseTouchLockRef.current?.();
      releaseTouchLockRef.current = null;
      if (!mountedRef.current) return;
      if (dirtyRef.current) scheduleSave();
      scheduleUiSync();
    },
    [scheduleSave, scheduleUiSync]
  );

  /*
   * A finger drag on the sheet scrolls, as it does anywhere else on the page.
   *
   * The sheet refuses native panning so the Pencil can write, and fingers were
   * ignored on it -- so a page taller than the screen could only be moved by
   * finding a margin. Contacts the size of a hand are left alone, a drag has to
   * travel before it moves anything, and the moment the pen comes down any
   * drag in progress stops.
   */
  const handleTouchDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || inkInteractionActiveRef.current || panRef.current) return;
    if (examWorkingTouchIsPalm(event)) return;
    panRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      panning: false,
      target: scrollableAncestor(event.currentTarget),
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the drag still works while the finger stays on the sheet.
    }
  }, []);

  const handleTouchMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (inkInteractionActiveRef.current) {
      panRef.current = null;
      return;
    }
    if (!pan.panning) {
      const travelled = Math.hypot(event.clientX - pan.originX, event.clientY - pan.originY);
      if (travelled < PAN_START_DISTANCE) return;
      pan.panning = true;
    }
    pan.target?.scrollBy({ left: pan.lastX - event.clientX, top: pan.lastY - event.clientY });
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
  }, []);

  const handleTouchEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  }, []);

  /*
   * Writing full screen, the way a notebook page is written on.
   *
   * Beside the question the sheet is half a screen wide on a tablet or laptop,
   * so the page is drawn at under half its size with nothing to zoom. Full
   * screen it is fitted to the screen, can be zoomed, and takes the notebook's
   * own lock: the page behind stops scrolling, the navigation goes, and the
   * animated background stops competing with the ink for frames.
   *
   * It is the same element fixed over the page rather than a copy in a portal,
   * so the editor is not rebuilt and the undo history survives.
   */
  useEffect(() => {
    if (!expanded) return;
    document.body.classList.add(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);
    const releaseZoom = installNotebookViewportZoomBlock(document);
    // Captured first, so Escape closes this before the sheet the page opened it in.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setExpanded(false);
    };
    document.addEventListener("keydown", closeOnEscape, true);
    const frame = window.requestAnimationFrame(() =>
      rootRef.current?.focus({ preventScroll: true })
    );
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);
      releaseZoom();
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    // The observer reports the starting size too, so this is the only measurement.
    const observer = new ResizeObserver(() => {
      setFitWidth(
        examWorkingFitWidth({
          containerWidth: container.clientWidth,
          containerHeight: container.clientHeight,
          pageWidth: EXAM_WORKING_PAGE_WIDTH,
          pageHeight: EXAM_WORKING_PAGE_HEIGHT,
          padding: EXPANDED_SHEET_PADDING,
        })
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [expanded]);

  /** Zooms about the middle of what is on screen, so the writing stays in view. */
  const changeZoom = (nextIndex: number) => {
    const bounded = Math.min(EXAM_WORKING_ZOOM_STEPS.length - 1, Math.max(0, nextIndex));
    if (bounded === zoomIndex) return;
    const container = scrollRef.current;
    if (container) {
      const ratio = zoomAt(bounded) / zoomAt(zoomIndex);
      const centreX = container.scrollLeft + container.clientWidth / 2;
      const centreY = container.scrollTop + container.clientHeight / 2;
      window.requestAnimationFrame(() => {
        container.scrollLeft = centreX * ratio - container.clientWidth / 2;
        container.scrollTop = centreY * ratio - container.clientHeight / 2;
      });
    }
    setZoomIndex(bounded);
  };

  /** Opens a page, keeping what is on the one being left. */
  const showPage = useCallback(
    (pages: string[], nextIndex: number) => {
      setPages(pages);
      pageIndexRef.current = nextIndex;
      latestHistoryRef.current = { undo: 0, redo: 0 };
      setPageSvgs(pages);
      setPageIndex(nextIndex);
      setPageMount((value) => value + 1);
      setHistory({ undo: 0, redo: 0 });
      setOpenMenu(null);
    },
    [setPages]
  );

  const markChanged = () => {
    if (disabled) return;
    dirtyRef.current = true;
    scheduleSave();
  };

  const goToPage = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= pageCount || nextIndex === pageIndexRef.current) return;
    showPage(collectPages(), nextIndex);
    markChanged();
  };

  const addPage = () => {
    if (disabled || pageCount >= EXAM_WORKING_MAX_PAGES) return;
    const pages = [...collectPages(), ""];
    showPage(pages, pages.length - 1);
    markChanged();
  };

  const deletePage = () => {
    if (disabled || pageCount <= 1) return;
    const pages = collectPages().filter((_page, index) => index !== pageIndexRef.current);
    showPage(pages, Math.min(pageIndexRef.current, pages.length - 1));
    markChanged();
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

  const openedPageHasInk = useMemo(
    () => examWorkingHasInk(pageSvgs?.[pageIndex] ?? ""),
    [pageIndex, pageSvgs]
  );
  const currentPageHasInk = history.undo > 0 || openedPageHasInk;
  const zoom = zoomAt(zoomIndex);

  return (
    <div
      ref={rootRef}
      tabIndex={expanded ? -1 : undefined}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? "Your working, full screen" : undefined}
      className={
        expanded
          ? "fixed inset-0 z-[70] flex flex-col bg-[var(--app-background)] outline-none"
          : embedded
            ? "relative"
            : "relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-shell"
      }
    >
      <div
        role="toolbar"
        aria-label="Working tools"
        className={`flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-glass-subtle)] py-1.5 ${
          expanded
            ? "px-3 pt-[max(0.375rem,env(safe-area-inset-top))]"
            : embedded
              ? "px-3"
              : "px-2"
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
          <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-[var(--color-border)]" />
          {expanded ? (
            <div
              role="group"
              aria-label="Zoom"
              className="flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-0.5"
            >
              <ToolbarIconButton
                label="Zoom out"
                icon="minus"
                disabled={zoomIndex === 0}
                onClick={() => changeZoom(zoomIndex - 1)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Fit the page to the screen"
                title="Fit the page to the screen"
                className="min-w-[3.5rem] tabular-nums"
                onClick={() => changeZoom(0)}
              >
                {zoomIndex === 0 ? "Fit" : `${Math.round(zoom * 100)}%`}
              </Button>
              <ToolbarIconButton
                label="Zoom in"
                icon="plus"
                disabled={zoomIndex === EXAM_WORKING_ZOOM_STEPS.length - 1}
                onClick={() => changeZoom(zoomIndex + 1)}
              />
            </div>
          ) : null}
          <ToolbarIconButton
            label={expanded ? "Close full screen" : "Write full screen"}
            icon={expanded ? "close" : "expand"}
            active={expanded}
            onClick={() => setExpanded((value) => !value)}
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
        <p className="shrink-0 border-b border-[var(--color-border)] bg-error/10 px-3 py-2 text-sm text-text-primary">
          {saveProblem}
        </p>
      ) : null}

      {/*
        * Always these three elements, whether or not the sheet is full screen,
        * so switching mode restyles them rather than rebuilding the editor.
        */}
      <div
        ref={scrollRef}
        className={
          expanded
            ? "min-h-0 flex-1 overflow-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            : undefined
        }
      >
        <div
          className={expanded ? "mx-auto shadow-shell" : undefined}
          style={expanded && fitWidth > 0 ? { width: Math.round(fitWidth * zoom) } : undefined}
        >
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
                onChange={handleInkChange}
                onHistoryChange={handleHistoryChange}
                onInteractionChange={handleInteractionChange}
                onPointerCancel={handleTouchEnd}
                onPointerDown={handleTouchDown}
                onPointerMove={handleTouchMove}
                onPointerUp={handleTouchEnd}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-text-muted">
                Opening your working…
              </div>
            )}
          </div>
        </div>
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

/*
 * Memoised so the session around it -- its polling, its save indicator, the
 * answer beside it -- does not re-render the sheet while a student writes.
 */
export default memo(ExamScratchpad);
