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

/** The notebook's floating pill, so the working sheet wears the same control. */
const PILL_CLASS =
  "notebook-floating-control flex items-center gap-1 rounded-full border border-[var(--color-border)] p-1.5";
import {
  NotebookInkEditor,
  type NotebookInkEditorHandle,
} from "@/components/workspace/NotebookInkEditor";
import {
  captureExamWorking,
  compactExamWorkingPages,
  EXAM_WORKING_ZOOM_STEPS,
  examWorkingFitWidth,
  examWorkingHasInk,
  examWorkingSheetLayout,
  examWorkingTouchIsPalm,
  type ExamScratchpadHandle,
  type ExamWorkingInkedPage,
} from "@/lib/practice/exam-working";
import {
  EXAM_SHEET_A4_PAGE_HEIGHT,
  EXAM_SHEET_PAGE_WIDTH,
  examSheetContinuationRoom,
  examSheetOpeningContinuations,
  examSheetPageCaption,
  examSheetPages,
  type ExamSheetPage,
} from "@/lib/practice/exam-question-sheet";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import ExamSheetPageBackground from "@/components/practice/ExamSheetPageBackground";
import NotebookPageDefaultsPicker from "@/components/workspace/NotebookPageDefaultsPicker";
import {
  examSheetPageGround,
  readExamSheetPaperPreference,
  saveExamSheetPaperPreference,
  type ExamSheetPaper,
} from "@/lib/practice/exam-sheet-paper";
export type { ExamScratchpadHandle } from "@/lib/practice/exam-working";
import { NOTEBOOK_INK_UI_SYNC_IDLE_MS } from "@/lib/workspace/notebook-autosave";
import {
  NOTEBOOK_ERASER_THICKNESS_BY_SIZE,
  type NotebookEraserMode,
  type NotebookEraserSize,
} from "@/lib/workspace/notebook-eraser";
import {
  getHighlighterWidthFromPercent,
  getNotebookCreatePagePull,
  getNotebookPageDragIntent,
  getNotebookSwipeDragOffset,
  getNotebookSwipeReleaseDecision,
  getNotebookSwipeSettleDuration,
  getNotebookSwipeVelocity,
  getPenWidthFromPercent,
  shouldCreateNotebookPageOnRelease,
  shouldPointerSwipePages,
  NOTEBOOK_PAGE_SWIPE_VELOCITY_WINDOW_MS,
  type NotebookSwipeSample,
} from "@/lib/workspace/notebook-inking";
import {
  installNotebookStylusTouchListeners,
  installNotebookViewportZoomBlock,
  NOTEBOOK_EDITOR_LOCK_BODY_CLASS,
} from "@/lib/workspace/notebook-interaction-lock";
import { getNotebookInkRenderWindow } from "@/lib/workspace/notebook-ink-window";
import { getNotebookStrokePaintColor } from "@/lib/workspace/notebook-page-content";
import {
  clampNotebookPenSettings,
  readNotebookPenSettings,
  saveNotebookPenSettings,
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

/**
 * The page a sheet falls back to when the question has no printed paper.
 *
 * A question Jami wrote has no crop to write on, so its sheet is blank pages
 * at the shape of the paper every board prints on.
 */
const BLANK_PAGE: ExamSheetPage = {
  kind: "continuation",
  number: 1,
  width: EXAM_SHEET_PAGE_WIDTH,
  height: EXAM_SHEET_A4_PAGE_HEIGHT,
};
/** The band between pages in the submitted image, in the sheet's own units. */
const SNAPSHOT_PAGE_GAP = 28;
/** The strip above each page in that image, which says what the page is. */
const SNAPSHOT_CAPTION_HEIGHT = 48;
const SNAPSHOT_CAPTION_FONT = 26;

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
 * Every inked page, laid into the one image the marker reads.
 *
 * A marker reads ink on paper, so the pages are flattened onto white rather
 * than sent as transparent overlays whose ground it would have to guess.
 *
 * What is not flattened in is the paper. A student now writes on the board's
 * own page, and burning that page into the submission would put licensed
 * question material inside a student's own stored evidence, and hand the
 * marker one image in which the printing and the handwriting are the same
 * kind of mark. The question is already sent separately, and labelled as
 * question material; this stays the student's side of it.
 *
 * So each page is captioned instead. "Written on printed page 2 of 3" says
 * where on the paper the ink was, which is the part flattening was for, and
 * says it in a form no one can mistake for the student's own writing.
 */
async function pagesToPng(
  inked: readonly ExamWorkingInkedPage[],
  sheet: readonly ExamSheetPage[],
  questionLabel: string,
  paper: ExamSheetPaper
) {
  if (inked.length === 0) return undefined;
  try {
    const printedPageCount = sheet.filter((page) => page.kind === "printed").length;
    const entries = inked.map((entry) => {
      const page = sheet[entry.index] ?? BLANK_PAGE;
      return {
        svg: entry.svg,
        width: page.width,
        height: page.height,
        caption: examSheetPageCaption({ page, questionLabel, printedPageCount }),
        /*
         * Its own ground, not white. A light pen on a dark sheet is an
         * ordinary thing to write, and flattening it onto white would submit a
         * blank page as the student's answer.
         */
        ground: examSheetPageGround(page, paper),
      };
    });
    const layout = examWorkingSheetLayout({
      pages: entries,
      gap: SNAPSHOT_PAGE_GAP,
      captionHeight: SNAPSHOT_CAPTION_HEIGHT,
    });
    const images = await Promise.all(entries.map((entry) => loadSvgImage(entry.svg)));
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#e5e7eb";
    context.fillRect(0, 0, layout.width, layout.height);
    context.textBaseline = "middle";
    context.font = `600 ${Math.round(SNAPSHOT_CAPTION_FONT * layout.scale)}px ui-sans-serif, system-ui, sans-serif`;
    images.forEach((image, index) => {
      const slot = layout.slots[index];
      if (!slot) return;
      context.fillStyle = "#334155";
      context.fillText(
        entries[index].caption,
        slot.left,
        slot.captionTop + slot.captionHeight / 2
      );
      context.fillStyle = entries[index].ground;
      context.fillRect(slot.left, slot.top, slot.width, slot.height);
      context.drawImage(image, slot.left, slot.top, slot.width, slot.height);
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

/**
 * One finger on the sheet, before it has said what it means.
 *
 * A drag is either the page moving under the frame or the page turning, and
 * which it is cannot be known at the moment of contact. So the contact is
 * recorded, nothing happens until it has travelled, and the first travel
 * decides: sideways on a fitted sheet turns the page, anything else scrolls.
 * That is the notebook's rule, and the thresholds below are the notebook's own
 * numbers -- turning a page should not be a different gesture here.
 */
type FingerGesture = {
  pointerId: number;
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  intent: "undecided" | "pan" | "swipe";
  target: Element | null;
  /** Recent x positions, for the flick check on release. */
  samples: NotebookSwipeSample[];
  /** How far the sheet has been dragged, in px. */
  offset: number;
  /** The pull past the last page that asks for another sheet. */
  creating: boolean;
};

/** How far a committed page turn slides the sheet before it is replaced. */
const SWIPE_HANDOFF_TRAVEL = 0.32;
/** The notebook's settle curve, so a page lands here the way it lands there. */
const SWIPE_SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Enough recent positions to read a flick from; older ones say nothing. */
const SWIPE_SAMPLE_LIMIT = 12;

type ConfirmRequest = "clear-page" | "delete-page" | null;

/** A sheet of working has no text layer, so these are its only tools. */
type WorkingTool = "pen" | "highlighter" | "eraser";

/**
 * The question, as a sheet of paper to answer on.
 *
 * It is the notebook's ink editor with the notebook's tools and settings,
 * deliberately: a student who has learned to write in Jami should not meet a
 * different, worse pen the moment the work is being marked. Pen feel and
 * scribble-to-erase are read from the same saved preferences, so a hand tuned
 * once stays tuned here.
 *
 * What changed is what is under the ink. This used to be four blank pads
 * beside a picture of the question, which is why answering felt like a
 * separate exercise from reading: the paper was one thing on the screen and
 * the work was another. The pages are now the board's own pages -- its
 * wording, its diagrams, its ruled answer lines, at the size it printed them
 * -- followed by as many blank sheets as the question needs.
 *
 * What it is still not is a notebook page. There is no text layer and no
 * images a student can add: the typed answer sits under the sheet, and what is
 * sent for marking is the ink on these pages and nothing else.
 */
function ExamScratchpad({
  userId,
  attemptId,
  disabled = false,
  embedded = false,
  printedPages,
  answerSpacePages,
  questionLabel,
  assetPath,
  onHandle,
  onInkChange,
}: {
  userId: string;
  attemptId: string;
  disabled?: boolean;
  /** Drawn flush inside a surrounding sheet, without a frame of its own. */
  embedded?: boolean;
  /**
   * The question's own pages of paper, in printed order, or empty for a
   * question that has none.
   *
   * Held stable by the caller: this is the identity the whole sheet is built
   * from, and a fresh array every render would rebuild the editor under a
   * student's hand.
   */
  printedPages: readonly PracticePaperQuestionAsset[];
  /** Ruled pages the board left after the question, which its crop drops. */
  answerSpacePages?: number;
  questionLabel: string;
  /** Where a printed page's image is fetched from, given its asset id. */
  assetPath(assetId: string): string;
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
  const gestureRef = useRef<FingerGesture | null>(null);
  /** The element a page turn slides: the sheet and the shadow under it. */
  const pageShellRef = useRef<HTMLDivElement | null>(null);
  const addSheetHintRef = useRef<HTMLDivElement | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * What the sheet is, read at the moment a finger lifts rather than at the
   * moment it landed. The gesture handlers are held stable so the ink editor
   * is never reconciled mid-stroke, so they cannot close over this.
   */
  const sheetRef = useRef({
    pageIndex: 0,
    pageCount: 1,
    canAddPage: false,
    disabled: false,
    zoom: 1,
    goToPage: (index: number) => {
      void index;
    },
    addPage: () => {},
  } as {
    pageIndex: number;
    pageCount: number;
    canAddPage: boolean;
    disabled: boolean;
    zoom: number;
    goToPage: (index: number) => void;
    addPage: () => void;
  });
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
  /**
   * The full-screen frame, and where the page has been scrolled inside it.
   *
   * Only read while writing full screen, and only used to decide how much of
   * the page is worth painting. See `notebook-ink-window.ts`: js-draw clears
   * and repaints its whole backing store on every frame of a stroke, so a page
   * zoomed to 3x costs nine times the work per frame and shows nine times less
   * of it. The pages are the paper's own size now, which makes that worse: an
   * A4 page zoomed in far enough to write comfortably on a dense printed part
   * is a large canvas being thrown away nine tenths of the time.
   */
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  /**
   * Blank sheets after the printed ones.
   *
   * Not stored. It is the larger of what the board left room for and what the
   * student has actually written on, so a sheet reopens with every page that
   * carries ink and never fewer pages than the paper allotted.
   */
  const [continuationCount, setContinuationCount] = useState(() =>
    examSheetOpeningContinuations({ answerSpacePages, printedPageCount: printedPages.length })
  );

  const [tool, setTool] = useState<WorkingTool>("pen");
  const [openMenu, setOpenMenu] = useState<NotebookToolMenu>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [penColor, setPenColor] = useState<NotebookStrokeColor>("black");
  const [penThicknessPercent, setPenThicknessPercent] = useState(50);
  // Read once, lazily: the saved preferences are this sheet's starting values,
  // and nothing on the first paint depends on them.
  const [penSettings, setPenSettings] = useState(readNotebookPenSettings);
  const [scribbleToErase, setScribbleToErase] = useState(
    readNotebookScribbleErasePreference
  );
  /** The paper the student's own sheets are made of. Never the board's pages. */
  const [paper, setPaper] = useState<ExamSheetPaper>(readExamSheetPaperPreference);
  const [paperOpen, setPaperOpen] = useState(false);
  const paperRef = useRef(paper);
  paperRef.current = paper;
  const [highlighterColor, setHighlighterColor] = useState<NotebookStrokeColor>("yellow");
  const [highlighterThicknessPercent, setHighlighterThicknessPercent] = useState(50);
  const [eraserMode, setEraserMode] = useState<NotebookEraserMode>("precision");
  const [eraserSize, setEraserSize] = useState<NotebookEraserSize>("medium");

  const sheetPages = useMemo(
    () => examSheetPages({ printedPages: [...printedPages], continuationCount }),
    [continuationCount, printedPages]
  );
  const pageCount = sheetPages.length;
  const printedPageCount = printedPages.length;
  const canAddPage = continuationCount < examSheetContinuationRoom(printedPageCount);
  /** Every page the sheet has, so the handle can caption them for the marker. */
  const sheetPagesRef = useRef(sheetPages);
  sheetPagesRef.current = sheetPages;

  const setPages = useCallback((pages: string[]) => {
    pagesRef.current = pages;
    pageInkRef.current = pages.map((page) => examWorkingHasInk(page));
  }, []);

  useEffect(() => {
    let active = true;
    loadedRef.current = false;
    void loadExamScratchpad(userId, attemptId)
      .then((stored) => {
        if (!active) return;
        /*
         * A page's position on the sheet is what says where its ink was
         * written, so the stored pages are laid back down at the index they
         * were saved at rather than packed to the front. Saving drops blank
         * pages off the end, so a sheet reopens with the board's own allowance
         * again, or with however many pages the student had written on --
         * whichever is more.
         */
        const printedCount = printedPages.length;
        const opening = examSheetOpeningContinuations({
          answerSpacePages,
          printedPageCount: printedCount,
        });
        const written = Math.max(0, stored.length - printedCount);
        const extra = Math.min(
          Math.max(opening, written),
          examSheetContinuationRoom(printedCount)
        );
        const sheet = examSheetPages({
          printedPages: [...printedPages],
          continuationCount: extra,
        });
        const loaded = Array.from({ length: sheet.length }, (_unused, index) => stored[index] ?? "");
        setContinuationCount(extra);
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
  }, [answerSpacePages, attemptId, onInkChange, printedPages, reloadKey, setPages, userId]);

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
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
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
          rasterize: (inked) =>
            pagesToPng(inked, sheetPagesRef.current, questionLabel, paperRef.current),
        }),
    };
    onHandle(handle);
    return () => onHandle(null);
  }, [attemptId, onHandle, questionLabel, setPages, userId]);

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

  /** Slides the sheet. Written to the element, never through React state. */
  const writeSheetOffset = useCallback((offset: number, durationMs = 0) => {
    const shell = pageShellRef.current;
    if (!shell) return;
    shell.style.transition =
      durationMs > 0 ? `transform ${durationMs}ms ${SWIPE_SETTLE_EASING}` : "none";
    shell.style.transform = offset === 0 ? "" : `translate3d(${offset}px, 0, 0)`;
  }, []);

  /** The ring that fills as the last page is pulled past. */
  const writeCreatePull = useCallback((progress: number) => {
    const hint = addSheetHintRef.current;
    if (!hint) return;
    const bounded = Math.max(0, Math.min(1, progress));
    hint.style.opacity = bounded <= 0 ? "0" : String(0.3 + bounded * 0.7);
    hint.style.transform = `translateY(-50%) scale(${0.72 + bounded * 0.28})`;
    const ring = hint.querySelector("[data-pull-ring]");
    if (ring instanceof SVGCircleElement) {
      ring.style.strokeDashoffset = String(2 * Math.PI * 16 * (1 - bounded));
    }
  }, []);

  /*
   * Lets the sheet finish the movement the finger started, then acts.
   *
   * A page that changes under a finger still halfway through a swipe reads as
   * a glitch rather than a turn, so the committed direction is carried on a
   * little further and the page is replaced at the end of it. Reduced motion
   * skips straight to the new page.
   */
  const settleSheet = useCallback(
    (input: {
      fromOffset: number;
      targetOffset: number;
      velocityX: number;
      pageWidth: number;
      act?: () => void;
    }) => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      const reducedMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = getNotebookSwipeSettleDuration({
        currentOffset: input.fromOffset,
        targetOffset: input.targetOffset,
        travelDistance: input.pageWidth,
        velocityX: input.velocityX,
        reducedMotion,
      });
      const finish = () => {
        settleTimer.current = null;
        writeSheetOffset(0);
        input.act?.();
      };
      if (duration <= 0) {
        finish();
        return;
      }
      writeSheetOffset(input.targetOffset, duration);
      settleTimer.current = setTimeout(finish, duration);
    },
    [writeSheetOffset]
  );

  const cancelGesture = useCallback(() => {
    gestureRef.current = null;
    writeCreatePull(0);
    writeSheetOffset(0);
  }, [writeCreatePull, writeSheetOffset]);

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
        cancelGesture();
        releaseTouchLockRef.current ??= lockTouchScrolling();
        return;
      }
      releaseTouchLockRef.current?.();
      releaseTouchLockRef.current = null;
      if (!mountedRef.current) return;
      if (dirtyRef.current) scheduleSave();
      scheduleUiSync();
    },
    [cancelGesture, scheduleSave, scheduleUiSync]
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
    if (!shouldPointerSwipePages(event.pointerType)) return;
    if (inkInteractionActiveRef.current || gestureRef.current) return;
    if (examWorkingTouchIsPalm(event)) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      intent: "undecided",
      target: scrollableAncestor(event.currentTarget),
      samples: [{ x: event.clientX, time: event.timeStamp }],
      offset: 0,
      creating: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the drag still works while the finger stays on the sheet.
    }
  }, []);

  const handleTouchMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      // The pen wins every argument: a drag under a stroke is a resting hand.
      if (inkInteractionActiveRef.current) {
        cancelGesture();
        return;
      }
      const dx = event.clientX - gesture.originX;
      const dy = event.clientY - gesture.originY;
      gesture.samples.push({ x: event.clientX, time: event.timeStamp });
      if (gesture.samples.length > SWIPE_SAMPLE_LIMIT) gesture.samples.shift();

      if (gesture.intent === "undecided") {
        if (Math.hypot(dx, dy) < PAN_START_DISTANCE) return;
        const intent = getNotebookPageDragIntent({
          axis: Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical",
          // Zoomed in, most of the sheet is off screen and a drag can only
          // sensibly move it, so no page turn is offered until it is fitted.
          zoom: sheetRef.current.zoom,
        });
        gesture.intent = intent === "page" ? "swipe" : "pan";
      }

      if (gesture.intent === "pan") {
        gesture.target?.scrollBy({
          left: gesture.lastX - event.clientX,
          top: gesture.lastY - event.clientY,
        });
      }
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      if (gesture.intent === "pan") return;

      const sheet = sheetRef.current;
      const pageWidth = surfaceRef.current?.clientWidth ?? 1;
      const pullingPastTheEnd =
        dx < 0 &&
        sheet.pageIndex >= sheet.pageCount - 1 &&
        sheet.canAddPage &&
        !sheet.disabled;
      if (pullingPastTheEnd) {
        const pull = getNotebookCreatePagePull({ totalDx: dx, pageWidth });
        gesture.creating = true;
        gesture.offset = pull.resistedOffset;
        writeCreatePull(pull.progress);
        writeSheetOffset(pull.resistedOffset);
        return;
      }
      if (gesture.creating) {
        gesture.creating = false;
        writeCreatePull(0);
      }
      gesture.offset = getNotebookSwipeDragOffset({
        totalDx: dx,
        currentIndex: sheet.pageIndex,
        pageCount: sheet.pageCount,
      });
      writeSheetOffset(gesture.offset);
    },
    [cancelGesture, writeCreatePull, writeSheetOffset]
  );

  const handleTouchEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;
      writeCreatePull(0);
      if (gesture.intent !== "swipe") return;

      const sheet = sheetRef.current;
      const pageWidth = surfaceRef.current?.clientWidth ?? 1;
      const totalDx = gesture.lastX - gesture.originX;
      const velocityX = getNotebookSwipeVelocity(
        gesture.samples,
        NOTEBOOK_PAGE_SWIPE_VELOCITY_WINDOW_MS
      );

      if (gesture.creating) {
        const creating =
          sheet.canAddPage &&
          !sheet.disabled &&
          shouldCreateNotebookPageOnRelease({ totalDx, pageWidth, velocityX });
        settleSheet({
          fromOffset: gesture.offset,
          targetOffset: creating ? -pageWidth * SWIPE_HANDOFF_TRAVEL : 0,
          velocityX,
          pageWidth,
          act: creating ? () => sheetRef.current.addPage() : undefined,
        });
        return;
      }

      const decision = getNotebookSwipeReleaseDecision({
        totalDx,
        pageWidth,
        velocityX,
        currentIndex: sheet.pageIndex,
        pageCount: sheet.pageCount,
      });
      const targetIndex = decision.targetIndex;
      settleSheet({
        fromOffset: gesture.offset,
        targetOffset: decision.shouldCommit
          ? (decision.direction === "next" ? -1 : 1) * pageWidth * SWIPE_HANDOFF_TRAVEL
          : 0,
        velocityX,
        pageWidth,
        act: decision.shouldCommit
          ? () => sheetRef.current.goToPage(targetIndex)
          : undefined,
      });
    },
    [settleSheet, writeCreatePull]
  );

  const handleTouchCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (gestureRef.current?.pointerId !== event.pointerId) return;
      cancelGesture();
    },
    [cancelGesture]
  );

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
    /*
     * The notebook's keys, and only while the sheet has the screen.
     *
     * A student who has learned P, H, E and Ctrl+Z in a notebook should not
     * have to put the pen down and reach for a toolbar here. Bound to the
     * full-screen sheet rather than the page, because inline the answer box is
     * a few centimetres away and "p" belongs to whatever is being typed.
     *
     * Captured first, so Escape closes this before the sheet the page opened
     * it in.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setExpanded(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(input|textarea|select)$/i.test(target?.tagName ?? "")) {
        return;
      }
      const shortcut = event.ctrlKey || event.metaKey;
      if (shortcut && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editorRef.current?.redo();
        else editorRef.current?.undo();
        return;
      }
      if (shortcut && event.key.toLowerCase() === "y") {
        event.preventDefault();
        editorRef.current?.redo();
        return;
      }
      if (shortcut || event.altKey) return;
      const tool =
        event.key.toLowerCase() === "p"
          ? "pen"
          : event.key.toLowerCase() === "h"
            ? "highlighter"
            : event.key.toLowerCase() === "e"
              ? "eraser"
              : null;
      if (!tool) return;
      event.preventDefault();
      setTool(tool);
      setOpenMenu(null);
    };
    document.addEventListener("keydown", onKeyDown, true);
    const frame = window.requestAnimationFrame(() =>
      rootRef.current?.focus({ preventScroll: true })
    );
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);
      releaseZoom();
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [expanded]);

  /** The page under the pen. Its shape is the paper's, not a fixed one. */
  const currentPage = sheetPages[pageIndex] ?? sheetPages[0] ?? BLANK_PAGE;
  const currentPageWidth = currentPage.width;
  const currentPageHeight = currentPage.height;

  useEffect(() => {
    if (!expanded) return;
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    // The observer reports the starting size too, so this is the only measurement.
    const observer = new ResizeObserver(() => {
      setFrame({ width: container.clientWidth, height: container.clientHeight });
      setFitWidth(
        examWorkingFitWidth({
          containerWidth: container.clientWidth,
          containerHeight: container.clientHeight,
          pageWidth: currentPageWidth,
          pageHeight: currentPageHeight,
          padding: EXPANDED_SHEET_PADDING,
        })
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
    // Re-fitted when the page changes shape: a question's first page is a crop
    // that can be a third of a sheet tall, and the one after it a whole one.
  }, [currentPageHeight, currentPageWidth, expanded]);

  /*
   * Where the page has been scrolled to, read at most once a frame.
   *
   * Nothing is measured while a stroke is being drawn: the sheet blocks
   * scrolling for the length of one, so there is nothing to follow, and a
   * layout read on the pointer path is the one thing worth keeping off it.
   */
  useEffect(() => {
    const container = scrollRef.current;
    if (!expanded || !container || zoomIndex === 0) {
      setScroll((current) => (current.left === 0 && current.top === 0 ? current : { left: 0, top: 0 }));
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      if (inkInteractionActiveRef.current) return;
      setScroll((current) =>
        current.left === container.scrollLeft && current.top === container.scrollTop
          ? current
          : { left: container.scrollLeft, top: container.scrollTop }
      );
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(read);
    };
    read();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      container.removeEventListener("scroll", onScroll);
    };
  }, [expanded, pageIndex, zoomIndex]);

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

  /**
   * More room, the way the real paper gives it.
   *
   * A student who runs out of space in an exam asks for an extra answer
   * booklet; they do not decide in advance how much of the page each part of
   * the question deserves. This is the same offer, and it is deliberately not
   * a decision: the sheet never refuses ink for want of space until it has
   * handed out every page it is allowed to.
   */
  const addPage = () => {
    if (disabled || !canAddPage) return;
    const pages = [...collectPages()];
    while (pages.length < pageCount) pages.push("");
    pages.push("");
    setContinuationCount((value) => value + 1);
    showPage(pages, pages.length - 1);
    markChanged();
  };

  /** Printed pages belong to the paper; only the sheet's own can be removed. */
  const deletePage = () => {
    const page = sheetPages[pageIndexRef.current];
    if (disabled || pageCount <= 1 || page?.kind !== "continuation") return;
    const pages = collectPages().filter((_page, index) => index !== pageIndexRef.current);
    setContinuationCount((value) => Math.max(0, value - 1));
    showPage(pages, Math.min(pageIndexRef.current, pages.length - 1));
    markChanged();
  };

  /*
   * The sheet as it stands, for the swipe handlers.
   *
   * Assigned during the render rather than in an effect, so a finger lifting
   * in the same frame as a page change acts on the page that is actually open.
   */
  sheetRef.current = {
    pageIndex,
    pageCount,
    canAddPage,
    disabled,
    zoom: zoomAt(zoomIndex),
    goToPage,
    addPage,
  };

  /** Pressing the active tool opens its options; pressing another switches. */
  const selectTool = (next: WorkingTool) => {
    setPaperOpen(false);
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

  /**
   * The slice of the page the ink canvas is asked to paint.
   *
   * Null unless the page is zoomed past its fitted size, which is the only
   * time the sheet is larger than the frame showing it -- so an inline sheet
   * and a fitted full-screen one are painted exactly as they were before this.
   */
  const sheetWidthPx = expanded && fitWidth > 0 ? Math.round(fitWidth * zoomAt(zoomIndex)) : 0;
  const inkWindow = useMemo(() => {
    if (sheetWidthPx <= 0 || frame.width <= 0 || currentPageWidth <= 0) return null;
    return getNotebookInkRenderWindow({
      sheetWidth: sheetWidthPx,
      sheetHeight: Math.round((sheetWidthPx * currentPageHeight) / currentPageWidth),
      // The page is scrolled rather than transformed, so its origin inside the
      // frame is the negated scroll offset.
      pageX: -scroll.left,
      pageY: -scroll.top,
      frameWidth: frame.width,
      frameHeight: frame.height,
    });
  }, [
    currentPageHeight,
    currentPageWidth,
    frame.height,
    frame.width,
    scroll.left,
    scroll.top,
    sheetWidthPx,
  ]);

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
      {/*
        * The tools, as the notebook draws them: rounded, floating, and over
        * the paper rather than above it.
        *
        * This was a full-width strip with a rule under it that scrolled
        * sideways when it ran out of room -- a piece of page furniture, which
        * on a sheet of exam paper read as browser chrome sitting on the desk.
        * The notebook's own pill is the thing a student already knows, so the
        * same shape is used here, split into what writes and what turns pages
        * so the two wrap onto their own lines on a phone instead of scrolling
        * out of reach.
        *
        * Sticky, so the pen is still under your thumb halfway down a page of
        * working. The settings popover and the paper picker travel with it:
        * both are anchored to this wrapper, so a menu opened after scrolling
        * still opens under the button that opened it.
        */}
      <div
        className={`sticky z-30 flex flex-wrap items-center justify-center gap-2 ${
          expanded
            ? "top-0 shrink-0 px-3 pb-2 pt-[max(0.375rem,env(safe-area-inset-top))]"
            : "top-2 px-2 py-2 sm:top-3"
        }`}
      >
        <div role="toolbar" aria-label="Working tools" className={PILL_CLASS}>
          {(["pen", "highlighter", "eraser"] as const).map((item) => (
            <div key={item} className="relative shrink-0">
              <ToolbarIconButton
                label={
                  item === "pen"
                    ? expanded ? "Pen (P)" : "Pen"
                    : item === "highlighter"
                      ? expanded ? "Highlighter (H)" : "Highlighter"
                      : expanded ? "Eraser (E)" : "Eraser"
                }
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
          {/*
            * Offered even when the sheet is all printed pages.
            *
            * It was hidden until a student had a page of their own, which read
            * as tidy and was wrong: nearly every maths question is one printed
            * page, and squared paper is most wanted exactly there. A student has
            * to be able to say "grid" before adding the sheet, not after.
            */}
          {!disabled ? (
            <ToolbarIconButton
              label="Paper"
              icon="pages"
              active={paperOpen}
              expanded={paperOpen}
              controls="exam-sheet-paper"
              onClick={() => {
                setOpenMenu(null);
                setPaperOpen((open) => !open);
              }}
            />
          ) : null}
          <ToolbarIconButton
            label={expanded ? "Undo (Ctrl+Z)" : "Undo"}
            icon="undo"
            disabled={disabled || history.undo === 0}
            onClick={() => editorRef.current?.undo()}
          />
          <ToolbarIconButton
            label={expanded ? "Redo (Ctrl+Shift+Z)" : "Redo"}
            icon="redo"
            disabled={disabled || history.redo === 0}
            onClick={() => editorRef.current?.redo()}
          />
        </div>

        <div role="toolbar" aria-label="Pages" className={PILL_CLASS}>
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
          <span className="sr-only" aria-live="polite">
            {examSheetPageCaption({ page: currentPage, questionLabel, printedPageCount })}
          </span>
          <ToolbarIconButton
            label="Next page"
            icon="forward"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => goToPage(pageIndex + 1)}
          />
          <ToolbarIconButton
            label={canAddPage ? "Add another sheet" : `Up to ${pageCount} pages`}
            icon="plus"
            disabled={disabled || !canAddPage}
            onClick={addPage}
          />
          <ToolbarIconButton
            label={
              currentPage.kind === "printed"
                ? "The printed page cannot be removed"
                : "Delete this sheet"
            }
            icon="trash"
            disabled={disabled || pageCount <= 1 || currentPage.kind === "printed"}
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

        <NotebookToolSettingsPopover
          dock="top"
          openMenu={disabled ? null : openMenu}
          pen={{
            color: penColor,
            thicknessPercent: penThicknessPercent,
            onColorChange: setPenColor,
            onThicknessChange: setPenThicknessPercent,
            settings: penSettings,
            onSettingsChange: (value) => {
              const next = clampNotebookPenSettings(value);
              setPenSettings(next);
              saveNotebookPenSettings(next);
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

        {paperOpen ? (
          <div
            id="exam-sheet-paper"
            className="notebook-floating-control absolute left-1/2 top-[4.85rem] z-40 w-[min(92vw,22rem)] -translate-x-1/2 rounded-lg border border-[var(--color-border)] p-3.5 shadow-e2"
          >
            <p className="mb-2 text-xs text-text-muted">
              {sheetPages.some((page) => page.kind === "continuation")
                ? "Your own sheets. The printed pages stay exactly as the board printed them."
                : "The sheets you add. The printed pages stay exactly as the board printed them."}
            </p>
            <NotebookPageDefaultsPicker
              pageColor={paper.pageColor}
              pageStyle={paper.pageStyle}
              disabled={disabled}
              onPageColorChange={(pageColor) => {
                const next = { ...paperRef.current, pageColor };
                setPaper(next);
                saveExamSheetPaperPreference(next);
              }}
              onPageStyleChange={(pageStyle) => {
                const next = { ...paperRef.current, pageStyle };
                setPaper(next);
                saveExamSheetPaperPreference(next);
              }}
            />
          </div>
        ) : null}
      </div>

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
            : embedded
              ? "bg-[var(--color-glass-subtle)] p-2 sm:p-3"
              : undefined
        }
      >
        <div
          ref={pageShellRef}
          className={expanded ? "mx-auto shadow-shell" : undefined}
          style={{
            ...(expanded && fitWidth > 0 ? { width: Math.round(fitWidth * zoom) } : null),
            // Promoted for the length of the gesture only; the transform is
            // written straight to this element while a finger is on the sheet.
            willChange: "transform",
          }}
        >
          {/*
            * `notebook-page-surface` is the notebook sheet's own ground rules: no
            * text selection, callout or drag, no overscroll, no native pan. Paint
            * containment keeps every ink frame's repaint inside the page instead
            * of invalidating the scrolling page around it.
            *
            * Square corners, because the paper has square corners. This was
            * rounded along the top and clipped to the radius, which on a white
            * page over a pale workspace read as the sheet being smudged or torn
            * away at its corners -- and on a printed page it cut off the board's
            * own margin rule and the question number printed beside it. The clip
            * stays, since the ink canvas has to be held inside the page, but it
            * no longer cuts anything but a right angle.
            */}
          <div
            ref={surfaceRef}
            className="notebook-page-surface relative w-full overflow-hidden bg-white shadow-e1 ring-1 ring-black/[0.07] [contain:layout_paint]"
            style={{ aspectRatio: `${currentPageWidth} / ${currentPageHeight}` }}
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
              <>
                {/*
                  * The paper under the ink. Drawn inside the same clipped,
                  * paint-contained box, so a stroke repaints the page and
                  * nothing above it, and the print never moves relative to
                  * what is written on it.
                  */}
                <ExamSheetPageBackground
                  key={`bg:${attemptId}:${pageIndex}`}
                  page={currentPage}
                  assetPath={assetPath}
                  questionLabel={questionLabel}
                  paper={paper}
                />
                <WorkingInkEditor
                  key={`${attemptId}:${pageMount}`}
                  ref={editorRef}
                  activeTool={tool}
                  eraserMode={eraserMode}
                  eraserThickness={widths.eraser}
                  highlighterColor={highlighterColor}
                  highlighterThickness={widths.highlighter}
                  initialSvg={pageSvgs[pageIndex] ?? ""}
                  inkWindow={inkWindow}
                  pageHeight={currentPageHeight}
                  pageId={`${attemptId}:${pageIndex}`}
                  pageWidth={currentPageWidth}
                  penColor={penColor}
                  penSettings={penSettings}
                  penThickness={widths.pen}
                  readOnly={disabled}
                  scribbleToErase={scribbleToErase}
                  onChange={handleInkChange}
                  onHistoryChange={handleHistoryChange}
                  onInteractionChange={handleInteractionChange}
                  onPointerCancel={handleTouchCancel}
                  onPointerDown={handleTouchDown}
                  onPointerMove={handleTouchMove}
                  onPointerUp={handleTouchEnd}
                />
              </>
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-text-muted">
                Opening your working…
              </div>
            )}
          </div>
        </div>
      </div>

      {/*
        * The page being asked for, while it is being asked for.
        *
        * It appears only under the finger's own pull: a student who is writing
        * is never shown a control for running out of paper. Written to
        * directly during the gesture, so nothing here re-renders the sheet.
        */}
      {!disabled && canAddPage ? (
        <div
          ref={addSheetHintRef}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 z-20 flex flex-col items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-3 py-2.5 shadow-e2 backdrop-blur-sm"
          style={{ opacity: 0, transform: "translateY(-50%) scale(0.72)" }}
        >
          <span className="relative grid h-9 w-9 place-items-center">
            <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90">
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                strokeWidth="3"
                className="stroke-[var(--color-border)]"
              />
              <circle
                data-pull-ring
                cx="20"
                cy="20"
                r="16"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                className="stroke-[var(--color-accent)]"
                strokeDasharray={2 * Math.PI * 16}
                style={{ strokeDashoffset: 2 * Math.PI * 16 }}
              />
            </svg>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-text-secondary" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="text-2xs font-semibold text-text-secondary">New sheet</span>
        </div>
      ) : null}

      {/*
        * More room, offered where a student runs out of it.
        *
        * The control in the toolbar is for someone who already knows the sheet
        * grows. This is for someone writing at the foot of the last page, who
        * needs to be told rather than asked -- so it appears only there, and
        * says what it gives rather than asking them to ration what is left.
        * Nothing here counts down the space remaining: a student who thinks
        * they are running out writes a worse answer than one who is not
        * thinking about it at all.
        */}
      {!disabled && canAddPage && pageIndex === pageCount - 1 ? (
        <div
          className={`flex shrink-0 items-center justify-center gap-3 border-t border-[var(--color-border)] px-4 py-3 ${
            expanded ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : ""
          }`}
        >
          <p className="text-xs text-text-muted">Run out of room?</p>
          <Button type="button" size="sm" variant="secondary" onClick={addPage}>
            Add another sheet
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "delete-page" ? "Delete this sheet?" : "Clear this page?"}
        description={
          confirm === "delete-page"
            ? "Everything written on this extra sheet is removed."
            : "Everything written on this page is removed. You can undo it straight after."
        }
        confirmLabel={confirm === "delete-page" ? "Delete sheet" : "Clear page"}
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
