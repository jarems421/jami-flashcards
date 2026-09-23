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
import { BLANK_PAGE, pagesToPng } from "@/lib/practice/exam-working-snapshot";
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
  examWorkingHasInk,
  type ExamScratchpadHandle,
} from "@/lib/practice/exam-working";
import {
  useNotebookViewportController,
  type NotebookViewportFrameSize,
} from "@/hooks/useNotebookViewportController";
import {
  clampNotebookViewportOrigin,
  clampNotebookViewportZoom,
  getNotebookViewportInset,
  getNotebookViewportLayout,
  isNotebookViewportZoomedIn,
  type NotebookViewportPoint,
} from "@/lib/workspace/notebook-viewport";
import {
  examSheetContinuationRoom,
  examSheetOpeningContinuations,
  examSheetPageCaption,
  examSheetPages,
} from "@/lib/practice/exam-question-sheet";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import ExamSheetPageBackground from "@/components/practice/ExamSheetPageBackground";
import NotebookPageDefaultsPicker from "@/components/workspace/NotebookPageDefaultsPicker";
import {
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
  shouldSuppressTouchAfterStylus,
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
/**
 * How long after the Pencil lifts that a touch is still taken for the hand
 * that was holding it. The notebook's own figure.
 */
const STYLUS_TOUCH_COOLDOWN_MS = 180;
/** How far one notch of a mouse wheel, or a trackpad pinch, zooms. */
const WHEEL_ZOOM_SENSITIVITY = 0.0025;
const NO_PAN: NotebookViewportPoint = { x: 0, y: 0 };
/** Held stable, so passing it never re-renders the ink editor. */
const ignorePointer = () => undefined;

/**
 * How tall the frame has to be for the page to fill its width, inline.
 *
 * Inline the sheet flows with the practice page: its width is the column's and
 * its height follows from the paper. The notebook's viewport maths works from
 * a frame, so the frame is sized to the page rather than the other way round,
 * with the notebook's own margin either side of it.
 *
 * The margin depends on whether the frame is wider than it is tall, which
 * depends on the margin, so it is settled in two steps: once from the width
 * alone, and once more from the height that gives.
 */
function inlineFrameHeight(width: number, pageWidth: number, pageHeight: number) {
  if (width <= 0 || pageWidth <= 0 || pageHeight <= 0) return 0;
  const fitted = (inset: number) =>
    (width - inset * 2) * (pageHeight / pageWidth) + inset * 2;
  const provisional = fitted(getNotebookViewportInset(width, 0));
  return Math.ceil(fitted(getNotebookViewportInset(width, provisional)));
}

/*
 * Memoised, with every callback below held stable, the way the notebook holds
 * its editor. The sheet re-rendered the editor on every one of its own renders
 * with fresh inline callbacks, so the ink surface was being reconciled while a
 * student was writing on it.
 */
const WorkingInkEditor = memo(NotebookInkEditor);

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
  /** The page itself: what a pinch scales and a pan moves. */
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  /** The window the page is seen through, and what every finger lands on. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const inkInteractionActiveRef = useRef(false);
  /** Until when a touch is still taken for the hand that held the Pencil. */
  const stylusCooldownUntilRef = useRef(0);
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
  /** The element a page turn slides: the track the page sits on. */
  const pageShellRef = useRef<HTMLDivElement | null>(null);
  const addSheetHintRef = useRef<HTMLDivElement | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What a settling page turn does when it lands, so a new one can land it early. */
  const settleActRef = useRef<(() => void) | null>(null);
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
    expanded: false,
    zoom: 1,
    pageWidth: 1,
    goToPage: (index: number) => {
      void index;
    },
    addPage: () => {},
  } as {
    pageIndex: number;
    pageCount: number;
    canAddPage: boolean;
    disabled: boolean;
    expanded: boolean;
    zoom: number;
    /** The page as drawn on screen, in px. */
    pageWidth: number;
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
  /**
   * The page as the notebook holds one: a frame, a zoom and where the page
   * sits inside the frame.
   *
   * This was a scrolling box whose page was made wider to zoom, which is why
   * it could only be zoomed full screen, only with buttons, and not pinched at
   * all. The notebook's viewport is what a student has already learned to
   * pinch, pan and turn, so the sheet now uses it -- inline and full screen
   * alike.
   */
  const [frameSize, setFrameSize] = useState<NotebookViewportFrameSize>({
    width: 0,
    height: 0,
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<NotebookViewportPoint>(NO_PAN);
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
    if (ring instanceof SVGElement) {
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
        settleActRef.current = null;
        writeSheetOffset(0);
        input.act?.();
      };
      if (duration <= 0) {
        finish();
        return;
      }
      settleActRef.current = finish;
      writeSheetOffset(input.targetOffset, duration);
      settleTimer.current = setTimeout(finish, duration);
    },
    [writeSheetOffset]
  );

  /*
   * Lands a page turn that is still settling, now.
   *
   * A finger that comes down again before the last turn has finished animating
   * is turning the next page. That used to clear the timer and drop the turn
   * with it, so a quick pair of flicks moved one page instead of two.
   */
  const landSettlingTurn = useCallback(() => {
    const land = settleActRef.current;
    if (!land) return;
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    land();
  }, []);

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
      // While a stroke is live the cooldown never expires: the hand holding
      // the Pencil is on the page, and it is not asking to turn it.
      stylusCooldownUntilRef.current = active
        ? Number.POSITIVE_INFINITY
        : Date.now() + STYLUS_TOUCH_COOLDOWN_MS;
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
   * One finger on the sheet, once the viewport has passed on it.
   *
   * Sideways on a fitted page turns it, or pulls another sheet in past the
   * last one. Up and down on a fitted page, inline, scrolls the practice page
   * the way a finger does anywhere else on it: the sheet refuses native panning
   * so the Pencil can write, and a page taller than the screen could otherwise
   * only be moved by finding a margin. A zoomed page belongs to the viewport --
   * one finger moves it, two pinch it -- and those never reach here.
   *
   * There used to be a size check here that dropped any contact wider than
   * 40px as a resting palm. iPadOS reports a fingertip at around that size, so
   * turning and scrolling failed for most fingers most of the time. The
   * notebook never measured contacts: it ignores touch while the Pencil is down
   * and for a moment after it lifts, which is when a palm is actually on the
   * glass, and the viewport now does the same here before this is reached.
   */
  const beginSwipe = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!shouldPointerSwipePages(event.pointerType)) return;
      if (inkInteractionActiveRef.current || gestureRef.current) return;
      landSettlingTurn();
      const frame = frameRef.current;
      gestureRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        intent: "undecided",
        // Full screen there is nothing behind the sheet a drag should move.
        target: sheetRef.current.expanded ? null : scrollableAncestor(frame),
        samples: [{ x: event.clientX, time: event.timeStamp }],
        offset: 0,
        creating: false,
      };
      // The new-sheet ring waits level with the finger, rather than halfway
      // down a frame that can be taller than the screen.
      const hint = addSheetHintRef.current;
      if (hint && frame) {
        const rect = frame.getBoundingClientRect();
        const top = Math.min(
          Math.max(event.clientY - rect.top, 48),
          Math.max(48, rect.height - 48)
        );
        hint.style.top = `${top}px`;
      }
    },
    [landSettlingTurn]
  );

  const moveSwipe = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
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
      const pullingPastTheEnd =
        dx < 0 &&
        sheet.pageIndex >= sheet.pageCount - 1 &&
        sheet.canAddPage &&
        !sheet.disabled;
      if (pullingPastTheEnd) {
        const pull = getNotebookCreatePagePull({
          totalDx: dx,
          pageWidth: sheet.pageWidth,
        });
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

  const endSwipe = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;
      writeCreatePull(0);
      if (gesture.intent !== "swipe") return;

      const sheet = sheetRef.current;
      const pageWidth = sheet.pageWidth;
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

  const cancelSwipe = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
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
        setZoom(1);
        setPan(NO_PAN);
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

  /*
   * The frame the page is seen through.
   *
   * Full screen it is whatever the screen leaves under the tools. Inline it is
   * as wide as the column and as tall as the page needs to fill that width, so
   * the sheet still flows with the practice page -- see `inlineFrameHeight`.
   * It is the same element in both modes, so switching restyles it rather
   * than remounting the editor inside.
   */
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      setFrameSize((previous) =>
        Math.abs(previous.width - width) < 0.5 &&
        Math.abs(previous.height - height) < 0.5
          ? previous
          : { width, height }
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const inlineHeight = inlineFrameHeight(
    frameSize.width,
    currentPageWidth,
    currentPageHeight
  );

  /*
   * The notebook's own viewport: its fit, its pinch anchored under the
   * fingers, one finger moving a zoomed page, and its palm rule -- touch is
   * ignored while the Pencil is down and for a moment after it lifts. What it
   * does not take for itself, it hands back as a swipe.
   */
  const {
    layout,
    pagePanLiveRef,
    handleTouchPointerDown,
    handleTouchPointerMove,
    handleTouchPointerEnd,
  } = useNotebookViewportController({
    frameSize,
    pageZoom: zoom,
    pagePan: pan,
    pageWidth: currentPageWidth,
    pageHeight: currentPageHeight,
    setPageZoom: setZoom,
    setPagePan: setPan,
    pageSurfaceRef: surfaceRef,
    pageFrameRef: frameRef,
    isNavigationLocked: () => false,
    isStylusSuppressingTouch: () =>
      shouldSuppressTouchAfterStylus({
        stylusActive: inkInteractionActiveRef.current,
        cooldownUntil: stylusCooldownUntilRef.current,
        now: Date.now(),
      }),
    onPinchTakeover: cancelGesture,
    onClearSwipeCandidate: () => {
      gestureRef.current = null;
    },
    onSwipeEnd: (event, options) => {
      if (options.cancelled) cancelSwipe(event);
      else endSwipe(event);
    },
  });
  /** The layout as last rendered, for handlers held stable across renders. */
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Where the page settled, for the next pinch or pan to start from.
  useEffect(() => {
    pagePanLiveRef.current = layout.pageOrigin;
  }, [layout.pageOrigin, pagePanLiveRef]);

  const fitPage = useCallback(() => {
    setZoom(1);
    setPan(NO_PAN);
  }, []);

  /*
   * Zooms about a point in the frame, keeping whatever is under it still.
   *
   * The buttons zoom about the middle of the frame, and a mouse wheel or a
   * trackpad pinch about the pointer. A pinch on glass never comes here: the
   * viewport anchors that itself.
   */
  const zoomAbout = useCallback(
    (nextZoom: number, focus?: NotebookViewportPoint) => {
      const current = layoutRef.current;
      const bounded = clampNotebookViewportZoom(nextZoom);
      if (Math.abs(bounded - current.zoom) < 0.001) return;
      if (!isNotebookViewportZoomedIn(bounded)) {
        fitPage();
        return;
      }
      const point = focus ?? {
        x: current.frameSize.width / 2,
        y: current.frameSize.height / 2,
      };
      const across =
        (point.x - current.pageOrigin.x) / Math.max(1, current.pageSize.width);
      const down =
        (point.y - current.pageOrigin.y) / Math.max(1, current.pageSize.height);
      const next = getNotebookViewportLayout({
        frameWidth: current.frameSize.width,
        frameHeight: current.frameSize.height,
        pageWidth: current.logicalPageSize.width,
        pageHeight: current.logicalPageSize.height,
        zoom: bounded,
        pan: {
          x: point.x - across * current.fitSize.width * bounded,
          y: point.y - down * current.fitSize.height * bounded,
        },
      });
      setZoom(bounded);
      setPan(next.pageOrigin);
    },
    [fitPage]
  );

  /*
   * A mouse wheel and a trackpad, on a desktop.
   *
   * A zoomed page used to be a scrolling box, so a wheel moved it for free. It
   * is positioned now, the way the notebook positions one, so the wheel is
   * read here: it pans a zoomed page, and with Ctrl -- which is also how a
   * trackpad pinch arrives -- it zooms about the pointer. A fitted page leaves
   * a plain wheel alone, so the practice page scrolls past it as it always did.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let pendingPan: NotebookViewportPoint | null = null;
    let animationFrame = 0;
    const onWheel = (event: WheelEvent) => {
      if (inkInteractionActiveRef.current) return;
      const current = layoutRef.current;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = frame.getBoundingClientRect();
        zoomAbout(
          current.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
          { x: event.clientX - rect.left, y: event.clientY - rect.top }
        );
        return;
      }
      if (!isNotebookViewportZoomedIn(current.zoom)) return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? current.frameSize.height
            : 1;
      const from = pendingPan ?? current.pageOrigin;
      pendingPan = clampNotebookViewportOrigin({
        origin: {
          x: from.x - event.deltaX * unit,
          y: from.y - event.deltaY * unit,
        },
        bounds: current.panBounds,
      });
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const next = pendingPan;
        pendingPan = null;
        if (next) setPan(next);
      });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      frame.removeEventListener("wheel", onWheel);
    };
  }, [zoomAbout]);

  // A pinch that starts on the sheet is the sheet's, never Safari's page zoom.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    return installNotebookViewportZoomBlock(frame);
  }, []);

  /*
   * Every finger lands on the frame rather than the ink.
   *
   * The ink editor passes touches straight through -- fingers never draw -- so
   * they bubble up to here. The viewport answers first, and only what it
   * declines becomes a page turn or a scroll. The margin round the page is part
   * of the frame, so a turn can start there too.
   */
  const handleFramePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      if (handleTouchPointerDown(event)) return;
      beginSwipe(event);
    },
    [beginSwipe, handleTouchPointerDown]
  );

  const handleFramePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      if (handleTouchPointerMove(event)) return;
      moveSwipe(event);
    },
    [handleTouchPointerMove, moveSwipe]
  );

  const handleFramePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      handleTouchPointerEnd(event);
    },
    [handleTouchPointerEnd]
  );

  const handleFramePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      handleTouchPointerEnd(event, { cancelled: true });
    },
    [handleTouchPointerEnd]
  );

  /*
   * Opens a page, keeping what is on the one being left.
   *
   * A zoomed sheet stays zoomed, the way a notebook does, and opens the next
   * page at its top: the pages are different shapes, so wherever the last one
   * was being read means nothing on the next.
   */
  const showPage = useCallback(
    (
      pages: string[],
      nextIndex: number,
      nextPage: { width: number; height: number }
    ) => {
      setPages(pages);
      pageIndexRef.current = nextIndex;
      latestHistoryRef.current = { undo: 0, redo: 0 };
      setPageSvgs(pages);
      setPageIndex(nextIndex);
      setPageMount((value) => value + 1);
      setHistory({ undo: 0, redo: 0 });
      setOpenMenu(null);
      const current = layoutRef.current;
      if (isNotebookViewportZoomedIn(current.zoom)) {
        const opened = getNotebookViewportLayout({
          frameWidth: current.frameSize.width,
          frameHeight: current.frameSize.height,
          pageWidth: nextPage.width,
          pageHeight: nextPage.height,
          zoom: current.zoom,
        });
        setPan(
          clampNotebookViewportOrigin({
            origin: { x: opened.pageOrigin.x, y: opened.inset },
            bounds: opened.panBounds,
          })
        );
      }
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
    showPage(collectPages(), nextIndex, sheetPages[nextIndex] ?? BLANK_PAGE);
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
    // Every added sheet is a blank continuation page, and they are all A4.
    showPage(pages, pages.length - 1, BLANK_PAGE);
    markChanged();
  };

  /** Printed pages belong to the paper; only the sheet's own can be removed. */
  const deletePage = () => {
    const leaving = pageIndexRef.current;
    const page = sheetPages[leaving];
    if (disabled || pageCount <= 1 || page?.kind !== "continuation") return;
    const pages = collectPages().filter((_page, index) => index !== leaving);
    const remaining = sheetPages.filter((_page, index) => index !== leaving);
    const opening = Math.min(leaving, pages.length - 1);
    setContinuationCount((value) => Math.max(0, value - 1));
    showPage(pages, opening, remaining[opening] ?? BLANK_PAGE);
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
    expanded,
    zoom: layout.zoom,
    pageWidth: Math.max(1, layout.pageSize.width),
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

  const zoomed = isNotebookViewportZoomedIn(layout.zoom);

  /**
   * The slice of the page the ink canvas is asked to paint.
   *
   * Null unless the page is zoomed past its fitted size, which is the only
   * time the sheet is larger than the frame showing it -- so a fitted sheet is
   * painted exactly as it always was. See `notebook-ink-window.ts`: js-draw
   * clears and repaints its whole backing store on every frame of a stroke, so
   * a page zoomed to 3x costs nine times the work per frame and shows a ninth
   * of it.
   */
  const inkWindow = useMemo(
    () =>
      zoomed
        ? getNotebookInkRenderWindow({
            sheetWidth: layout.pageSize.width,
            sheetHeight: layout.pageSize.height,
            pageX: layout.pageOrigin.x,
            pageY: layout.pageOrigin.y,
            frameWidth: layout.frameSize.width,
            frameHeight: layout.frameSize.height,
          })
        : null,
    [layout, zoomed]
  );

  const openedPageHasInk = useMemo(
    () => examWorkingHasInk(pageSvgs?.[pageIndex] ?? ""),
    [pageIndex, pageSvgs]
  );
  const currentPageHasInk = history.undo > 0 || openedPageHasInk;
  const zoomInStep = EXAM_WORKING_ZOOM_STEPS.find((step) => step > layout.zoom + 0.01);
  const zoomOutStep = [...EXAM_WORKING_ZOOM_STEPS]
    .reverse()
    .find((step) => step < layout.zoom - 0.01);
  const toggleFullScreen = () => {
    setExpanded((value) => !value);
    // Each mode opens fitted: a zoom chosen for one frame means little in the other.
    fitPage();
  };

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
          {/*
            * Always there full screen. Inline, only once the page has been
            * pinched: the way back to the fitted page has to be in reach, but
            * a column of controls nobody has asked for does not.
            */}
          {expanded || zoomed ? (
            <div
              role="group"
              aria-label="Zoom"
              className="flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-0.5"
            >
              <ToolbarIconButton
                label="Zoom out"
                icon="minus"
                disabled={zoomOutStep === undefined}
                onClick={() => zoomAbout(zoomOutStep ?? 1)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Fit the page"
                title="Fit the page"
                className="min-w-[3.5rem] tabular-nums"
                onClick={fitPage}
              >
                {zoomed ? `${Math.round(layout.zoom * 100)}%` : "Fit"}
              </Button>
              <ToolbarIconButton
                label="Zoom in"
                icon="plus"
                disabled={zoomInStep === undefined}
                onClick={() => zoomAbout(zoomInStep ?? layout.zoom)}
              />
            </div>
          ) : null}
          <ToolbarIconButton
            label={expanded ? "Close full screen" : "Write full screen"}
            icon={expanded ? "close" : "expand"}
            active={expanded}
            onClick={toggleFullScreen}
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
        * The frame, the track and the page: always these three elements,
        * whether or not the sheet is full screen, so switching mode restyles
        * them rather than rebuilding the editor.
        *
        * The notebook's shape, deliberately. The frame is the window the page
        * is seen through, and takes every finger; the track is what a page
        * turn slides; the page sits on the track where the viewport puts it,
        * at the size its zoom makes it.
        */}
      <div
        ref={frameRef}
        data-notebook-page-frame
        className={
          expanded
            ? "relative mb-[env(safe-area-inset-bottom)] min-h-0 flex-1 overflow-hidden"
            : "relative overflow-hidden bg-[var(--color-glass-subtle)]"
        }
        style={
          expanded
            ? undefined
            : inlineHeight > 0
              ? { height: inlineHeight }
              : { aspectRatio: `${currentPageWidth} / ${currentPageHeight}` }
        }
        onPointerDown={handleFramePointerDown}
        onPointerMove={handleFramePointerMove}
        onPointerUp={handleFramePointerUp}
        onPointerCancel={handleFramePointerCancel}
        onLostPointerCapture={handleFramePointerCancel}
      >
        <div ref={pageShellRef} className="notebook-page-track absolute inset-0">
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
            *
            * Rendered from the first commit, before the frame has been measured:
            * the Pencil guard is installed on this element once, at mount.
            */}
          <div
            ref={surfaceRef}
            className={`notebook-page-surface absolute left-0 top-0 overflow-hidden bg-white shadow-e1 ring-1 ring-black/[0.07] [contain:layout_paint] ${
              expanded ? "shadow-shell" : ""
            }`}
            style={{
              width: layout.pageSize.width,
              height: layout.pageSize.height,
              transform: `translate3d(${layout.pageOrigin.x}px, ${layout.pageOrigin.y}px, 0)`,
              transformOrigin: "0 0",
            }}
          >
            {layout.pageSize.width <= 0 ? null : loadFailed ? (
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
                  // Fingers are the frame's, and reach it by bubbling.
                  onPointerCancel={ignorePointer}
                  onPointerDown={ignorePointer}
                  onPointerMove={ignorePointer}
                  onPointerUp={ignorePointer}
                />
              </>
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-text-muted">
                Opening your working…
              </div>
            )}
          </div>
        </div>

        {/*
          * The page being asked for, while it is being asked for.
          *
          * It appears only under the finger's own pull: a student who is writing
          * is never shown a control for running out of paper -- which is also
          * why the "Run out of room?" bar that sat under the last page has gone.
          * Written to directly during the gesture, so nothing here re-renders
          * the sheet. Opaque rather than blurred, since it sits over the ink.
          */}
        {!disabled && canAddPage ? (
          <div
            ref={addSheetHintRef}
            aria-hidden="true"
            className="notebook-floating-control pointer-events-none absolute right-3 top-1/2 z-20 flex flex-col items-center gap-1 rounded-2xl border border-[var(--color-border)] px-3 py-2.5 shadow-e2"
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
      </div>

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
