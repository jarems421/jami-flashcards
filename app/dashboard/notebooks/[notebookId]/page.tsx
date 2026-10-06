"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import AppPage from "@/components/layout/AppPage";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import PracticePaperAttemptBar from "@/components/practice/PracticePaperAttemptBar";
import NotebookQuestionOverlay from "@/components/workspace/NotebookQuestionOverlay";
import type { NotebookInkEditorHandle } from "@/components/workspace/NotebookInkEditor";
import NotebookLivePageLayers from "@/components/workspace/NotebookLivePageLayers";
import NotebookImageLayer from "@/components/workspace/NotebookImageLayer";
import NotebookGraphLayer from "@/components/workspace/NotebookGraphLayer";
import NotebookGraphEditorDialog from "@/components/workspace/NotebookGraphEditorDialog";
import { PAGE_COLOR_CLASS } from "@/components/workspace/NotebookPageBackground";
import NotebookPageStaticContent from "@/components/workspace/NotebookPageStaticContent";
import NotebookPagesDrawer from "@/components/workspace/NotebookPagesDrawer";
import NotebookPageNavigation from "@/components/workspace/NotebookPageNavigation";
import NotebookDrawingToolbar from "@/components/workspace/NotebookDrawingToolbar";
import NotebookAddPagesDialog from "@/components/workspace/NotebookAddPagesDialog";
import NotebookEditorConfirmDialog from "@/components/workspace/NotebookEditorConfirmDialog";
import NotebookPhoneLayoutNotice from "@/components/workspace/NotebookPhoneLayoutNotice";
import NotebookSaveIndicator from "@/components/workspace/NotebookSaveIndicator";
import NotebookToolSettingsPopover from "@/components/workspace/NotebookToolSettingsPopover";
import NotebookTextBlockLayer from "@/components/workspace/NotebookTextBlockLayer";
import ToolbarIconButton, {
  NotebookIcon,
} from "@/components/workspace/NotebookToolbarIconButton";
import NotebookViewport, {
  type NotebookViewportPreview,
} from "@/components/workspace/NotebookViewport";
import {
  Button,
  ButtonLink,
  EmptyState,
  FeedbackBanner,
  Skeleton,
} from "@/components/ui";
import type { Feedback } from "@/lib/app/feedback";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { PHONE_LAYOUT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useNotebookEditorShell, useNotebookPageUrl } from "@/hooks/useNotebookEditorShell";
import { useNotebookExitGuard } from "@/hooks/useNotebookExitGuard";
import { useNotebookKeyboardShortcuts } from "@/hooks/useNotebookKeyboardShortcuts";
import { useNotebookLoader } from "@/hooks/useNotebookLoader";
import { useNotebookInkController } from "@/hooks/useNotebookInkController";
import { useNotebookPageManagement } from "@/hooks/useNotebookPageManagement";
import { useNotebookPageState } from "@/hooks/useNotebookPageState";
import { useNotebookPageTrack } from "@/hooks/useNotebookPageTrack";
import {
  useNotebookPersistenceController,
  type NotebookPageSaveResult,
} from "@/hooks/useNotebookPersistenceController";
import { useNotebookPlacedItems } from "@/hooks/useNotebookPlacedItems";
import { useNotebookTextBlockController } from "@/hooks/useNotebookTextBlockController";
import { useNotebookToolbarDocking } from "@/hooks/useNotebookToolbarDocking";
import { useNotebookToolSettings } from "@/hooks/useNotebookToolSettings";
import { useNotebookViewportController } from "@/hooks/useNotebookViewportController";
import { usePracticePaperStatus } from "@/hooks/usePracticePaperStatus";
import { usePracticePaperRetake } from "@/hooks/usePracticePaperRetake";
import {
  useNotebookDrawingToolState,
  useNotebookNavigationState,
  useNotebookPageCreationState,
  useNotebookPanelState,
} from "@/hooks/useNotebookWorkspaceState";
import { useNotebookAssistantContext } from "@/hooks/useNotebookAssistantContext";
import { useFolderSheetChoices, useNotebookSheets } from "@/hooks/useNotebookSheet";
import NotebookSheetPanel, { useNotebookSheetFrames } from "@/components/workspace/NotebookSheetPanel";
import NotebookSheetPicker from "@/components/workspace/NotebookSheetPicker";
import { onScreenFloatingRects } from "@/components/ai/JamiFloatingTutor";
import {
  MAX_NOTEBOOK_SHEETS,
  notebookSheetFromAttachment,
  notebookSheetsFromNotebookFiles,
  type NotebookSheet,
} from "@/lib/workspace/notebook-sheet";
import type { TutorAttachment } from "@/lib/ai/tutor-attachments";
import type {
  NotebookFile,
  NotebookPage,
  NotebookTextBlock,
} from "@/lib/workspace/notebooks";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";
import {
  getNotebookPageStyleBackground,
  makeNotebookTextBlockId,
  normalizeNotebookStrokes,
} from "@/lib/workspace/notebook-page-content";
import { createNotebookAnswerBlock } from "@/lib/workspace/notebook-answer-block";
import {
  getNotebookSwipePreviewDirection,
  isNotebookPageSwipePreviewEnabled,
  resolveNotebookCarouselPages,
  shouldShowNotebookNewPagePreview,
} from "@/lib/workspace/notebook-carousel";
import {
  clearNotebookNativeSelection,
  installNotebookStylusTouchListeners,
  safelyReleasePointerCapture,
  safelySetPointerCapture,
} from "@/lib/workspace/notebook-interaction-lock";
import {
  clampNotebookPagePan,
  getHighlighterWidthFromPercent,
  getNotebookCreatePagePull,
  getNotebookPageDragIntent,
  getNotebookPageIndexAfterSwipe,
  getNotebookSwipeDragOffset,
  getNotebookSwipeDirection,
  getNotebookSwipeReleaseDecision,
  getNotebookSwipeSettleDuration,
  getNotebookSwipeVelocity,
  getPenWidthFromPercent,
  isNotebookViewportZoomedIn,
  shouldCreateNotebookPageOnRelease,
  mapClientPointToNotebookPage,
  shouldPointerSwipePages,
  shouldSuppressTouchAfterStylus,
  type NotebookPageDragIntent,
} from "@/lib/workspace/notebook-inking";
import {
  getNotebookInkRenderWindow,
  isWholeNotebookInkSheet,
} from "@/lib/workspace/notebook-ink-window";
import {
  createNotebookPage,
} from "@/services/study/notebooks";
import {
  legacyStrokesToJsDrawSvg,
} from "@/lib/workspace/notebook-ink-data";
import { pageHasUnloadedInk } from "@/lib/workspace/notebook-page-ink-split";
import { resolveNotebookPageBackgroundFileId } from "@/lib/workspace/notebook-pdf";
import { getNotebookAssistantQuickActions } from "@/lib/workspace/notebook-assistant";
import { recordPracticePaperTutorUse } from "@/services/study/practice-papers";
import {
  trackNotebookPdfCanvas,
  type NotebookPdfCanvasTracking,
} from "@/lib/workspace/notebook-pdf-canvas";
import {
  notebookToolMovesPlacedItems,
} from "@/lib/workspace/notebook-page-state";

type Point = { x: number; y: number };
type PageSwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  lastX: number;
  lastY: number;
  samples: Array<{ x: number; time: number }>;
  axis: "horizontal" | "vertical" | null;
  intent: NotebookPageDragIntent | null;
  completed: boolean;
};
const CANVAS_WIDTH = NOTEBOOK_PAGE_COORDINATE_WIDTH;
const CANVAS_HEIGHT = NOTEBOOK_PAGE_COORDINATE_HEIGHT;
/** How recently the Pencil was writing for a touch to count as the palm holding it. */
const RECENT_PENCIL_MS = 5_000;

/** Where a pointer landed, in page coordinates, or null on a collapsed element. */
function getNotebookPointFromEvent(event: ReactPointerEvent<HTMLElement>): Point | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return mapClientPointToNotebookPage({
    clientX: event.clientX,
    clientY: event.clientY,
    rect,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  });
}

export default function NotebookEditorPage() {
  const { user } = useUser();
  const userId = user.uid;
  const params = useParams<{ notebookId?: string | string[] }>();
  const notebookId = Array.isArray(params.notebookId)
    ? params.notebookId[0]
    : params.notebookId;
  // Shared page state lives in one store so its committed value and its
  // render value cannot drift. Read it with `pageState.read()` inside handlers.
  const { store: pageState, state: pageSnapshot } = useNotebookPageState();
  const { textBlocks, pageColor, pageStyle, saveStatus, tool } = pageSnapshot;
  const {
    setTextBlocks, setPageColor, setPageStyle, setSaveStatus, setTool,
  } = pageState;
  const {
    feedback,
    success,
    showError,
    showThrownError,
    clear: clearFeedback,
    clearIfShowing: clearFeedbackIfShowing,
  } = useFeedback();

  /** The loader reports a whole notice; route it to the right method. */
  const applyFeedback = useCallback(
    (next: Feedback | null) => {
      if (!next) {
        clearFeedback();
      } else if (next.type === "success") {
        success(next.message);
      } else {
        showError(next.message);
      }
    },
    [clearFeedback, showError, success]
  );

  const {
    notebook,
    setNotebook,
    pages,
    setPages,
    files,
    setFiles,
    fileUrls,
    hydratePageInk,
    resolvedImageFileIds,
    selectedPageId,
    setSelectedPageId,
    loading,
    loadFailed,
    takeRecoveredDraft,
    reload: reloadNotebook,
  } = useNotebookLoader({
    userId,
    notebookId,
    pageState,
    onFeedback: applyFeedback,
    onBeforeLoad: () => {
      resetViewportGestures();
      setPageZoom(1);
      setPagePan({ x: 0, y: 0 });
      editorRevisionRef.current = 0;
      resetSaveTracking();
    },
    onDraftRestored: () => setInkEditorMountRevision((current) => current + 1),
  });

  /*
   * Sheets kept beside the page -- question sheets or mark schemes to work
   * from without swiping away -- up to three, and the picker for choosing one.
   */
  const notebookSheets = useNotebookSheets(notebookId ?? "");
  const sheetFrames = useNotebookSheetFrames(
    notebookSheets.open,
    Array.from({ length: MAX_NOTEBOOK_SHEETS }, (_, slot) =>
      notebookSheets.sheets.some((kept) => kept.slot === slot)
    )
  );
  /** What the picker is choosing for: another sheet (no slot), or a different one in a panel. */
  const [sheetPicker, setSheetPicker] = useState<{ replaceSlot: number | null } | null>(null);
  const folderSheetChoices = useFolderSheetChoices({
    userId,
    folderId: notebook?.folderId ?? "",
    enabled: sheetPicker !== null,
  });
  const notebookSheetChoices = useMemo(() => notebookSheetsFromNotebookFiles(files), [files]);
  const keepSheetBeside = (sheet: NotebookSheet) => {
    // Measured before the new panel exists, so it lands clear of the Tutor
    // card, pinned answers and the other sheets rather than on top of one.
    const onScreen = onScreenFloatingRects();
    const { slot, added } = notebookSheets.add(sheet);
    if (added && onScreen.length > 0) sheetFrames[slot].moveClearOf(onScreen);
  };
  const handleKeepAttachmentBeside = (attachment: TutorAttachment) => {
    const sheet = notebookSheetFromAttachment(attachment);
    if (sheet) keepSheetBeside(sheet);
  };

  const inkEditorRef = useRef<NotebookInkEditorHandle | null>(null);

  const {
    inkReadyRef,
    inkInteractionActiveRef,
    stylusInteractionRef,
    stylusCooldownUntilRef,
    inkReady,
    inkHasContent,
    undoDepth,
    redoDepth,
    setInkReady,
    setInkHasContent,
    isInteracting: isInkInteracting,
    recordTextEdit: pushUndoAction,
    undo: handleUndo,
    redo: handleRedo,
    clearHistory: clearInkHistory,
    clearInk: clearPageInk,
    handleInkChange,
    handleInkHistoryChange,
    handleInteractionChange: handleInkInteractionChange,
    commitUi: flushInkUiSync,
    scheduleUiCommit: scheduleInkUiSync,
    cancelUiCommit: cancelInkUiSync,
  } = useNotebookInkController({
    pageState,
    inkEditorRef,
    onEdit: (options) => markPageUnsaved(options),
    resetTextBlockInteraction: () => resetTextBlockInteraction(),
    onUiCommitted: () =>
      clearFeedbackIfShowing("Could not autosave this page."),
  });

  const drawingTools = useNotebookDrawingToolState();
  const {
    penColor, penThicknessPercent, highlighterColor, highlighterThicknessPercent,
    eraserMode, eraserWidth, scribbleToErase, penSettings,
    openMenu: openToolMenu, closeMenus: closeDrawingToolMenus,
    touchInkHintVisible, setTouchInkHintVisible,
  } = drawingTools;
  const {
    pageZoom, setPageZoom, pagePan, setPagePan,
    frameSize, setFrameSize, pageSwipeMotion, setPageSwipeMotion,
    pageSwipeInkSnapshot, setPageSwipeInkSnapshot,
  } = useNotebookNavigationState();
  const {
    createPageActive, setCreatePageActive, createPageProgress, setCreatePageProgress,
    creatingPage, setCreatingPage, createPageBounce, setCreatePageBounce,
    inkEditorMountRevision, setInkEditorMountRevision,
  } = useNotebookPageCreationState();
  const {
    assistantOpen, setAssistantOpen, pagesDrawerOpen, setPagesDrawerOpen,
    phoneFullEditing, setPhoneFullEditing,
  } = useNotebookPanelState();
  const isPhoneLayout = useMediaQuery(PHONE_LAYOUT_QUERY);
  const { practicePaperStatus, handlePracticePaperStatusChange } =
    usePracticePaperStatus(setAssistantOpen);
  const [practicePaperEditingLocked, setPracticePaperEditingLocked] = useState(false);
  const [practicePaperTutorLocked, setPracticePaperTutorLocked] = useState(false);
  const handlePracticePaperRetake = usePracticePaperRetake(pageState, setPages, setInkEditorMountRevision);
  const pageFrameRef = useRef<HTMLDivElement | null>(null);
  const pageTrackRef = useRef<HTMLDivElement | null>(null);
  const pagePreviewLayerRef = useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const activePdfCanvasTrackingRef = useRef<
    NotebookPdfCanvasTracking<HTMLCanvasElement>
  >({
    canvas: null,
    renderKey: null,
  });
  const pageNavigationTokenRef = useRef(0);
  const pageNavigationLockedRef = useRef(false);
  const pageCreationInFlightRef = useRef(false);
  const maybeFinishPageHandoffRef = useRef<() => void>(() => undefined);
  const handoffFinishAnimationFrameRef = useRef<number | null>(null);
  const activePageBackgroundReadyRef = useRef(true);
  const createPageActiveRef = useRef(false);
  const createPageAffordanceRef = useRef<HTMLDivElement | null>(null);
  const createPageIndicatorRef = useRef<HTMLDivElement | null>(null);
  const createPageProgressCircleRef = useRef<SVGCircleElement | null>(null);
  const pageSwipeRef = useRef<PageSwipeState | null>(null);
  const inkMountedUnloadedPageIdRef = useRef<string | null>(null);
  const editorRevisionRef = useRef(0);
  const ignoredTouchInkCountRef = useRef(0);
  const touchInkHintTimeoutRef = useRef<number | null>(null);
  const isPageNavigationLocked = useCallback(
    () => pageNavigationLockedRef.current,
    []
  );
  const fullNotebookEditingEnabled = !isPhoneLayout || phoneFullEditing;
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );
  const selectedPageIndex = useMemo(
    () => pages.findIndex((page) => page.id === selectedPage?.id),
    [pages, selectedPage?.id]
  );
  const notebookPageHasWork = useMemo(
    () =>
      Boolean(
        selectedPage?.typedContent?.trim() ||
          textBlocks.some((block) => block.text.trim()) ||
          inkHasContent ||
          selectedPage?.inkData?.svg ||
          (selectedPage?.strokeData?.strokes.length ?? 0) > 0 ||
          (selectedPage?.imageRefs.length ?? 0) > 0 ||
          (selectedPage?.graphBlocks.length ?? 0) > 0
      ),
    [inkHasContent, selectedPage, textBlocks]
  );
  const notebookAssistantQuickActions = useMemo(
    () => getNotebookAssistantQuickActions({ hasWork: notebookPageHasWork }),
    [notebookPageHasWork]
  );

  // Each time the page changes, the ink editor remounts and re-deserializes the
  // SVG. Mark ink as not-yet-ready so the static ink underlay shows until the
  // editor paints, then NotebookInkEditor's onReady clears it — no blank flash.
  useEffect(() => {
    inkReadyRef.current = false;
    setInkReady(false);
  }, [inkReadyRef, selectedPage?.id, setInkReady]);
  const hasMappedBackgroundPages = useMemo(
    () => pages.some((page) => Boolean(page.backgroundFileId)),
    [pages]
  );
  const previousPage = pages[selectedPageIndex - 1] ?? null;
  const nextPage = pages[selectedPageIndex + 1] ?? null;
  const carouselPages = resolveNotebookCarouselPages({
    motion: pageSwipeMotion,
    previousPage,
    nextPage,
  });
  const trackPreviousPage = carouselPages.previousPage;
  const trackNextPage = carouselPages.nextPage;
  // Ink is fetched separately from the page record. Until it lands, the canvas
  // is empty for that reason alone, so it must not accept new strokes: the
  // editor reads its SVG once at mount, and drawing here would mean saving a
  // near-blank page over the student's real drawing.
  const selectedPageInkUnloaded = selectedPage
    ? pageHasUnloadedInk(selectedPage)
    : false;
  const selectedPageInkSvg = useMemo(() => {
    if (!selectedPage) {
      return legacyStrokesToJsDrawSvg([], CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    return (
      selectedPage.inkData?.svg ??
      legacyStrokesToJsDrawSvg(
        normalizeNotebookStrokes(selectedPage.strokeData?.strokes),
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      )
    );
  }, [selectedPage]);
  const activeNotebookFile = useMemo(() => {
    const backgroundFileId = resolveNotebookPageBackgroundFileId({
      pageBackgroundFileId: selectedPage?.backgroundFileId,
      notebookUploadedFileId: notebook?.uploadedFileId,
      firstFileId: files[0]?.id,
      hasMappedPages: hasMappedBackgroundPages,
    });
    if (!backgroundFileId) return null;
    return files.find((file) => file.id === backgroundFileId) ?? null;
  }, [
    files,
    hasMappedBackgroundPages,
    notebook?.uploadedFileId,
    selectedPage?.backgroundFileId,
  ]);
  const activeNotebookFileUrl = activeNotebookFile ? fileUrls[activeNotebookFile.id] : undefined;
  const activePdfRenderKey =
    selectedPage &&
    activeNotebookFile?.fileType === "application/pdf" &&
    activeNotebookFile.storagePath
      ? `${selectedPage.id}:${activeNotebookFile.id}:${selectedPage.pdfPageIndex ?? 0}`
      : null;
  // Resolve any page's background file + URL (mirrors activeNotebookFile) so the
  // swipe preview can render the real adjacent page rather than a placeholder.
  const resolvePageBackground = useCallback(
    (page: NotebookPage | null | undefined) => {
      if (!page) return { file: null as NotebookFile | null, url: undefined };
      const backgroundFileId = resolveNotebookPageBackgroundFileId({
        pageBackgroundFileId: page.backgroundFileId,
        notebookUploadedFileId: notebook?.uploadedFileId,
        firstFileId: files[0]?.id,
        hasMappedPages: hasMappedBackgroundPages,
      });
      if (!backgroundFileId) {
        return { file: null as NotebookFile | null, url: undefined };
      }
      const file =
        files.find((entry) => entry.id === backgroundFileId) ?? null;
      return { file, url: file ? fileUrls[file.id] : undefined };
    },
    [files, fileUrls, hasMappedBackgroundPages, notebook?.uploadedFileId]
  );
  const trackPreviousBackground = resolvePageBackground(trackPreviousPage);
  const trackNextBackground = resolvePageBackground(trackNextPage);
  const {
    layout: viewportLayout,
    pageFit,
    pageWidthPx,
    pageHeightPx,
    pageTrackTravelDistance,
    pagePanLiveRef,
    isPinchActive,
    cancelPinchAnimationFrame: cancelPinchZoomAnimationFrame,
    resetPageSurfaceTransform,
    cancelActivePinch,
    resetViewportGestures,
    handleTouchPointerDown,
    handleTouchPointerMove,
    handleTouchPointerEnd,
  } = useNotebookViewportController({
    frameSize,
    pageZoom,
    pagePan,
    pageWidth: CANVAS_WIDTH,
    pageHeight: CANVAS_HEIGHT,
    setPageZoom,
    setPagePan,
    pageSurfaceRef,
    pageFrameRef,
    isNavigationLocked: isPageNavigationLocked,
    isStylusSuppressingTouch: () =>
      shouldSuppressTouchAfterStylus({
        stylusActive: stylusInteractionRef.current,
        cooldownUntil: stylusCooldownUntilRef.current,
        now: Date.now(),
      }),
    onPinchTakeover: () => cancelPageSwipeForPinch(),
    onClearSwipeCandidate: () => {
      pageSwipeRef.current = null;
    },
    onSwipeEnd: (event, options) => handleStopPageSwipe(event, options),
  });

  const {
    offsetRef: pageTrackOffsetRef,
    motionRef: pageSwipeMotionRef,
    updateSwipeMotion: updatePageSwipeMotion,
    setPreviewDirection: setPagePreviewDirection,
    setPreviewVisibility: setPagePreviewVisibility,
    captureInkSnapshot: capturePageSwipeInkSnapshot,
    markInkSnapshotReady: markPageSwipeInkSnapshotReady,
    writeOffset: writePageTrackOffset,
    queueOffset: queuePageTrackOffset,
    animateTo: animatePageTrackTo,
    handleTransitionEnd: handlePageTrackTransitionEnd,
    resolveTransition: resolvePageTrackTransition,
    cancelQueuedOffset: cancelQueuedPageTrackOffset,
    writeCreatePageProgress,
  } = useNotebookPageTrack({
    trackRef: pageTrackRef,
    previewLayerRef: pagePreviewLayerRef,
    createPageAffordanceRef,
    createPageIndicatorRef,
    createPageProgressCircleRef,
    getSelectedPageId: () => pageState.read().selectedPage?.id ?? null,
    // Prepared while the page was idle, so beginning a swipe does not pay for
    // an SVG export on the pointermove that starts it.
    getInkSnapshotSvg: () =>
      inkEditorRef.current?.serializeWarm() ?? selectedPageInkSvg,
    onSwipeMotionChange: setPageSwipeMotion,
    onInkSnapshotChange: setPageSwipeInkSnapshot,
  });

  const markActivePageBackgroundSettled = useCallback(() => {
    activePageBackgroundReadyRef.current = true;
    window.requestAnimationFrame(() => maybeFinishPageHandoffRef.current());
  }, []);

  const handleActivePdfRenderStateChange = useCallback(
    (status: "loading" | "ready" | "error") => {
      activePageBackgroundReadyRef.current = status !== "loading";
      if (status !== "loading") {
        window.requestAnimationFrame(() => maybeFinishPageHandoffRef.current());
      }
    },
    []
  );

  const handleAssistantOpenChange = useCallback((open: boolean) => {
    if (open) {
      // Here rather than on the toolbar button: the floating Tutor reopens from its own pill too.
      if (!assistantOpen && practicePaperStatus === "in_progress" && userId && notebook) {
        void recordPracticePaperTutorUse(userId, notebook.id).catch(() => undefined);
      }
      setPagesDrawerOpen(false);
      closeDrawingToolMenus();
    }
    setAssistantOpen(open);
  }, [
    assistantOpen,
    closeDrawingToolMenus,
    notebook,
    practicePaperStatus,
    userId,
    setAssistantOpen,
    setPagesDrawerOpen,
  ]);

  const getNotebookAssistantContext = useNotebookAssistantContext({
    pageState,
    notebook,
    selectedPageId: selectedPage?.id,
    activeNotebookFile,
    activePdfRenderKey,
    activePdfCanvasTrackingRef,
    inkEditorRef,
    inkReadyRef,
    inkInteractionActiveRef,
    editorRevisionRef,
  });

  // `selectedPage` is derived from the pages list, so the store has to be told
  // about it. Handlers read the open page through `pageState.read()`.
  useEffect(() => {
    pageState.selectPage(selectedPage);
  }, [pageState, selectedPage]);

  useEffect(() => {
    activePdfCanvasTrackingRef.current = {
      canvas: null,
      renderKey: null,
    };
  }, [activePdfRenderKey]);

  useEffect(() => {
    createPageActiveRef.current = createPageActive;
  }, [createPageActive]);

  useEffect(() => {
    if (!activeNotebookFile) {
      activePageBackgroundReadyRef.current = true;
      window.requestAnimationFrame(() => maybeFinishPageHandoffRef.current());
      return;
    }
    if (activeNotebookFile.fileType.startsWith("image/")) {
      const terminalWithoutImage =
        Boolean(resolvedImageFileIds[activeNotebookFile.id]) &&
        !activeNotebookFileUrl;
      activePageBackgroundReadyRef.current = terminalWithoutImage;
      if (terminalWithoutImage) {
        window.requestAnimationFrame(() => maybeFinishPageHandoffRef.current());
      }
      return;
    }
    const waitingForPdf =
      activeNotebookFile.fileType === "application/pdf" &&
      Boolean(activeNotebookFile.storagePath);
    activePageBackgroundReadyRef.current = !waitingForPdf;
    if (!waitingForPdf) {
      window.requestAnimationFrame(() => maybeFinishPageHandoffRef.current());
    }
  }, [
    activeNotebookFile,
    activeNotebookFileUrl,
    resolvedImageFileIds,
    selectedPage?.id,
  ]);

  useNotebookPageUrl(selectedPage?.id);

  useEffect(() => {
    const frame = pageFrameRef.current;
    if (!frame || typeof window === "undefined") return;

    const updateFrameSize = () => {
      const rect = frame.getBoundingClientRect();
      setFrameSize((previous) =>
        Math.abs(previous.width - rect.width) < 0.5 &&
        Math.abs(previous.height - rect.height) < 0.5
          ? previous
          : { width: rect.width, height: rect.height }
      );
    };

    updateFrameSize();
    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [loading, notebook?.id, setFrameSize]);

  // Keep the committed pan valid whenever the zoom or frame changes: centered
  // at fit zoom, and otherwise held inside the frame wherever the reader left it.
  useEffect(() => {
    setPagePan((previous) => {
      const next = clampNotebookPagePan({
        pan: previous,
        pageWidth: pageWidthPx,
        pageHeight: pageHeightPx,
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
        zoom: viewportLayout.zoom,
      });
      return next.x === previous.x && next.y === previous.y ? previous : next;
    });
  }, [frameSize, pageHeightPx, pageWidthPx, setPagePan, viewportLayout.zoom]);

  useEffect(() => {
    pagePanLiveRef.current = pagePan;
  }, [pagePan, pagePanLiveRef]);


  const handlePageSaved = useCallback((result: NotebookPageSaveResult) => {
    setPages((current) =>
      current.map((page) =>
        page.id === result.pageId
          ? {
              ...page,
              typedContent: result.typedContent.trim() || undefined,
              textBlocks: result.replaceStoredContent
                ? result.textBlocks
                : page.textBlocks,
              inkData: result.replaceStoredContent
                ? result.inkData
                : page.inkData,
              strokeData: result.replaceStoredContent
                ? undefined
                : page.strokeData,
              pageColor: result.replaceStoredContent
                ? result.pageColor
                : page.pageColor,
              pageStyle: result.replaceStoredContent
                ? result.pageStyle
                : page.pageStyle,
              status: result.status,
              contentRevision: result.contentRevision,
              updatedAt: result.updatedAt,
            }
          : page
      )
    );
    setNotebook((current) =>
      current
        ? {
            ...current,
            previewInkSvg:
              result.inkSvg.length <= 120_000 ? result.inkSvg : undefined,
            previewPageId: result.pageId,
            updatedAt: result.updatedAt,
          }
        : current
    );
  }, [setNotebook, setPages]);

  const {
    markPageUnsaved,
    saveCurrentPage,
    queueCurrentPageSaveForExit,
    persistCurrentPageDraftSync,
    schedulePendingWork,
    cancelScheduledWork: cancelScheduledPersistence,
    resetSaveTracking,
    hasSaveInFlight,
  } = useNotebookPersistenceController({
    pageState,
    userId,
    inkEditorRef,
    editorRevisionRef,
    isInkInteracting,
    fallbackInkSvg: selectedPageInkSvg,
    onPageSaved: handlePageSaved,
    onError: showError,
    onClearError: clearFeedbackIfShowing,
    commitUi: flushInkUiSync,
    scheduleUiCommit: scheduleInkUiSync,
  });

  const {
    selectedImageId,
    selectedGraphId,
    graphEditorTarget,
    setGraphEditorTarget,
    addingImage,
    clearSelection: clearPlacedItemSelection,
    currentImageRefsFor,
    currentGraphBlocksFor,
    handleIllustrationInserted,
    handleImagesCommit,
    handleAddImage,
    handleDeleteImage,
    handleGraphsCommit,
    handleSelectGraph,
    handleSelectImage,
    handleOpenNewGraph,
    handleSaveGraph,
    handleDeleteGraph,
    handleTutorGraphInsert,
  } = useNotebookPlacedItems({
    userId,
    notebookId,
    pageState,
    setPages,
    openPageId: selectedPage?.id,
    tool,
    isPhoneLayout,
    closeToolMenus: closeDrawingToolMenus,
    success,
    showError,
    showThrownError,
  });

  // With js-draw as the single ink engine, switching tools only updates the
  // desired style; NotebookInkEditor defers applying it while a pointer is
  // still down, so no flush/commit step is needed.
  const switchNotebookTool = setTool;

  const commitTextBlockHistory = useCallback(
    (previous: NotebookTextBlock[], next: NotebookTextBlock[]) => {
      pushUndoAction(previous, next);
    },
    [pushUndoAction]
  );

  const cancelCompetingPageGestures = useCallback(() => {
    pageSwipeRef.current = null;
    cancelActivePinch();
  }, [cancelActivePinch]);

  const handleTextBlockLimitReached = useCallback((maximum: number) => {
    showError(`A page can contain up to ${maximum} text boxes. Move or delete one before adding another.`);
  }, [showError]);

  const handleTextBlockCreated = useCallback(() => {
    // The text tool places exactly one box per activation.
    switchNotebookTool("select");
  }, [switchNotebookTool]);

  const {
    selectedTextBlockId,
    editingTextBlockId,
    openTextBlockOptionsId,
    activeTextGestureId,
    resetTextBlockInteraction,
    finishActiveTextBlockGesture,
    clearTextBlockSelection,
    selectTextBlock,
    stopEditingTextBlock,
    setTextBlockOptionsOpen,
    createTextBlockAtPoint,
    insertTextBlock,
    updateTextBlock,
    toggleTextBlockOutline,
    deleteTextBlock,
    handleTextBlockOptionsKeyDown,
    startTextBlockDrag,
    startTextBlockResize,
    resizeTextBlock,
    stopTextBlockResize,
    handleTextBlockPointerDown,
    handleTextBlockPointerMove,
    handleTextBlockPointerUp,
    handleTextBlockPointerCancel,
    handlePageSurfaceTextGestureMove,
    handlePageSurfaceTextGestureStop,
  } = useNotebookTextBlockController({
    editingEnabled: fullNotebookEditingEnabled,
    isNavigationLocked: isPageNavigationLocked,
    pageState,
    pageSurfaceRef,
    onChange: markPageUnsaved,
    onHistoryCommit: commitTextBlockHistory,
    onGestureStart: cancelCompetingPageGestures,
    onCreateLimitReached: handleTextBlockLimitReached,
    onCreateComplete: handleTextBlockCreated,
    onTouchPointerDown: handleTouchPointerDown,
    onTouchPointerMove: handleTouchPointerMove,
    onTouchPointerEnd: handleTouchPointerEnd,
  });

  /**
   * Nothing on the page is selected any more.
   *
   * A page holds three kinds of placed thing -- text boxes, images and graphs
   * -- and they were being let go of in different places and at different
   * times. Tapping the page dropped a text box and left an image selected with
   * its handles up, because the only thing tapping away called was the text
   * controller's own clear. Selection is one idea to the person doing it, so
   * there is one way to end it.
   */
  const clearPlacedSelection = useCallback(() => {
    /*
     * Only what is actually selected. A pen calls this as it lands, on every
     * stroke, and setting state to the value it already holds is not free:
     * straight after any other update -- the undo buttons catching up with the
     * last stroke, say -- React renders this whole page once to find out that
     * nothing changed, in the moment the next stroke is starting.
     */
    if (
      selectedTextBlockId !== null ||
      editingTextBlockId !== null ||
      openTextBlockOptionsId !== null
    ) {
      clearTextBlockSelection();
    }
    clearPlacedItemSelection();
  }, [
    clearPlacedItemSelection,
    clearTextBlockSelection,
    editingTextBlockId,
    openTextBlockOptionsId,
    selectedTextBlockId,
  ]);

  const {
    confirmRequest,
    deletingPageId,
    requestDeletePage,
    requestClearPage,
    dismissRequest,
    confirmPendingRequest,
    openAddPages,
    addPagesDialog,
  } = useNotebookPageManagement({
    userId,
    notebook,
    pages,
    pageState,
    loader: {
      setPages,
      setFiles,
      setNotebook,
      selectedPageId,
      setSelectedPageId,
      hydratePageInk,
    },
    saveCurrentPage,
    editingEnabled: fullNotebookEditingEnabled,
    clearPageInk,
    resetTextBlockInteraction,
    feedback: { success, showError, showThrownError, clear: clearFeedback },
  });

  const {
    handleSelectDrawingTool,
    handleToggleTextTool,
    pen: penToolSettings,
    highlighter: highlighterToolSettings,
    eraser: eraserToolSettings,
  } = useNotebookToolSettings({
    tools: drawingTools,
    pageColor,
    pageState,
    inkEditorRef,
    inkHasContent,
    clearPlacedSelection,
    onRequestClearPage: requestClearPage,
  });

  useEffect(() => {
    if (!selectedPage) {
      setTextBlocks([]);
      resetTextBlockInteraction();
      clearInkHistory();
      setInkHasContent(false);
      pageState.resetHydration();
      return;
    }

    if (pageState.read().hydratedPageId === selectedPage.id) {
      return;
    }

    setTextBlocks(selectedPage.textBlocks);
    resetTextBlockInteraction();
    clearInkHistory();
    setInkHasContent(
      Boolean(selectedPage.inkData?.svg) || (selectedPage.strokeData?.strokes.length ?? 0) > 0
    );
    setPageColor(selectedPage.pageColor ?? notebook?.pageColor ?? "white");
    setPageStyle(selectedPage.pageStyle ?? notebook?.pageStyle ?? "plain");
    // Remember when the editor is mounting without this page's real ink, so the
    // canvas can be rebuilt from it once the fetch lands.
    inkMountedUnloadedPageIdRef.current = pageHasUnloadedInk(selectedPage)
      ? selectedPage.id
      : null;
    pageState.hydratePage(selectedPage.id, selectedPage.contentRevision);
    const recoveredDraft = takeRecoveredDraft(selectedPage.id);
    if (recoveredDraft) {
      editorRevisionRef.current = Math.max(1, recoveredDraft.localRevision);
      setSaveStatus("unsaved");
      success("Recovered unsaved work from this device. Syncing it now.");
      schedulePendingWork();
    } else {
      editorRevisionRef.current = 0;
      setSaveStatus("saved");
    }
    window.requestAnimationFrame(() => maybeFinishPageHandoffRef.current());
  }, [
    cancelInkUiSync,
    clearInkHistory,
    notebook?.pageColor,
    notebook?.pageStyle,
    pageState,
    resetTextBlockInteraction,
    schedulePendingWork,
    selectedPage,
    setInkHasContent,
    setPageColor,
    setPageStyle,
    setSaveStatus,
    setTextBlocks,
    success,
    takeRecoveredDraft,
  ]);

  /**
   * Rebuilds a canvas that mounted before its ink arrived.
   *
   * `NotebookInkEditor` reads `initialSvg` once, at mount, so ink that lands
   * afterwards would never reach it — and the next autosave would write that
   * empty canvas over the saved drawing. Remounting discards js-draw's undo
   * stack, so this only runs while there is demonstrably nothing to lose, which
   * the read-only gate on an unhydrated page guarantees.
   */
  useEffect(() => {
    const pendingPageId = inkMountedUnloadedPageIdRef.current;
    if (
      !selectedPage ||
      pendingPageId !== selectedPage.id ||
      pageHasUnloadedInk(selectedPage)
    ) {
      return;
    }
    inkMountedUnloadedPageIdRef.current = null;
    const inkEditor = inkEditorRef.current;
    if (inkEditor?.hasInk() || (inkEditor?.getHistoryState().undoDepth ?? 0) > 0) {
      return;
    }
    setInkEditorMountRevision((current) => current + 1);
  }, [selectedPage, setInkEditorMountRevision]);

  useNotebookEditorShell();

  useEffect(() => {
    const clearActiveInteractions = () => {
      finishActiveTextBlockGesture();
      stylusInteractionRef.current = false;
      stylusCooldownUntilRef.current = Date.now() + 180;
      // A pinch was interrupted (blur/app switch): drop its live transform
      // back to the last committed pan.
      cancelActivePinch({ clearPointers: true });
      // Teardown always resyncs pan, pinch or not, so an interrupted drag
      // cannot leave the committed pan behind the live one.
      setPagePan(pagePanLiveRef.current);
      if (
        pageSwipeRef.current ||
        pageSwipeMotionRef.current ||
        pageTrackOffsetRef.current !== 0
      ) {
        pageNavigationTokenRef.current += 1;
        cancelQueuedPageTrackOffset();
        if (handoffFinishAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(handoffFinishAnimationFrameRef.current);
          handoffFinishAnimationFrameRef.current = null;
        }
        resolvePageTrackTransition();
        const track = pageTrackRef.current;
        if (track) track.style.transition = "none";
        writePageTrackOffset(0);
        setPagePreviewVisibility(false);
        updatePageSwipeMotion(null);
        pageNavigationLockedRef.current = pageCreationInFlightRef.current;
      }
      pageSwipeRef.current = null;
      createPageActiveRef.current = false;
      setCreatePageActive(false);
      setCreatePageProgress(0);
      if (!pageCreationInFlightRef.current) {
        setCreatingPage(false);
      }
      setCreatePageBounce(false);
      if (typeof document !== "undefined") {
        clearNotebookNativeSelection(document);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearActiveInteractions();
      }
    };

    window.addEventListener("blur", clearActiveInteractions);
    window.addEventListener("pagehide", clearActiveInteractions);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", clearActiveInteractions);
      window.removeEventListener("pagehide", clearActiveInteractions);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (touchInkHintTimeoutRef.current !== null) {
        window.clearTimeout(touchInkHintTimeoutRef.current);
        touchInkHintTimeoutRef.current = null;
      }
      cancelPinchZoomAnimationFrame();
    };
  }, [
    cancelActivePinch,
    cancelPinchZoomAnimationFrame,
    cancelQueuedPageTrackOffset,
    finishActiveTextBlockGesture,
    pagePanLiveRef,
    pageSwipeMotionRef,
    pageTrackOffsetRef,
    resetPageSurfaceTransform,
    resolvePageTrackTransition,
    setCreatePageActive,
    setCreatePageBounce,
    setCreatePageProgress,
    setCreatingPage,
    setPagePan,
    setPagePreviewVisibility,
    stylusCooldownUntilRef,
    stylusInteractionRef,
    updatePageSwipeMotion,
    writePageTrackOffset,
  ]);

  /**
   * A second finger landed mid-swipe. Unwind the page track so the pinch
   * starts from a settled sheet instead of a half-committed swipe.
   */
  const cancelPageSwipeForPinch = useCallback(() => {
    if (!pageSwipeRef.current) return;
    cancelQueuedPageTrackOffset();
    const track = pageTrackRef.current;
    if (track) track.style.transition = "none";
    writePageTrackOffset(0);
    setPagePreviewVisibility(false);
    createPageActiveRef.current = false;
    setCreatePageActive(false);
    setCreatePageProgress(0);
    pageSwipeRef.current = null;
  }, [
    cancelQueuedPageTrackOffset,
    setCreatePageActive,
    setCreatePageProgress,
    setPagePreviewVisibility,
    writePageTrackOffset,
  ]);

  const pageSurfaceReady = Boolean(selectedPage?.id && pageFit.width > 0);

  useLayoutEffect(() => {
    const surface = pageSurfaceRef.current;
    if (
      !surface ||
      !selectedPage?.id ||
      !pageSurfaceReady ||
      typeof window === "undefined"
    ) {
      return;
    }

    // iPadOS Safari hijacks horizontal Apple Pencil movement for a native
    // scroll/back gesture even when `touch-action: none` is set — it fires a
    // pointercancel mid-stroke and then needs a frame to settle before the next
    // pointerdown is delivered, which is why a stroke right after a horizontal
    // one fails to register. touch-action is not honored for the Pencil here,
    // but suppressing the underlying touch-event default is. We only cancel for
    // stylus input (or while ink is being drawn) and never over a text editor
    // or an interactive control, so Pencil taps and finger navigation remain
    // native while bare-page ink still blocks Safari navigation gestures.
    return installNotebookStylusTouchListeners({
      surface,
      getInkInteractionActive: () => inkInteractionActiveRef.current,
    });
  }, [
    cancelQueuedPageTrackOffset,
    inkInteractionActiveRef,
    pageSurfaceReady,
    pageSwipeMotionRef,
    pageTrackOffsetRef,
    selectedPage?.id,
  ]);

  const prepareCurrentPageForNavigation = useCallback(async () => {
    if (inkEditorRef.current?.isInteracting() || inkInteractionActiveRef.current) return false;
    const { saveStatus } = pageState.read();
    const savePending =
      saveStatus === "saving" || saveStatus === "unsaved" || saveStatus === "failed";
    if (hasSaveInFlight() || savePending) return saveCurrentPage({ flush: true });
    return true;
  }, [hasSaveInFlight, inkInteractionActiveRef, pageState, saveCurrentPage]);

  const selectPageById = useCallback(
    async (pageId: string) => {
      if (pageId === pageState.read().selectedPage?.id) return true;
      if (pageNavigationLockedRef.current) return false;
      const ready = await prepareCurrentPageForNavigation();
      if (!ready) return false;
      // Ink first: selecting a page before its ink arrives would mount an
      // empty canvas that autosave could write over the saved drawing.
      if (!(await hydratePageInk(pageId))) return false;
      setSelectedPageId(pageId);
      return true;
    },
    [hydratePageInk, pageState, prepareCurrentPageForNavigation, setSelectedPageId]
  );

  const prefersReducedNotebookMotion = useCallback(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const clearPageTrackMotion = useCallback(
    (options: { invalidate?: boolean } = {}) => {
      if (options.invalidate !== false) {
        pageNavigationTokenRef.current += 1;
      }
      cancelQueuedPageTrackOffset();
      if (handoffFinishAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(handoffFinishAnimationFrameRef.current);
        handoffFinishAnimationFrameRef.current = null;
      }
      resolvePageTrackTransition();
      const track = pageTrackRef.current;
      if (track) track.style.transition = "none";
      writePageTrackOffset(0);
      setPagePreviewVisibility(false);
      updatePageSwipeMotion(null);
      pageNavigationLockedRef.current = pageCreationInFlightRef.current;
      pageSwipeRef.current = null;
      createPageActiveRef.current = false;
      setCreatePageActive(false);
      setCreatePageProgress(0);
      if (!pageCreationInFlightRef.current) {
        setCreatingPage(false);
      }
      setCreatePageBounce(false);
    },
    [
      cancelQueuedPageTrackOffset,
      resolvePageTrackTransition,
      setCreatePageActive,
      setCreatePageBounce,
      setCreatePageProgress,
      setCreatingPage,
      setPagePreviewVisibility,
      updatePageSwipeMotion,
      writePageTrackOffset,
    ]
  );

  useEffect(() => {
    cancelActivePinch({ clearPointers: true, commitPan: true });
    const motion = pageSwipeMotionRef.current;
    if (motion?.phase === "handoff" && motion.direction) {
      const targetOffset =
        motion.direction === "next"
          ? -pageTrackTravelDistance
          : pageTrackTravelDistance;
      const track = pageTrackRef.current;
      if (track) track.style.transition = "none";
      writePageTrackOffset(targetOffset);
      updatePageSwipeMotion({ ...motion, targetOffset });
      return;
    }
    if (
      !pageSwipeRef.current &&
      !motion &&
      pageTrackOffsetRef.current === 0
    ) {
      return;
    }
    clearPageTrackMotion();
  }, [
    cancelActivePinch,
    cancelPinchZoomAnimationFrame,
    cancelQueuedPageTrackOffset,
    clearPageTrackMotion,
    frameSize.height,
    frameSize.width,
    pageSwipeMotionRef,
    pageTrackOffsetRef,
    pageTrackTravelDistance,
    resetPageSurfaceTransform,
    updatePageSwipeMotion,
    writePageTrackOffset,
  ]);

  const maybeFinishPageHandoff = useCallback(() => {
    const motion = pageSwipeMotionRef.current;
    if (
      motion?.phase !== "handoff" ||
      !motion.targetPage ||
      pageState.read().selectedPage?.id !== motion.targetPage.id ||
      pageState.read().hydratedPageId !== motion.targetPage.id ||
      !inkReadyRef.current ||
      !activePageBackgroundReadyRef.current ||
      handoffFinishAnimationFrameRef.current !== null
    ) {
      return;
    }
    handoffFinishAnimationFrameRef.current = window.requestAnimationFrame(() => {
      handoffFinishAnimationFrameRef.current = null;
      const currentMotion = pageSwipeMotionRef.current;
      if (
        currentMotion?.phase !== "handoff" ||
        !currentMotion.targetPage ||
        currentMotion.targetPage.id !== pageState.read().selectedPage?.id ||
        pageState.read().hydratedPageId !== currentMotion.targetPage.id ||
        !inkReadyRef.current ||
        !activePageBackgroundReadyRef.current
      ) {
        return;
      }
      const track = pageTrackRef.current;
      if (track) track.style.transition = "none";
      writePageTrackOffset(0);
      setPagePreviewVisibility(false);
      updatePageSwipeMotion(null);
      pageNavigationLockedRef.current = false;
      createPageActiveRef.current = false;
      setCreatePageActive(false);
      setCreatePageProgress(0);
      setCreatingPage(false);
    });
  }, [
    inkReadyRef,
    pageState,
    pageSwipeMotionRef,
    setCreatePageActive,
    setCreatePageProgress,
    setCreatingPage,
    setPagePreviewVisibility,
    updatePageSwipeMotion,
    writePageTrackOffset,
  ]);
  // Readers call it from a later animation frame, so the committed handler is
  // always in place by then.
  useLayoutEffect(() => {
    maybeFinishPageHandoffRef.current = maybeFinishPageHandoff;
  }, [maybeFinishPageHandoff]);

  const beginPageHandoff = useCallback(
    (
      targetPage: NotebookPage,
      direction: "next" | "previous",
      kind: "page" | "create",
      token: number
    ) => {
      const background = resolvePageBackground(targetPage).file;
      inkReadyRef.current = false;
      activePageBackgroundReadyRef.current = !(
        background?.fileType.startsWith("image/") ||
        (background?.fileType === "application/pdf" &&
          background.storagePath)
      );
      updatePageSwipeMotion({
        phase: "handoff",
        kind,
        direction,
        targetPage,
        targetOffset: pageTrackOffsetRef.current,
        durationMs: 0,
      });
      window.requestAnimationFrame(() => {
        if (pageNavigationTokenRef.current !== token) return;
        setSelectedPageId(targetPage.id);
      });
    },
    [
      inkReadyRef,
      pageTrackOffsetRef,
      resolvePageBackground,
      setSelectedPageId,
      updatePageSwipeMotion,
    ]
  );

  const returnPageTrackToSource = useCallback(
    async (velocityX: number, token: number) => {
      const durationMs = getNotebookSwipeSettleDuration({
        currentOffset: pageTrackOffsetRef.current,
        targetOffset: 0,
        travelDistance: pageTrackTravelDistance,
        velocityX,
        reducedMotion: prefersReducedNotebookMotion(),
      });
      await animatePageTrackTo({
        phase: "returning",
        kind: "cancel",
        direction: null,
        targetPage: null,
        targetOffset: 0,
        durationMs,
      });
      if (pageNavigationTokenRef.current !== token) return;
      clearPageTrackMotion({ invalidate: false });
    },
    [
        animatePageTrackTo,
        clearPageTrackMotion,
        pageTrackOffsetRef,
        pageTrackTravelDistance,
        prefersReducedNotebookMotion,
      ]
  );

  const runPageTrackNavigation = useCallback(
    async (
      targetPage: NotebookPage,
      direction: "next" | "previous",
      velocityX: number
    ) => {
      if (pageNavigationLockedRef.current || pageTrackTravelDistance <= 0) {
        return false;
      }
      pageNavigationLockedRef.current = true;
      const token = pageNavigationTokenRef.current + 1;
      pageNavigationTokenRef.current = token;
      const targetOffset =
        direction === "next"
          ? -pageTrackTravelDistance
          : pageTrackTravelDistance;
      const durationMs = getNotebookSwipeSettleDuration({
        currentOffset: pageTrackOffsetRef.current,
        targetOffset,
        travelDistance: pageTrackTravelDistance,
        velocityX,
        reducedMotion: prefersReducedNotebookMotion(),
      });
      // Ink first, exactly as `selectPageById` does: opening a page before its
      // ink arrives would mount an empty canvas that autosave could later write
      // over the saved drawing. Neighbour prefetch usually makes this instant,
      // and it runs against the settle animation rather than after it.
      const readyPromise = Promise.all([
        prepareCurrentPageForNavigation(),
        hydratePageInk(targetPage.id),
      ]).then(([saved, hydrated]) => saved && hydrated);
      const settlePromise = animatePageTrackTo({
        phase: "settling",
        kind: "page",
        direction,
        targetPage,
        targetOffset,
        durationMs,
      });
      let ready = false;
      try {
        [ready] = await Promise.all([readyPromise, settlePromise]);
      } catch (error) {
        console.error("Could not prepare the notebook page change.", error);
        showThrownError(error, "Could not save this page before changing pages.");
        if (pageNavigationTokenRef.current === token) {
          await returnPageTrackToSource(velocityX, token);
        }
        return false;
      }
      if (pageNavigationTokenRef.current !== token) return false;
      if (!ready) {
        await returnPageTrackToSource(velocityX, token);
        return false;
      }
      beginPageHandoff(targetPage, direction, "page", token);
      return true;
    },
    [
      animatePageTrackTo,
      beginPageHandoff,
      hydratePageInk,
      pageTrackOffsetRef,
      pageTrackTravelDistance,
      prefersReducedNotebookMotion,
      prepareCurrentPageForNavigation,
      returnPageTrackToSource,
      showThrownError,
    ]
  );

  const selectPageByOffset = useCallback(
    async (offset: -1 | 1) => {
      if (selectedPageIndex < 0 || pageNavigationLockedRef.current) return false;
      const direction = offset === 1 ? "next" : "previous";
      const nextIndex = getNotebookPageIndexAfterSwipe({
        currentIndex: selectedPageIndex,
        pageCount: pages.length,
        direction,
      });
      if (nextIndex === selectedPageIndex) return false;
      const targetPage = pages[nextIndex];
      if (!targetPage) return false;
      return runPageTrackNavigation(
        targetPage,
        direction,
        direction === "next" ? -2 : 2
      );
    },
    [pages, runPageTrackNavigation, selectedPageIndex]
  );

  const { handleExitNotebook, handleRetryPageSave } = useNotebookExitGuard({
    pageState,
    saveStatus,
    persistence: {
      saveCurrentPage,
      persistCurrentPageDraftSync,
      queueCurrentPageSaveForExit,
    },
    isInkInteracting,
    cancelInkUiCommit: cancelInkUiSync,
    showError,
  });

  const createBlankPageAtEnd = useCallback(async (velocityX = -2) => {
    if (
      pageNavigationLockedRef.current ||
      pageCreationInFlightRef.current ||
      pageTrackTravelDistance <= 0
    ) {
      return false;
    }
    if (!userId || !notebook) {
      pageNavigationLockedRef.current = true;
      const token = pageNavigationTokenRef.current + 1;
      pageNavigationTokenRef.current = token;
      await returnPageTrackToSource(velocityX, token);
      return false;
    }
    const lastPage = pages[pages.length - 1];
    // A new page is on the notebook's own paper. Copying the page being left
    // gave a PDF notebook's added pages the PDF page's plain white, whatever
    // paper the student chose for the notebook.
    const pageColorValue = notebook.pageColor ?? "white";
    const pageStyleValue = notebook.pageStyle ?? "plain";
    const nextPageNumber = (lastPage?.pageNumber ?? pages.length) + 1;

    pageNavigationLockedRef.current = true;
    pageCreationInFlightRef.current = true;
    const token = pageNavigationTokenRef.current + 1;
    pageNavigationTokenRef.current = token;
    setCreatingPage(true);
    createPageActiveRef.current = true;
    setCreatePageActive(true);
    setCreatePageProgress(1);
    setCreatePageBounce(true);
    window.setTimeout(() => setCreatePageBounce(false), 420);
    const targetOffset = -pageTrackTravelDistance;
    const durationMs = getNotebookSwipeSettleDuration({
      currentOffset: pageTrackOffsetRef.current,
      targetOffset,
      travelDistance: pageTrackTravelDistance,
      velocityX,
      reducedMotion: prefersReducedNotebookMotion(),
    });
    const createPromise = (async () => {
      const ready = await prepareCurrentPageForNavigation();
      if (!ready) return null;
      return createNotebookPage(userId, {
        notebookId: notebook.id,
        folderId: notebook.folderId,
        pageNumber: nextPageNumber,
        pageType: "blank",
        pageColor: pageColorValue,
        pageStyle: pageStyleValue,
        status: "blank",
      });
    })();
    const settlePromise = animatePageTrackTo({
      phase: "settling",
      kind: "create",
      direction: "next",
      targetPage: null,
      targetOffset,
      durationMs,
    });
    try {
      const [newPage] = await Promise.all([createPromise, settlePromise]);
      pageCreationInFlightRef.current = false;
      if (pageNavigationTokenRef.current !== token) {
        if (newPage) {
          setPages((current) =>
            [...current.filter((page) => page.id !== newPage.id), newPage].sort(
              (a, b) => a.pageNumber - b.pageNumber
            )
          );
        }
        pageNavigationLockedRef.current = false;
        setCreatingPage(false);
        return Boolean(newPage);
      }
      if (!newPage) {
        await returnPageTrackToSource(velocityX, token);
        setCreatingPage(false);
        return false;
      }
      setPages((current) =>
        [...current.filter((page) => page.id !== newPage.id), newPage].sort(
          (a, b) => a.pageNumber - b.pageNumber
        )
      );
      beginPageHandoff(newPage, "next", "create", token);
      return true;
    } catch (error) {
      pageCreationInFlightRef.current = false;
      console.error("Could not add a notebook page.", error);
      showThrownError(error, "Could not add a new page.");
      if (pageNavigationTokenRef.current === token) {
        await returnPageTrackToSource(velocityX, token);
      } else {
        pageNavigationLockedRef.current = false;
      }
      setCreatingPage(false);
      createPageActiveRef.current = false;
      setCreatePageActive(false);
      setCreatePageProgress(0);
      return false;
    }
  }, [
    animatePageTrackTo,
    beginPageHandoff,
    notebook,
    pageTrackOffsetRef,
    pageTrackTravelDistance,
    pages,
    prefersReducedNotebookMotion,
    prepareCurrentPageForNavigation,
    returnPageTrackToSource,
    setCreatePageActive,
    setCreatePageBounce,
    setCreatePageProgress,
    setCreatingPage,
    setPages,
    showThrownError,
    userId,
  ]);

  /**
   * Runs a flick that was held while the previous turn settled.
   *
   * Resolved against the page the queue actually landed on, so the gesture ends
   * up doing what it would have done on an idle track -- including making a new
   * page when it was a hard pull past the end of the notebook.
   */
  const handleStartPageSwipe = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      !fullNotebookEditingEnabled ||
      !shouldPointerSwipePages(event.pointerType) ||
      pageNavigationLockedRef.current ||
      inkInteractionActiveRef.current ||
      activeTextGestureId
    ) {
      return;
    }
    pagePanLiveRef.current = { ...viewportLayout.pageOrigin };
    pageSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      samples: [{ x: event.clientX, time: event.timeStamp }],
      axis: null,
      intent: null,
      completed: false,
    };
    safelySetPointerCapture(event.currentTarget, event.pointerId);
  }, [
    activeTextGestureId,
    fullNotebookEditingEnabled,
    inkInteractionActiveRef,
    pagePanLiveRef,
    viewportLayout.pageOrigin,
  ]);

  const handlePageSwipeMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId || swipe.completed) return;

    swipe.currentX = event.clientX;
    swipe.currentY = event.clientY;
    swipe.lastX = event.clientX;
    swipe.lastY = event.clientY;
    swipe.samples = [
      ...swipe.samples,
      { x: event.clientX, time: event.timeStamp },
    ]
      .filter((sample) => event.timeStamp - sample.time <= 120)
      .slice(-24);

    const totalDx = swipe.currentX - swipe.startX;
    const totalDy = swipe.currentY - swipe.startY;
    if (swipe.axis === null && Math.max(Math.abs(totalDx), Math.abs(totalDy)) >= 8) {
      if (Math.abs(totalDx) > Math.abs(totalDy) * 1.05) {
        swipe.axis = "horizontal";
      } else if (Math.abs(totalDy) > Math.abs(totalDx) * 1.15) {
        swipe.axis = "vertical";
      }
      if (swipe.axis) {
        swipe.intent = getNotebookPageDragIntent({
          axis: swipe.axis,
          zoom: viewportLayout.zoom,
        });
        if (swipe.intent === "page") {
          setPagePreviewVisibility(true);
        }
      }
    }

    if (swipe.intent === "none") {
      event.preventDefault();
      return;
    }

    if (swipe.intent !== "page") return;

    capturePageSwipeInkSnapshot();
    setPagePreviewDirection(getNotebookSwipePreviewDirection(totalDx));

    // Forward pull past the last page → engage the "create new page" affordance.
    if (selectedPageIndex === pages.length - 1 && totalDx < 0) {
      const pageWidth = pageSurfaceRef.current?.getBoundingClientRect().width ?? 1;
      const { progress, resistedOffset } = getNotebookCreatePagePull({
        totalDx,
        pageWidth,
      });
      if (!createPageActiveRef.current) {
        createPageActiveRef.current = true;
        setCreatePageActive(true);
        setCreatePageProgress(progress);
      } else {
        writeCreatePageProgress(progress);
      }
      queuePageTrackOffset(resistedOffset);
      event.preventDefault();
      return;
    }
    createPageActiveRef.current = false;
    setCreatePageActive(false);
    setCreatePageProgress(0);
    queuePageTrackOffset(
      getNotebookSwipeDragOffset({
        totalDx,
        currentIndex: selectedPageIndex,
        pageCount: pages.length,
      })
    );
    event.preventDefault();
  }, [
    capturePageSwipeInkSnapshot,
    pages.length,
    queuePageTrackOffset,
    selectedPageIndex,
    setCreatePageActive,
    setCreatePageProgress,
    setPagePreviewDirection,
    setPagePreviewVisibility,
    viewportLayout.zoom,
    writeCreatePageProgress,
  ]);

  const handleStopPageSwipe = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    options: { allowTextTap?: boolean; cancelled?: boolean } = {}
  ) => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    safelyReleasePointerCapture(event.currentTarget, event.pointerId);
    pageSwipeRef.current = null;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;

    const pageWidth = pageSurfaceRef.current?.getBoundingClientRect().width ?? 1;
    const velocityX = getNotebookSwipeVelocity([
      ...swipe.samples,
      { x: event.clientX, time: event.timeStamp },
    ]);
    // A release can arrive before any move resolved an axis, so the same
    // fitted-view rule is applied to the raw delta.
    const horizontalGesture =
      swipe.intent === "page" ||
      (swipe.intent === null &&
        !isNotebookViewportZoomedIn(viewportLayout.zoom) &&
        Math.abs(deltaX) > 8 &&
        Math.abs(deltaX) > Math.abs(deltaY) * 1.05);

    // Releasing a forward pull past the last page either creates a page or
    // rubber-bands back, depending on how far it was pulled (or a fast flick).
    if (
      horizontalGesture &&
      selectedPageIndex === pages.length - 1 &&
      deltaX < 0
    ) {
      event.preventDefault();
      createPageActiveRef.current = false;
      setCreatePageActive(false);
      if (
        !options.cancelled &&
        shouldCreateNotebookPageOnRelease({
          totalDx: deltaX,
          pageWidth,
          velocityX,
        })
      ) {
        swipe.completed = true;
        void createBlankPageAtEnd(velocityX);
      } else {
        pageNavigationLockedRef.current = true;
        const token = pageNavigationTokenRef.current + 1;
        pageNavigationTokenRef.current = token;
        void returnPageTrackToSource(velocityX, token);
      }
      return;
    }

    if (horizontalGesture) {
      event.preventDefault();
      const decision = options.cancelled
        ? {
            direction: null,
            targetIndex: selectedPageIndex,
            shouldCommit: false,
          }
        : getNotebookSwipeReleaseDecision({
            totalDx: deltaX,
            pageWidth,
            velocityX,
            currentIndex: selectedPageIndex,
            pageCount: pages.length,
          });
      const targetPage = decision.shouldCommit
        ? pages[decision.targetIndex]
        : null;
      if (targetPage && decision.direction) {
        swipe.completed = true;
        void runPageTrackNavigation(targetPage, decision.direction, velocityX);
      } else {
        pageNavigationLockedRef.current = true;
        const token = pageNavigationTokenRef.current + 1;
        pageNavigationTokenRef.current = token;
        void returnPageTrackToSource(velocityX, token);
      }
      return;
    }

    if (pageTrackOffsetRef.current !== 0) {
      pageNavigationLockedRef.current = true;
      const token = pageNavigationTokenRef.current + 1;
      pageNavigationTokenRef.current = token;
      void returnPageTrackToSource(velocityX, token);
      return;
    }
    setPagePreviewVisibility(false);

    if (
      !swipe.completed &&
      !options.cancelled &&
      Math.abs(deltaX) <= 8 &&
      Math.abs(deltaY) <= 8 &&
      tool === "text" &&
      options.allowTextTap &&
        event.currentTarget instanceof HTMLElement
    ) {
      const tapDirection = getNotebookSwipeDirection({
        startX: swipe.startX,
        startY: swipe.startY,
        currentX: event.clientX,
        currentY: event.clientY,
      });
      if (!tapDirection) {
        const point = getNotebookPointFromEvent(event);
        if (point) createTextBlockAtPoint(point);
      }
    }
  }, [
    createBlankPageAtEnd,
    createTextBlockAtPoint,
    pageTrackOffsetRef,
    pages,
    returnPageTrackToSource,
    runPageTrackNavigation,
    selectedPageIndex,
    setCreatePageActive,
    setPagePreviewVisibility,
    viewportLayout.zoom,
    tool,
  ]);

  const maybeShowIgnoredTouchInkHint = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.pointerType !== "touch" ||
      tool === "text" ||
      !fullNotebookEditingEnabled ||
      pageSwipeRef.current?.completed ||
      // A finger on a zoomed sheet is reaching for the viewport, not drawing.
      isNotebookViewportZoomedIn(viewportLayout.zoom) ||
      isPinchActive() ||
      /*
       * A hand that was just holding the Pencil is a palm, not somebody trying
       * to write with a finger. Counted, every third palm lift while writing
       * told a Pencil user to use their Pencil -- and re-rendered this whole
       * page twice to show and hide the hint, in the middle of their words.
       */
      Date.now() < stylusCooldownUntilRef.current + RECENT_PENCIL_MS
    ) {
      return;
    }
    ignoredTouchInkCountRef.current += 1;
    if (ignoredTouchInkCountRef.current < 3) return;
    ignoredTouchInkCountRef.current = 0;
    setTouchInkHintVisible(true);
    if (touchInkHintTimeoutRef.current !== null) {
      window.clearTimeout(touchInkHintTimeoutRef.current);
    }
    touchInkHintTimeoutRef.current = window.setTimeout(() => {
      setTouchInkHintVisible(false);
      touchInkHintTimeoutRef.current = null;
    }, 2600);
  }, [
    fullNotebookEditingEnabled,
    isPinchActive,
    setTouchInkHintVisible,
    stylusCooldownUntilRef,
    tool,
    viewportLayout.zoom,
  ]);

  /**
   * A tap anywhere in the page frame lets go of whatever was selected.
   *
   * The sheet is only part of what somebody is looking at: on a wide window or
   * a zoomed-out page there is a margin all round it, and tapping there is
   * "tapping somewhere else" by any reading. Nothing was listening out there,
   * so a selected image kept its handles up until the page itself was touched.
   *
   * Deliberately the last word rather than a special case for the margin. This
   * sits above the sheet in the tree, so anything that means to keep its
   * selection stops the event on the way up -- which is what every layer
   * already does when a placed thing is picked up. Being unconditional means a
   * gap in that coverage lets go of the selection rather than stranding it.
   */
  const handleFramePointerDown = useCallback(() => {
    if (!fullNotebookEditingEnabled) return;
    if (pageNavigationLockedRef.current) return;
    clearPlacedSelection();
  }, [clearPlacedSelection, fullNotebookEditingEnabled]);

  const handlePagePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!fullNotebookEditingEnabled) return;
    if (pageNavigationLockedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      // Everything else stays blocked while a turn settles, but a flick is
      // tracked so it can be queued instead of silently swallowed.
      if (shouldPointerSwipePages(event.pointerType)) {
        handleStartPageSwipe(event);
      }
      return;
    }
    closeDrawingToolMenus();
    clearPlacedSelection();
    if (handleTouchPointerDown(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStartPageSwipe(event);
      return;
    }

    if (tool !== "text") {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    // The new box is selected and ready to type in. Stopped here, or the
    // frame's tap-away below would let go of it in the same press -- which
    // left every new box unselected, its caret gone, and whatever was typed
    // next running the tool shortcuts instead.
    event.stopPropagation();
    const point = getNotebookPointFromEvent(event);
    if (!point) return;
    createTextBlockAtPoint(point);
  }, [
    clearPlacedSelection,
    closeDrawingToolMenus,
    createTextBlockAtPoint,
    fullNotebookEditingEnabled,
    handleStartPageSwipe,
    handleTouchPointerDown,
    tool,
  ]);

  const handlePagePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (handleTouchPointerMove(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handlePageSwipeMove(event);
    }
  }, [
    handlePageSwipeMove,
    handleTouchPointerMove,
  ]);

  const handlePagePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") {
      const swipe = pageSwipeRef.current;
      const direction = swipe
        ? getNotebookSwipeDirection({
            startX: swipe.startX,
            startY: swipe.startY,
            currentX: event.clientX,
            currentY: event.clientY,
          })
        : null;
      if (!direction) {
        maybeShowIgnoredTouchInkHint(event);
      }
    }
    if (handleTouchPointerEnd(event, { allowTextTap: true })) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStopPageSwipe(event, { allowTextTap: true });
    }
  }, [
    handleStopPageSwipe,
    handleTouchPointerEnd,
    maybeShowIgnoredTouchInkHint,
  ]);

  const handlePagePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (handleTouchPointerEnd(event, { cancelled: true })) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStopPageSwipe(event, { cancelled: true });
    }
  }, [
    handleStopPageSwipe,
    handleTouchPointerEnd,
  ]);

  useNotebookKeyboardShortcuts({
    enabled: fullNotebookEditingEnabled,
    readTool: () => pageState.read().tool,
    switchTool: switchNotebookTool,
    undo: handleUndo,
    redo: handleRedo,
    onEscape: () => {
      closeDrawingToolMenus();
      clearPlacedSelection();
    },
  });

  /** A Tutor answer, added to this page exactly as the Tutor showed it. */
  const handleTutorAnswerInsert = useCallback(
    (text: string) => {
      const { selectedPage: page, textBlocks: currentTextBlocks } = pageState.read();
      if (!page) return false;
      if (!fullNotebookEditingEnabled || practicePaperEditingLocked) {
        showError("This page can't be edited here, so the answer can't be added to it.");
        return false;
      }
      const result = createNotebookAnswerBlock({
        id: makeNotebookTextBlockId(),
        text,
        page: {
          textBlocks: currentTextBlocks,
          imageRefs: currentImageRefsFor(page.id),
          graphBlocks: currentGraphBlocksFor(page.id),
        },
      });
      if (!result.ok) {
        showError(result.message);
        return false;
      }
      const added = insertTextBlock(result.block);
      if (added) success("Answer added to this page.");
      return added;
    },
    [
      currentGraphBlocksFor,
      currentImageRefsFor,
      fullNotebookEditingEnabled,
      insertTextBlock,
      pageState,
      practicePaperEditingLocked,
      showError,
      success,
    ]
  );

  const handleToolbarUndo = useCallback(() => {
    closeDrawingToolMenus();
    handleUndo();
  }, [closeDrawingToolMenus, handleUndo]);

  const handleSelectPageFromDrawer = useCallback(
    (pageId: string) => {
      setPagesDrawerOpen(false);
      void selectPageById(pageId);
    },
    [selectPageById, setPagesDrawerOpen]
  );

  const handleCreatePageFromDrawer = useCallback(() => {
    void createBlankPageAtEnd();
  }, [createBlankPageAtEnd]);

  const handleTextBlockTextChange = useCallback(
    (blockId: string, text: string) => {
      updateTextBlock(blockId, { text });
    },
    [updateTextBlock]
  );

  // A box growing to hold its text is part of the typing that caused it, so
  // it goes through the same update as the typing does and never becomes an
  // undo step of its own.
  const handleTextBlockFitHeight = useCallback(
    (blockId: string, height: number) => {
      updateTextBlock(blockId, { height });
    },
    [updateTextBlock]
  );

  const handleToolbarRedo = useCallback(() => {
    closeDrawingToolMenus();
    handleRedo();
  }, [closeDrawingToolMenus, handleRedo]);

  const {
    dock: toolbarDock,
    toolbarRef: drawingToolbarRef,
    toolbarBindings,
  } = useNotebookToolbarDocking({
    frameRef: pageFrameRef,
    frameSize,
    onDragStarted: closeDrawingToolMenus,
    prefersReducedMotion: prefersReducedNotebookMotion,
  });

  if (loading) {
    return (
      <AppPage title="Notebook" backHref="/dashboard/folders" backLabel="Folders" width="3xl">
        <div className="space-y-5">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-[34rem] rounded-2xl" />
        </div>
      </AppPage>
    );
  }

  if (!notebook && loadFailed) {
    return (
      <AppPage title="Notebook" backHref="/dashboard/folders" backLabel="Folders" width="xl">
        <EmptyState
          emoji="Notebook"
          title="This notebook didn't open"
          description="Jami couldn't reach your notebook just now. Check your connection and try again."
          action={
            <Button onClick={() => void reloadNotebook()}>
              Try again
            </Button>
          }
        />
      </AppPage>
    );
  }

  if (!notebook) {
    return (
      <AppPage title="Notebook" backHref="/dashboard/folders" backLabel="Folders" width="xl">
        <EmptyState
          emoji="Notebook"
          title="Notebook not found"
          description="This notebook may have been removed or belongs to another workspace."
          action={
            <ButtonLink href="/dashboard/folders">
              Back to folders
            </ButtonLink>
          }
        />
      </AppPage>
    );
  }

  const pageSwipePreviewEnabled = isNotebookPageSwipePreviewEnabled(
    viewportLayout.zoom
  );
  const previousViewportPreview: NotebookViewportPreview | null =
    pageSwipePreviewEnabled && trackPreviousPage
      ? {
          key: trackPreviousPage.id,
          className:
            PAGE_COLOR_CLASS[
              trackPreviousPage.pageColor ?? notebook.pageColor ?? "white"
            ],
          content: (
            <NotebookPageStaticContent
              page={trackPreviousPage}
              notebook={notebook}
              backgroundFile={trackPreviousBackground.file}
              backgroundUrl={trackPreviousBackground.url}
            />
          ),
        }
      : null;
  const shouldShowNewPagePreview = shouldShowNotebookNewPagePreview({
    previewEnabled: pageSwipePreviewEnabled,
    hasNextPage: Boolean(trackNextPage),
    createPageActive,
    creatingPage,
    motionKind: pageSwipeMotion?.kind ?? null,
    fullEditingEnabled: fullNotebookEditingEnabled,
    selectedPageIndex,
    pageCount: pages.length,
  });
  const nextViewportPreview: NotebookViewportPreview | null =
    pageSwipePreviewEnabled && trackNextPage
    ? {
        key: trackNextPage.id,
        className:
          PAGE_COLOR_CLASS[
            trackNextPage.pageColor ?? notebook.pageColor ?? "white"
          ],
        content: (
          <NotebookPageStaticContent
            page={trackNextPage}
            notebook={notebook}
            backgroundFile={trackNextBackground.file}
            backgroundUrl={trackNextBackground.url}
          />
        ),
      }
    : shouldShowNewPagePreview
      ? {
          key: "new-page-preview",
          className: PAGE_COLOR_CLASS[pageColor],
          content: (
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={getNotebookPageStyleBackground(pageColor, pageStyle)}
            />
          ),
        }
      : null;
  const notebookViewportGeometry = {
    pageWidth: pageWidthPx,
    pageHeight: pageHeightPx,
    pageX: viewportLayout.pageOrigin.x,
    pageY: viewportLayout.pageOrigin.y,
    swipeTravel: pageTrackTravelDistance,
  };
  /*
   * Only the sheet being written on is clipped. The adjacent sheets in the
   * swipe track are only ever seen from the fitted view -- swiping is what one
   * finger does when the page is not zoomed -- and a fitted sheet is painted
   * whole anyway, so there is nothing here for them to gain.
   */
  const activeInkWindow = getNotebookInkRenderWindow({
    sheetWidth: pageWidthPx,
    sheetHeight: pageHeightPx,
    pageX: viewportLayout.pageOrigin.x,
    pageY: viewportLayout.pageOrigin.y,
    frameWidth: viewportLayout.frameSize.width,
    frameHeight: viewportLayout.frameSize.height,
  });
  /*
   * The part of an imported PDF to draw again at full sharpness when zoomed.
   * Tighter than the ink's window: a PDF slice is redrawn rarely, so it needs
   * little room to pan into, and each extra point costs a whole canvas pixel
   * per screen pixel. Nothing when the sheet is whole -- a fitted page is
   * already drawn at full density.
   */
  const pdfDetailSlice = getNotebookInkRenderWindow({
    sheetWidth: pageWidthPx,
    sheetHeight: pageHeightPx,
    pageX: viewportLayout.pageOrigin.x,
    pageY: viewportLayout.pageOrigin.y,
    frameWidth: viewportLayout.frameSize.width,
    frameHeight: viewportLayout.frameSize.height,
    overscan: 0.15,
    grid: 64,
  });
  const activePdfDetailWindow = isWholeNotebookInkSheet(pdfDetailSlice)
    ? null
    : pdfDetailSlice;

  return (
    <main
      data-app-surface="true"
      data-testid="notebook-editor"
      data-notebook-id={notebook.id}
      data-notebook-selected-page-id={selectedPage?.id ?? ""}
      data-notebook-ink-ready={inkReady ? "true" : "false"}
      data-notebook-has-ink={inkHasContent ? "true" : "false"}
      className="notebook-editor-shell fixed inset-0 z-[70] flex min-w-0 flex-col overflow-hidden bg-[var(--color-surface-base)] text-text-primary"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="z-40 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)]/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] shadow-e1 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/dashboard/folders/${notebook.folderId}`}
              onClick={(event) => void handleExitNotebook(event)}
              aria-label="Back to folder"
              title="Back to folder"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)]"
            >
              <NotebookIcon name="back" />
            </Link>
            <div data-tutorial-target="save-work" className="flex min-w-0 flex-1 items-center gap-2">
              <div className="truncate text-sm font-semibold text-text-primary">{notebook.title}</div>
              <NotebookSaveIndicator status={saveStatus} onRetry={handleRetryPageSave} />
            </div>
            <ToolbarIconButton
              label="Pages"
              icon="pages"
              active={pagesDrawerOpen}
              onClick={() => {
                closeDrawingToolMenus();
                const nextOpen = !pagesDrawerOpen;
                setPagesDrawerOpen(nextOpen);
                if (nextOpen) handleAssistantOpenChange(false);
              }}
            />
            {!practicePaperTutorLocked ? (
              <ToolbarIconButton
                label={
                  notebookSheets.sheets.length === 0
                    ? "Keep a sheet beside the page"
                    : notebookSheets.open
                      ? notebookSheets.sheets.length > 1 ? "Hide sheets" : "Hide sheet"
                      : notebookSheets.sheets.length > 1
                        ? `Show ${notebookSheets.sheets.length} sheets`
                        : `Show sheet: ${notebookSheets.sheets[0].sheet.title}`
                }
                icon="sheet"
                active={notebookSheets.open}
                pressed={notebookSheets.sheets.length > 0 ? notebookSheets.open : undefined}
                onClick={() => {
                  if (notebookSheets.sheets.length > 0) notebookSheets.setOpen(!notebookSheets.open);
                  else setSheetPicker({ replaceSlot: null });
                }}
              >
                {notebookSheets.sheets.length > 0 && !notebookSheets.open ? (
                  // Kept but hidden: one tap brings them back.
                  <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
                ) : null}
              </ToolbarIconButton>
            ) : null}
            {!practicePaperTutorLocked ? (
              <ToolbarIconButton
                label="Ask Jami" icon="ai"
                tutorialTarget="ask-tutor"
                active={assistantOpen}
                onClick={() => handleAssistantOpenChange(!assistantOpen)}
              />
            ) : null}
          </div>
          {notebook.type === "practice_paper" && userId ? (
            <PracticePaperAttemptBar
              userId={userId}
              notebookId={notebook.id}
              onStatusChange={handlePracticePaperStatusChange}
              onBeforeSubmit={prepareCurrentPageForNavigation}
              onRetake={handlePracticePaperRetake}
              onEditingLockChange={setPracticePaperEditingLocked}
              onTutorLockChange={setPracticePaperTutorLocked}
            />
          ) : null}
        </header>
        <div className="relative isolate min-h-0 flex-1 overflow-hidden">
        <NotebookToolSettingsPopover
          dock={toolbarDock}
          openMenu={openToolMenu}
          pen={penToolSettings}
          highlighter={highlighterToolSettings}
          eraser={eraserToolSettings}
        />

        {feedback ? (
          <div className="absolute left-3 right-3 top-3 z-50 mx-auto max-w-2xl">
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              onDismiss={() => clearFeedback()}
            />
          </div>
        ) : null}

        <NotebookAddPagesDialog {...addPagesDialog} />

        <NotebookPhoneLayoutNotice
          open={isPhoneLayout}
          fullEditing={phoneFullEditing}
          onToggleFullEditing={() => setPhoneFullEditing((value) => !value)}
        />

        {!practicePaperTutorLocked ? (
          <JamiAssistantDrawer
            userId={userId}
            open={assistantOpen}
            onOpenChange={handleAssistantOpenChange}
            layout="floating"
            // Keep one conversation across page turns; the current page is
            // still resolved fresh for every message.
            resetKey={`notebook:${notebook.id}`}
            contextKey={`notebook:${notebook.id}`}
            contextLabel="Current notebook page"
            historyContextLabel={notebook.title}
            getContext={getNotebookAssistantContext}
            quickActions={notebookAssistantQuickActions}
            settingsFolderIds={notebook.folderId ? [notebook.folderId] : []}
            onBeforeIllustrationInsert={() => saveCurrentPage({ flush: true })}
            onIllustrationInserted={handleIllustrationInserted}
            onGraphInsert={handleTutorGraphInsert}
            onDrawingInsert={handleAddImage}
            onAnswerInsert={handleTutorAnswerInsert}
            onKeepAttachmentBeside={handleKeepAttachmentBeside}
          />
        ) : null}
        {!practicePaperTutorLocked && notebookSheets.open
          ? notebookSheets.sheets.map((kept) => (
              <NotebookSheetPanel
                key={kept.slot}
                frame={sheetFrames[kept.slot]}
                sheet={kept.sheet}
                page={kept.page ?? 0}
                sheetCount={notebookSheets.sheets.length}
                onChange={() => setSheetPicker({ replaceSlot: kept.slot })}
                onPageChange={(page) => notebookSheets.setPage(kept.slot, page)}
                onAdd={
                  notebookSheets.sheets.length < MAX_NOTEBOOK_SHEETS
                    ? () => setSheetPicker({ replaceSlot: null })
                    : undefined
                }
                onHide={() => notebookSheets.setOpen(false)}
                onClose={() => notebookSheets.remove(kept.slot)}
              />
            ))
          : null}
        <NotebookSheetPicker
          open={sheetPicker !== null && !practicePaperTutorLocked}
          replacing={sheetPicker?.replaceSlot != null}
          firstSheet={notebookSheets.sheets.length === 0}
          notebookSheets={notebookSheetChoices}
          folderSheets={folderSheetChoices.sheets}
          folderLoading={folderSheetChoices.loading}
          folderFailed={folderSheetChoices.failed}
          keptPaths={notebookSheets.sheets.map((kept) => kept.sheet.storagePath)}
          onPick={(sheet) => {
            const replaceSlot = sheetPicker?.replaceSlot ?? null;
            if (replaceSlot !== null) notebookSheets.replace(replaceSlot, sheet);
            else keepSheetBeside(sheet);
            setSheetPicker(null);
          }}
          onCancel={() => setSheetPicker(null)}
        />
        <NotebookGraphEditorDialog
          open={graphEditorTarget !== null}
          graph={selectedPage?.graphBlocks.find((graph) => graph.id === graphEditorTarget) ?? null}
          onCancel={() => setGraphEditorTarget(null)}
          onSave={handleSaveGraph}
        />
        {pagesDrawerOpen ? (
          <NotebookPagesDrawer
            pages={pages}
            notebook={notebook}
            selectedPageId={selectedPage?.id ?? null}
            deletingPageId={deletingPageId}
            editingEnabled={fullNotebookEditingEnabled && !practicePaperEditingLocked}
            creatingPage={creatingPage}
            navigationBusy={Boolean(pageSwipeMotion)}
            resolvePageBackground={resolvePageBackground}
            onSelectPage={handleSelectPageFromDrawer}
            onCreatePage={handleCreatePageFromDrawer}
            onImportPages={openAddPages}
            onRequestDeletePage={requestDeletePage}
          />
        ) : null}

          <NotebookViewport
            onFramePointerDown={handleFramePointerDown}
            frameRef={pageFrameRef}
            trackRef={pageTrackRef}
            previewLayerRef={pagePreviewLayerRef}
            activeRef={pageSurfaceRef}
            geometry={notebookViewportGeometry}
            previousPreview={previousViewportPreview}
            nextPreview={nextViewportPreview}
            activeClassName={PAGE_COLOR_CLASS[pageColor]}
            onTrackTransitionEnd={handlePageTrackTransitionEnd}
            onTrackTransitionCancel={handlePageTrackTransitionEnd}
            onActivePointerMove={handlePageSurfaceTextGestureMove}
            onActivePointerUp={handlePageSurfaceTextGestureStop}
            onActivePointerCancel={handlePageSurfaceTextGestureStop}
            overlay={
              selectedPage ? (
                <NotebookQuestionOverlay page={selectedPage} dockedTop={toolbarDock === "top"} />
              ) : null
            }
            activeContent={
              selectedPage && pageFit.width > 0 ? (
                <>
                  <NotebookLivePageLayers
                    pageId={selectedPage.id}
                    pageWidth={CANVAS_WIDTH}
                    pageHeight={CANVAS_HEIGHT}
                    persistedInkSvg={selectedPageInkSvg}
                    hasPersistedInk={Boolean(
                      selectedPage.inkData?.svg ||
                        (selectedPage.strokeData?.strokes?.length ?? 0) > 0
                    )}
                    inkReady={inkReady}
                    editingEnabled={
                      fullNotebookEditingEnabled &&
                      !practicePaperEditingLocked &&
                      !selectedPageInkUnloaded
                    }
                    eraserWidth={eraserWidth}
                    inkEditorMountRevision={inkEditorMountRevision}
                    inkEditorRef={inkEditorRef}
                    swipeInkSnapshot={pageSwipeInkSnapshot}
                    onSwipeInkSnapshotReady={markPageSwipeInkSnapshotReady}
                    backgroundProps={{
                      pageColor,
                      pageStyle,
                      backgroundFile: activeNotebookFile,
                      backgroundUrl: activeNotebookFileUrl,
                      pageIndex: selectedPage.pdfPageIndex ?? 0,
                      imageStrategy: "next-image",
                      imageRenderKey: activeNotebookFile
                        ? `${selectedPage.id}:${activeNotebookFile.id}:image`
                        : undefined,
                      imageOnSettled: markActivePageBackgroundSettled,
                      imageLoadingLabel: "Loading file...",
                      imageSizes: "48rem",
                      imageClassName: "object-contain",
                      pdfRenderKey: activePdfRenderKey ?? undefined,
                      pdfAriaHidden: false,
                      pdfAriaLabel: activeNotebookFile
                        ? `Notebook file: ${activeNotebookFile.fileName}, page ${
                            (selectedPage.pdfPageIndex ?? 0) + 1
                          }`
                        : undefined,
                      pdfFadeIn: pageSwipeMotion?.phase !== "handoff",
                      pdfDetailWindow: activePdfDetailWindow,
                      pdfOnRenderStateChange:
                        handleActivePdfRenderStateChange,
                      pdfOnCanvasReady: (canvas) => {
                        activePdfCanvasTrackingRef.current =
                          trackNotebookPdfCanvas({
                            current: activePdfCanvasTrackingRef.current,
                            renderKey: activePdfRenderKey,
                            canvas,
                          });
                      },
                    }}
                    inkEditorProps={{
                      onReady: () => {
                        inkReadyRef.current = true;
                        setInkReady(true);
                        window.requestAnimationFrame(() =>
                          maybeFinishPageHandoffRef.current()
                        );
                      },
                      onReadyError: () => {
                        inkReadyRef.current = true;
                        showError("This page opened, but the ink editor could not start. Your saved writing is still visible.");
                        window.requestAnimationFrame(() =>
                          maybeFinishPageHandoffRef.current()
                        );
                      },
                      activeTool: tool,
                      inkWindow: activeInkWindow,
                      eraserMode,
                      scribbleToErase,
                      penColor,
                      penSettings,
                      penThickness:
                        getPenWidthFromPercent(penThicknessPercent),
                      highlighterColor,
                      highlighterThickness:
                        getHighlighterWidthFromPercent(
                          highlighterThicknessPercent
                        ),
                      onChange: handleInkChange,
                      onHistoryChange: handleInkHistoryChange,
                      onInteractionChange: (active) => {
                        handleInkInteractionChange(active);
                        if (active) {
                          // Only what is open: see clearPlacedSelection.
                          closeDrawingToolMenus();
                          if (pagesDrawerOpen) setPagesDrawerOpen(false);
                          clearPlacedSelection();
                          cancelInkUiSync();
                          cancelScheduledPersistence();
                        } else {
                          scheduleInkUiSync();
                          if (pageState.read().saveStatus === "unsaved") {
                            schedulePendingWork();
                          }
                        }
                      },
                      onPointerDown: handlePagePointerDown,
                      onPointerMove: handlePagePointerMove,
                      onPointerUp: handlePagePointerUp,
                      onPointerCancel: handlePagePointerCancel,
                    }}
                  />
                  <NotebookImageLayer
                    images={selectedPage.imageRefs}
                    editingEnabled={
                      notebookToolMovesPlacedItems(tool) &&
                      fullNotebookEditingEnabled &&
                      !isPhoneLayout &&
                      !practicePaperEditingLocked
                    }
                    selectedImageId={selectedImageId}
                    onSelect={handleSelectImage}
                    onCommit={handleImagesCommit}
                    onDelete={handleDeleteImage}
                  />
                  <NotebookGraphLayer
                    graphs={selectedPage.graphBlocks}
                    editingEnabled={
                      notebookToolMovesPlacedItems(tool) &&
                      fullNotebookEditingEnabled &&
                      !isPhoneLayout &&
                      !practicePaperEditingLocked
                    }
                    selectedGraphId={selectedGraphId}
                    onSelect={handleSelectGraph}
                    onCommit={handleGraphsCommit}
                    onEdit={setGraphEditorTarget}
                    onDelete={handleDeleteGraph}
                  />
                  <NotebookTextBlockLayer
                    textBlocks={textBlocks}
                    pageColor={pageColor}
                    editingEnabled={fullNotebookEditingEnabled && !practicePaperEditingLocked}
                    selectedTextBlockId={selectedTextBlockId}
                    editingTextBlockId={editingTextBlockId}
                    activeTextGestureId={activeTextGestureId}
                    openTextBlockOptionsId={openTextBlockOptionsId}
                    onPointerDown={handleTextBlockPointerDown}
                    onPointerMove={handleTextBlockPointerMove}
                    onPointerUp={handleTextBlockPointerUp}
                    onPointerCancel={handleTextBlockPointerCancel}
                    onSelect={selectTextBlock}
                    onSetOptionsOpen={setTextBlockOptionsOpen}
                    onToggleOutline={toggleTextBlockOutline}
                    onDelete={deleteTextBlock}
                    onOptionsKeyDown={handleTextBlockOptionsKeyDown}
                    onStartResize={startTextBlockResize}
                    onStartMove={startTextBlockDrag}
                    onResize={resizeTextBlock}
                    onStopResize={stopTextBlockResize}
                    onChangeText={handleTextBlockTextChange}
                    onFitHeight={handleTextBlockFitHeight}
                    onStopEditing={stopEditingTextBlock}
                  />
                </>
              ) : null
            }
          />
            {createPageActive || creatingPage ? (
              <div
                ref={createPageAffordanceRef}
                aria-hidden="true"
                className="notebook-create-page-affordance pointer-events-none absolute right-[2.375rem] top-1/2 z-40 -translate-y-1/2 translate-x-1/2"
                style={{
                  opacity: creatingPage
                    ? 1
                    : Math.min(1, 0.2 + createPageProgress * 0.8),
                }}
              >
                <div
                  ref={createPageIndicatorRef}
                  className={`grid h-16 w-16 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] shadow-e2 ${
                    createPageBounce ? "notebook-create-page-pop" : ""
                  }`}
                  style={{
                    transform: `scale(${
                      creatingPage ? 1 : 0.72 + createPageProgress * 0.28
                    })`,
                  }}
                >
                  <svg viewBox="0 0 48 48" className="h-11 w-11 -rotate-90">
                    <circle
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      stroke="var(--color-border)"
                      strokeWidth="3.5"
                    />
                    <circle
                      ref={createPageProgressCircleRef}
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      stroke="var(--color-selected-border)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 20}
                      strokeDashoffset={2 * Math.PI * 20 * (1 - createPageProgress)}
                      style={{ transition: "stroke-dashoffset 80ms linear" }}
                    />
                    <path
                      d="M24 15v18M15 24h18"
                      fill="none"
                      stroke="var(--color-selected-border)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            ) : null}
            {fullNotebookEditingEnabled && !practicePaperEditingLocked ? (
              <NotebookDrawingToolbar
                dock={toolbarDock}
                toolbarRef={drawingToolbarRef}
                dockBindings={toolbarBindings}
                tool={tool}
                penColor={penColor}
                highlighterColor={highlighterColor}
                openMenu={openToolMenu}
                onSelectDrawingTool={handleSelectDrawingTool}
                onToggleTextTool={handleToggleTextTool}

                onAddImage={handleAddImage}
                addingImage={addingImage}
                onAddGraph={handleOpenNewGraph}
                undoDepth={undoDepth}
                redoDepth={redoDepth}
                onUndo={handleToolbarUndo}
                onRedo={handleToolbarRedo}
              />
            ) : null}
            <NotebookPageNavigation
              selectedPageIndex={selectedPageIndex}
              pageCount={pages.length}
              navigationBusy={Boolean(pageSwipeMotion)}
              editingToolbarVisible={fullNotebookEditingEnabled && !practicePaperEditingLocked}
              canCreatePage={selectedPageIndex >= 0 && selectedPageIndex >= pages.length - 1 && fullNotebookEditingEnabled && !practicePaperEditingLocked}
              creatingPage={creatingPage}
              onPrevious={() => void selectPageByOffset(-1)}
              onNext={() => void selectPageByOffset(1)}
              onCreate={() => void createBlankPageAtEnd()}
            />
            {touchInkHintVisible ? (
              <div
                className={`notebook-floating-control pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-text-secondary ${
                  toolbarDock === "bottom"
                    ? "bottom-[calc(var(--notebook-control-bottom-inset)+6.35rem)]"
                    : "bottom-[var(--notebook-control-bottom-inset)]"
                }`}
              >
                Use Apple Pencil or stylus to write. Fingers move the page.
              </div>
            ) : null}
            {selectedPageInkUnloaded &&
            fullNotebookEditingEnabled &&
            !practicePaperEditingLocked ? (
              <div
                role="status"
                className={`notebook-floating-control pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-text-secondary ${
                  toolbarDock === "bottom"
                    ? "bottom-[calc(var(--notebook-control-bottom-inset)+6.35rem)]"
                    : "bottom-[var(--notebook-control-bottom-inset)]"
                }`}
              >
                Loading this page&rsquo;s drawing. Writing is paused until it
                arrives.
              </div>
            ) : null}
        </div>
      </div>
      <NotebookEditorConfirmDialog
        request={confirmRequest}
        busy={Boolean(deletingPageId)}
        onConfirm={confirmPendingRequest}
        onClose={dismissRequest}
      />
    </main>
  );
}
