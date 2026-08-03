"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import AppPage from "@/components/layout/AppPage";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import type { NotebookInkEditorHandle } from "@/components/workspace/NotebookInkEditor";
import NotebookLivePageLayers from "@/components/workspace/NotebookLivePageLayers";
import { PAGE_COLOR_CLASS } from "@/components/workspace/NotebookPageBackground";
import NotebookPageStaticContent from "@/components/workspace/NotebookPageStaticContent";
import NotebookPagesDrawer from "@/components/workspace/NotebookPagesDrawer";
import NotebookDrawingToolbar, {
  type NotebookToolMenu,
} from "@/components/workspace/NotebookDrawingToolbar";
import NotebookAddPagesDialog from "@/components/workspace/NotebookAddPagesDialog";
import NotebookDraftConflictBanner from "@/components/workspace/NotebookDraftConflictBanner";
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
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  Skeleton,
} from "@/components/ui";
import type { Feedback } from "@/lib/app/feedback";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { useNotebookLoader } from "@/hooks/useNotebookLoader";
import { useNotebookInkController } from "@/hooks/useNotebookInkController";
import { useNotebookPageState } from "@/hooks/useNotebookPageState";
import { useNotebookPageTrack } from "@/hooks/useNotebookPageTrack";
import {
  useNotebookPersistenceController,
  type NotebookPageSaveResult,
} from "@/hooks/useNotebookPersistenceController";
import { useNotebookTextBlockController } from "@/hooks/useNotebookTextBlockController";
import { useNotebookToolbarDocking } from "@/hooks/useNotebookToolbarDocking";
import { useNotebookViewportController } from "@/hooks/useNotebookViewportController";
import {
  useNotebookDrawingToolState,
  useNotebookNavigationState,
  useNotebookPageCreationState,
  useNotebookPanelState,
} from "@/hooks/useNotebookWorkspaceState";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import type {
  NotebookFile,
  NotebookPage,
  NotebookStrokeTool,
  NotebookTextBlock,
} from "@/lib/workspace/notebooks";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";
import {
  getNotebookPageStyleBackground,
  normalizeNotebookStrokes,
} from "@/lib/workspace/notebook-page-content";
import {
  getNotebookSwipePreviewDirection,
  isNotebookPageSwipePreviewEnabled,
  resolveNotebookCarouselPages,
  shouldShowNotebookNewPagePreview,
} from "@/lib/workspace/notebook-carousel";
import {
  clearNotebookNativeSelection,
  installNotebookStylusTouchListeners,
  isNotebookTextEditingTarget,
  NOTEBOOK_EDITOR_LOCK_BODY_CLASS,
  safelyReleasePointerCapture,
  safelySetPointerCapture,
  shouldSuppressNotebookNativeEvent,
} from "@/lib/workspace/notebook-interaction-lock";
import {
} from "@/lib/workspace/notebook-autosave";
import {
  clampNotebookPagePan,
  clampNotebookThicknessPercent,
  type NotebookPagePan,
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
  shouldCreateNotebookPageOnRelease,
  mapClientPointToNotebookPage,
  shouldPointerSwipePages,
  shouldSuppressTouchAfterStylus,
  type NotebookPageDragIntent,
} from "@/lib/workspace/notebook-inking";
import {
  readBlobAsBase64,
  renderNotebookPageSnapshot,
} from "@/lib/workspace/notebook-page-snapshot";
import {
  createNotebookPage,
  deleteNotebookPage,
} from "@/services/study/notebooks";
import { appendUploadedFileToNotebook } from "@/services/study/notebook-import";
import {
  getNotebookFileBytes,
} from "@/services/study/notebook-files";
import {
  legacyStrokesToJsDrawSvg,
} from "@/lib/workspace/notebook-ink-data";
import {
  buildNotebookPageSearch,
  prepareNotebookExit,
} from "@/lib/workspace/notebook-navigation";
import {
  getNotebookPageTurnOffset,
  getQueuedNotebookPageTurn,
  resolveQueuedNotebookPageTurn,
  type NotebookQueuedPageTurn,
} from "@/lib/workspace/notebook-navigation-queue";
import { pageHasUnloadedInk } from "@/lib/workspace/notebook-page-ink-split";
import {
  readNotebookScribbleErasePreference,
  saveNotebookScribbleErasePreference,
} from "@/lib/workspace/notebook-toolbar";
import { resolveNotebookPageBackgroundFileId } from "@/lib/workspace/notebook-pdf";
import {
  trackNotebookPdfCanvas,
  type NotebookPdfCanvasTracking,
} from "@/lib/workspace/notebook-pdf-canvas";

type Point = { x: number; y: number };
type EditorTool = NotebookStrokeTool | "text" | "select";
type PageSwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  lastX: number;
  lastY: number;
  startPan: NotebookPagePan;
  samples: Array<{ x: number; time: number }>;
  axis: "horizontal" | "vertical" | null;
  intent: NotebookPageDragIntent | null;
  completed: boolean;
  /**
   * The gesture began while a page turn was still settling. It is tracked only
   * to resolve a direction on release; it never moves the track.
   */
  queuedOnly: boolean;
};
const CANVAS_WIDTH = NOTEBOOK_PAGE_COORDINATE_WIDTH;
const CANVAS_HEIGHT = NOTEBOOK_PAGE_COORDINATE_HEIGHT;
const NOTEBOOK_ASSISTANT_QUICK_ACTIONS = [
  {
    label: "Check my work",
    prompt:
      "Check the work on this page. Point out any mistakes and explain how to improve them without rewriting everything for me.",
  },
  {
    label: "Give me a hint",
    prompt:
      "Give me one useful hint for the work on this page without revealing the full answer.",
  },
  {
    label: "Explain this page",
    prompt:
      "Explain the ideas and working on this page clearly, including anything important I may have missed.",
  },
  {
    label: "Quiz me",
    prompt:
      "Quiz me on the main idea from this page. Ask one question at a time and do not reveal the answer yet.",
  },
] as const;
// Each edge keeps a generous 32px invisible hit area, but the visible
// affordance is a slim grip bar sitting on the border, not a bubble.

export default function NotebookEditorPage() {
  const { user } = useUser();
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
    draftConflict,
    takeRecoveredDraft,
    restoreLocalDraft: handleRestoreLocalDraft,
    keepSavedVersion: handleKeepSavedDraftVersion,
  } = useNotebookLoader({
    userId: user?.uid,
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

  const inkEditorRef = useRef<NotebookInkEditorHandle | null>(null);
  const isPageNavigationLocked = useCallback(
    () => pageNavigationLockedRef.current,
    []
  );

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

  const {
    penColor, setPenColor, penThicknessPercent, setPenThicknessPercent,
    highlighterColor, setHighlighterColor,
    highlighterThicknessPercent, setHighlighterThicknessPercent,
    eraserMode, setEraserMode, eraserWidth, setEraserWidth,
    penMenuOpen, setPenMenuOpen, highlighterMenuOpen, setHighlighterMenuOpen,
    eraserMenuOpen, setEraserMenuOpen,
    touchInkHintVisible, setTouchInkHintVisible,
    scribbleToErase, setScribbleToErase,
    scribbleEraseNotice, setScribbleEraseNotice,
  } = useNotebookDrawingToolState();
  const {
    pageZoom, setPageZoom, pagePan, setPagePan,
    frameSize, setFrameSize, pageSwipeMotion, setPageSwipeMotion,
    pageSwipeInkSnapshot, setPageSwipeInkSnapshot,
  } = useNotebookNavigationState();
  const {
    showAddPagesDialog, setShowAddPagesDialog, notebookFile, setNotebookFile,
    notebookUploadProgress, setNotebookUploadProgress,
    addingNotebookFile, setAddingNotebookFile,
    createPageActive, setCreatePageActive, createPageProgress, setCreatePageProgress,
    creatingPage, setCreatingPage, createPageBounce, setCreatePageBounce,
    deletingPageId, setDeletingPageId, confirmDialog, setConfirmDialog,
    inkEditorMountRevision, setInkEditorMountRevision,
  } = useNotebookPageCreationState();
  const {
    assistantOpen, setAssistantOpen, pagesDrawerOpen, setPagesDrawerOpen,
    isPhoneLayout, setIsPhoneLayout, phoneFullEditing, setPhoneFullEditing,
  } = useNotebookPanelState();
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
  const queuedPageTurnRef = useRef<NotebookQueuedPageTurn | null>(null);
  const drainQueuedPageTurnRef = useRef<(turn: NotebookQueuedPageTurn) => void>(
    () => undefined
  );
  const inkMountedUnloadedPageIdRef = useRef<string | null>(null);
  const editorRevisionRef = useRef(0);
  const ignoredTouchInkCountRef = useRef(0);
  const touchInkHintTimeoutRef = useRef<number | null>(null);
  const scribbleNoticeTimeoutRef = useRef<number | null>(null);
  const fullNotebookEditingEnabled = !isPhoneLayout || phoneFullEditing;
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );
  const selectedPageIndex = useMemo(
    () => pages.findIndex((page) => page.id === selectedPage?.id),
    [pages, selectedPage?.id]
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
    pageCanPanHorizontally,
    pageCanPanVertically,
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
    getInkSnapshotSvg: () =>
      inkEditorRef.current?.serialize() ?? selectedPageInkSvg,
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
      setPagesDrawerOpen(false);
      setPenMenuOpen(false);
      setHighlighterMenuOpen(false);
      setEraserMenuOpen(false);
    }
    setAssistantOpen(open);
  }, [
    setAssistantOpen,
    setEraserMenuOpen,
    setHighlighterMenuOpen,
    setPagesDrawerOpen,
    setPenMenuOpen,
  ]);

  const getNotebookAssistantContext = useCallback(
    async (): Promise<JamiAssistantContext> => {
      const page = pageState.read().selectedPage;
      const currentNotebook = notebook;
      const editor = inkEditorRef.current;
      if (
        !page ||
        !currentNotebook ||
        page.id !== selectedPage?.id ||
        page.notebookId !== currentNotebook.id
      ) {
        throw new Error(
          "This notebook page changed before Jami could read it. Try again on the page you want help with."
        );
      }
      if (!editor || !inkReadyRef.current) {
        throw new Error(
          "This notebook page is still opening. Wait until the writing appears, then try again."
        );
      }
      if (inkInteractionActiveRef.current || editor.isInteracting()) {
        throw new Error(
          "Finish the current pen stroke, then ask Jami again."
        );
      }

      const capturedPageId = page.id;
      const capturedContentRevision = pageState.read().contentRevision;
      const capturedEditorRevision = editorRevisionRef.current;
      const capturedTextBlocks = pageState.read().textBlocks.map((block) => ({
        ...block,
      }));
      const capturedPageColor = pageState.read().pageColor;
      const capturedPageStyle = pageState.read().pageStyle;

      const assertCaptureIsCurrent = () => {
        if (
          pageState.read().selectedPage?.id !== capturedPageId ||
          pageState.read().contentRevision !== capturedContentRevision ||
          editorRevisionRef.current !== capturedEditorRevision ||
          inkEditorRef.current !== editor
        ) {
          throw new Error(
            "This notebook page changed while Jami was reading it. Try sending your question again."
          );
        }
        if (inkInteractionActiveRef.current || editor.isInteracting()) {
          throw new Error(
            "Finish the current pen stroke, then ask Jami again."
          );
        }
      };

      const inkSvg = await editor.serializeAsync();
      if (inkSvg === null) {
        throw new Error(
          "Finish the current pen stroke and wait for the page to settle, then try again."
        );
      }
      assertCaptureIsCurrent();

      let background:
        | {
            kind: "pdf-canvas";
            canvas: HTMLCanvasElement;
          }
        | {
            kind: "image-bytes";
            bytes: Uint8Array;
            mimeType: string;
          }
        | null = null;

      if (
        activeNotebookFile?.fileType === "application/pdf" &&
        activeNotebookFile.storagePath
      ) {
        const pdfCanvasTracking = activePdfCanvasTrackingRef.current;
        const pdfCanvas = pdfCanvasTracking.canvas;
        if (
          !activePdfRenderKey ||
          !pdfCanvas ||
          pdfCanvasTracking.renderKey !== activePdfRenderKey ||
          pdfCanvas.width <= 0 ||
          pdfCanvas.height <= 0
        ) {
          throw new Error(
            "This PDF page is still loading. Wait until it appears, then ask Jami again."
          );
        }
        background = { kind: "pdf-canvas", canvas: pdfCanvas };
      } else if (
        activeNotebookFile?.fileType.startsWith("image/") &&
        activeNotebookFile.storagePath
      ) {
        let bytes: Uint8Array;
        try {
          bytes = await getNotebookFileBytes(activeNotebookFile.storagePath);
        } catch {
          // Replaced with wording the student can act on. The storage error
          // names an internal path and would not tell them what to do next.
          throw new Error(
            "Jami could not read this page's image background. Wait a moment and try again."
          );
        }
        assertCaptureIsCurrent();
        background = {
          kind: "image-bytes",
          bytes,
          mimeType: activeNotebookFile.fileType,
        };
      }

      const snapshot = await renderNotebookPageSnapshot({
        pageColor: capturedPageColor,
        pageStyle: capturedPageStyle,
        inkSvg,
        textBlocks: capturedTextBlocks,
        background,
      });
      assertCaptureIsCurrent();
      const dataBase64 = await readBlobAsBase64(snapshot.blob);
      assertCaptureIsCurrent();

      return {
        surface: "notebook",
        notebookId: currentNotebook.id,
        pageId: capturedPageId,
        snapshot: {
          mimeType: snapshot.mimeType,
          width: snapshot.width,
          height: snapshot.height,
          dataBase64,
        },
        typedText: snapshot.typedText || undefined,
        questionPrompt: page.questionPrompt?.trim() || undefined,
      };
    },
    [
      activeNotebookFile,
      activePdfRenderKey,
      inkInteractionActiveRef,
      inkReadyRef,
      notebook,
      pageState,
      selectedPage?.id,
    ]
  );

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

  useEffect(() => {
    if (typeof window === "undefined" || !selectedPage?.id) return;
    const nextSearch = buildNotebookPageSearch(
      window.location.search,
      selectedPage.id
    );
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [selectedPage?.id]);

  // Push the precision/stroke selection straight to the ink editor whenever it
  // changes. This bypasses the deferred style application (which can stall if a
  // stale eraser pointer leaves activePointers > 0), so the chosen mode always
  // reaches js-draw and the two modes keep their distinct roles.
  useEffect(() => {
    inkEditorRef.current?.setEraserMode(eraserMode);
  }, [eraserMode]);

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
  // while the page fits, clamped to the frame edges while zoomed in.
  useEffect(() => {
    setPagePan((previous) => {
      const next = clampNotebookPagePan({
        pan: previous,
        pageWidth: pageWidthPx,
        pageHeight: pageHeightPx,
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
      });
      return next.x === previous.x && next.y === previous.y ? previous : next;
    });
  }, [frameSize, pageHeightPx, pageWidthPx, setPagePan]);

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
    userId: user?.uid,
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

  // With js-draw as the single ink engine, switching tools only updates the
  // desired style; NotebookInkEditor defers applying it while a pointer is
  // still down, so no flush/commit step is needed.
  const switchNotebookTool = useCallback((nextTool: EditorTool) => {
    setTool(nextTool);
  }, [setTool]);

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
    updateTextBlock,
    toggleTextBlockOutline,
    deleteTextBlock,
    handleTextBlockOptionsKeyDown,
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const update = () => setIsPhoneLayout(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [setIsPhoneLayout]);

  useEffect(() => {
    setScribbleToErase(readNotebookScribbleErasePreference());
  }, [setScribbleToErase]);

  /**
   * Says what a scribble just removed.
   *
   * An erase nobody explicitly asked for should never be silent, even when the
   * gesture was deliberate. Undo is one press away and now does exactly the
   * right thing, because the scribble itself never entered the history.
   */
  const handleScribbleErase = useCallback(
    (strokeCount: number) => {
      setScribbleEraseNotice(strokeCount);
      if (scribbleNoticeTimeoutRef.current !== null) {
        window.clearTimeout(scribbleNoticeTimeoutRef.current);
      }
      scribbleNoticeTimeoutRef.current = window.setTimeout(() => {
        setScribbleEraseNotice(null);
        scribbleNoticeTimeoutRef.current = null;
      }, 2600);
    },
    [setScribbleEraseNotice]
  );

  useEffect(
    () => () => {
      if (scribbleNoticeTimeoutRef.current !== null) {
        window.clearTimeout(scribbleNoticeTimeoutRef.current);
        scribbleNoticeTimeoutRef.current = null;
      }
    },
    []
  );

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

  useEffect(() => {
    setPenColor((current) => {
      if (pageColor === "black" && current === "black") return "white";
      if (pageColor === "white" && current === "white") return "black";
      return current;
    });
  }, [pageColor, setPenColor]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const themeColorMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]'
    );
    const previousRootBackground = root.style.background;
    const previousBodyBackground = document.body.style.background;
    const previousThemeColor = themeColorMeta?.content;
    const notebookSurfaceColor =
      window
        .getComputedStyle(root)
        .getPropertyValue("--color-surface-base")
        .trim() || "#0d1018";

    root.style.background = notebookSurfaceColor;
    document.body.style.background = notebookSurfaceColor;
    if (themeColorMeta) {
      themeColorMeta.content = notebookSurfaceColor;
    }
    document.body.classList.add(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);

    const preventIfOutsideTextEditor = (event: Event) => {
      if (!shouldSuppressNotebookNativeEvent(event.target)) return;
      event.preventDefault();
      clearNotebookNativeSelection(document);
    };
    const clearSelectionIfOutsideTextEditor = () => {
      if (isNotebookTextEditingTarget(document.activeElement)) return;
      clearNotebookNativeSelection(document);
    };

    document.addEventListener("selectstart", preventIfOutsideTextEditor, true);
    document.addEventListener("contextmenu", preventIfOutsideTextEditor, true);
    document.addEventListener("dragstart", preventIfOutsideTextEditor, true);
    document.addEventListener("copy", preventIfOutsideTextEditor, true);
    document.addEventListener("cut", preventIfOutsideTextEditor, true);
    document.addEventListener("paste", preventIfOutsideTextEditor, true);
    document.addEventListener("selectionchange", clearSelectionIfOutsideTextEditor);

    return () => {
      document.body.classList.remove(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);
      root.style.background = previousRootBackground;
      document.body.style.background = previousBodyBackground;
      if (themeColorMeta && previousThemeColor !== undefined) {
        themeColorMeta.content = previousThemeColor;
      }
      document.removeEventListener("selectstart", preventIfOutsideTextEditor, true);
      document.removeEventListener("contextmenu", preventIfOutsideTextEditor, true);
      document.removeEventListener("dragstart", preventIfOutsideTextEditor, true);
      document.removeEventListener("copy", preventIfOutsideTextEditor, true);
      document.removeEventListener("cut", preventIfOutsideTextEditor, true);
      document.removeEventListener("paste", preventIfOutsideTextEditor, true);
      document.removeEventListener("selectionchange", clearSelectionIfOutsideTextEditor);
    };
  }, []);

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
      queuedPageTurnRef.current = null;
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

  const getNotebookPointFromEvent = (
    event: ReactPointerEvent<HTMLElement>
  ): Point | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return mapClientPointToNotebookPage({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
  };

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
      queuedPageTurnRef.current = null;
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
      // A flick that arrived while this turn was settling runs now. It is
      // resolved from the page just opened, so a queued turn cannot outrun
      // hydration: each turn pays the ink-first gate in its own right.
      const queuedTurn = queuedPageTurnRef.current;
      queuedPageTurnRef.current = null;
      if (queuedTurn) drainQueuedPageTurnRef.current(queuedTurn);
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
  maybeFinishPageHandoffRef.current = maybeFinishPageHandoff;

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


  useEffect(
    () => () => {
      cancelInkUiSync();
    },
    [cancelInkUiSync]
  );

  useEffect(() => {
    const saveBeforeExit = (event?: PageTransitionEvent | BeforeUnloadEvent) => {
      if (
        pageState.read().saveStatus === "unsaved" ||
        pageState.read().saveStatus === "failed"
      ) {
        persistCurrentPageDraftSync();
        void saveCurrentPage({ flush: true });
        if (event?.type === "beforeunload") {
          event.preventDefault();
          event.returnValue = "";
        }
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveBeforeExit();
      }
    };

    window.addEventListener("pagehide", saveBeforeExit);
    window.addEventListener("beforeunload", saveBeforeExit);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", saveBeforeExit);
      window.removeEventListener("beforeunload", saveBeforeExit);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pageState, persistCurrentPageDraftSync, saveCurrentPage]);

  const handleExitNotebook = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    const exitDecision = prepareNotebookExit({
      saveStatus: pageState.read().saveStatus,
      persistDraftSync: persistCurrentPageDraftSync,
      queueSaveForExit: queueCurrentPageSaveForExit,
    });
    if (exitDecision.shouldPreventNavigation) {
      event.preventDefault();
      showError("Could not autosave before leaving the notebook.");
    }
  };

  const handleRetryPageSave = () => {
    if (
      pageState.read().saveStatus !== "failed" ||
      inkInteractionActiveRef.current ||
      inkEditorRef.current?.isInteracting()
    ) {
      return;
    }
    setSaveStatus("unsaved");
    void saveCurrentPage({ flush: true });
  };

  const createBlankPageAtEnd = useCallback(async (velocityX = -2) => {
    if (
      pageNavigationLockedRef.current ||
      pageCreationInFlightRef.current ||
      pageTrackTravelDistance <= 0
    ) {
      return false;
    }
    if (!user?.uid || !notebook) {
      pageNavigationLockedRef.current = true;
      const token = pageNavigationTokenRef.current + 1;
      pageNavigationTokenRef.current = token;
      await returnPageTrackToSource(velocityX, token);
      return false;
    }
    const lastPage = pages[pages.length - 1];
    const basePage = selectedPage ?? lastPage;
    const pageColorValue = basePage?.pageColor ?? notebook.pageColor ?? "white";
    const pageStyleValue = basePage?.pageStyle ?? notebook.pageStyle ?? "plain";
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
      return createNotebookPage(user.uid, {
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
    selectedPage,
    setCreatePageActive,
    setCreatePageBounce,
    setCreatePageProgress,
    setCreatingPage,
    setPages,
    showThrownError,
    user?.uid,
  ]);

  /**
   * Runs a flick that was held while the previous turn settled.
   *
   * Resolved against the page the queue actually landed on, so the gesture ends
   * up doing what it would have done on an idle track -- including making a new
   * page when it was a hard pull past the end of the notebook.
   */
  const drainQueuedPageTurn = useCallback(
    (turn: NotebookQueuedPageTurn) => {
      const action = resolveQueuedNotebookPageTurn({
        canCreatePage: fullNotebookEditingEnabled,
        pageCount: pages.length,
        selectedPageIndex,
        turn,
      });
      if (action === "create") {
        void createBlankPageAtEnd(turn.velocityX);
      } else if (action === "turn") {
        void selectPageByOffset(getNotebookPageTurnOffset(turn));
      }
    },
    [
      createBlankPageAtEnd,
      fullNotebookEditingEnabled,
      pages.length,
      selectPageByOffset,
      selectedPageIndex,
    ]
  );
  drainQueuedPageTurnRef.current = drainQueuedPageTurn;

  const handleStartPageSwipe = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      !fullNotebookEditingEnabled ||
      !shouldPointerSwipePages(event.pointerType) ||
      inkInteractionActiveRef.current ||
      activeTextGestureId
    ) {
      return;
    }
    const startPan = { ...viewportLayout.pageOrigin };
    pagePanLiveRef.current = startPan;
    pageSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startPan,
      samples: [{ x: event.clientX, time: event.timeStamp }],
      axis: null,
      intent: null,
      completed: false,
      queuedOnly: pageNavigationLockedRef.current,
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
          canPanHorizontally: pageCanPanHorizontally,
          canPanVertically: pageCanPanVertically,
          zoom: viewportLayout.zoom,
        });
        if (swipe.intent === "page" && !swipe.queuedOnly) {
          setPagePreviewVisibility(true);
        }
      }
    }

    // The track is mid-settle and owns its own transform. Keep collecting
    // samples so the release can resolve a direction, but touch nothing.
    if (swipe.queuedOnly) {
      event.preventDefault();
      return;
    }

    // A landscape page can be taller than the frame while still being
    // narrower than it. In that state vertical drags pan the sheet, while
    // horizontal drags retain the physical page-swipe interaction.
    if (swipe.intent === "pan") {
      const nextPan = clampNotebookPagePan({
        pan: {
          x: swipe.startPan.x + totalDx,
          y: swipe.startPan.y + totalDy,
        },
        pageWidth: pageWidthPx,
        pageHeight: pageHeightPx,
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
      });
      pagePanLiveRef.current = nextPan;
      const surface = pageSurfaceRef.current;
      if (surface) {
        surface.style.transform = `translate3d(${nextPan.x}px, ${nextPan.y}px, 0)`;
      }
      event.preventDefault();
      return;
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
    frameSize.height,
    frameSize.width,
    pageCanPanHorizontally,
    pageCanPanVertically,
    pageHeightPx,
    pagePanLiveRef,
    pageWidthPx,
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

    // A flick released while the previous turn was still settling is held until
    // that turn finishes rather than dropped. Bounds are deliberately not
    // resolved here: the queued turn is a direction, and the page it applies to
    // is whichever one is open when it runs.
    if (swipe.queuedOnly) {
      const queuedPageWidth =
        pageSurfaceRef.current?.getBoundingClientRect().width ?? 1;
      const queuedVelocityX = getNotebookSwipeVelocity([
        ...swipe.samples,
        { x: event.clientX, time: event.timeStamp },
      ]);
      const queuedDirection = options.cancelled
        ? null
        : getNotebookSwipeReleaseDecision({
            totalDx: deltaX,
            pageWidth: queuedPageWidth,
            velocityX: queuedVelocityX,
            currentIndex: selectedPageIndex,
            pageCount: pages.length,
          }).direction;
      queuedPageTurnRef.current = getQueuedNotebookPageTurn({
        current: queuedPageTurnRef.current,
        direction: queuedDirection,
        velocityX: queuedVelocityX,
        // Whether this lands on the last page is not known yet, so record how
        // hard the pull was and let the drain decide.
        createsPage:
          !options.cancelled &&
          shouldCreateNotebookPageOnRelease({
            totalDx: deltaX,
            pageWidth: queuedPageWidth,
            velocityX: queuedVelocityX,
          }),
      });
      return;
    }

    // A resolved pan commits its final position; horizontal page swipes remain
    // available whenever the sheet has no horizontal pan range.
    if (swipe.intent === "pan") {
      setPagePan(pagePanLiveRef.current);
      if (
        !options.cancelled &&
        Math.abs(deltaX) <= 8 &&
        Math.abs(deltaY) <= 8 &&
        tool === "text" &&
        options.allowTextTap
      ) {
        const point = getNotebookPointFromEvent(event);
        if (point) createTextBlockAtPoint(point);
      }
      return;
    }

    const pageWidth = pageSurfaceRef.current?.getBoundingClientRect().width ?? 1;
    const velocityX = getNotebookSwipeVelocity([
      ...swipe.samples,
      { x: event.clientX, time: event.timeStamp },
    ]);
    const horizontalGesture =
      swipe.intent === "page" ||
      (swipe.intent === null &&
        !pageCanPanHorizontally &&
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
    pageCanPanHorizontally,
    pagePanLiveRef,
    pageTrackOffsetRef,
    pages,
    returnPageTrackToSource,
    runPageTrackNavigation,
    selectedPageIndex,
    setCreatePageActive,
    setPagePan,
    setPagePreviewVisibility,
    tool,
  ]);

  const maybeShowIgnoredTouchInkHint = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.pointerType !== "touch" ||
      tool === "text" ||
      !fullNotebookEditingEnabled ||
      pageSwipeRef.current?.completed ||
      pageSwipeRef.current?.intent === "pan" ||
      isPinchActive()
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
    tool,
  ]);

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
    setPenMenuOpen(false);
    setHighlighterMenuOpen(false);
    setEraserMenuOpen(false);
    clearTextBlockSelection();
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
    const point = getNotebookPointFromEvent(event);
    if (!point) return;
    createTextBlockAtPoint(point);
  }, [
    clearTextBlockSelection,
    createTextBlockAtPoint,
    fullNotebookEditingEnabled,
    handleStartPageSwipe,
    handleTouchPointerDown,
    setEraserMenuOpen,
    setHighlighterMenuOpen,
    setPenMenuOpen,
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

  const handleDeletePage = async (page: NotebookPage) => {
    if (!user?.uid || !notebook || !fullNotebookEditingEnabled) return;
    if (pages.length <= 1) {
      showError("A notebook needs at least one page.");
      return;
    }

    if (
      pageState.read().saveStatus === "unsaved" ||
      pageState.read().saveStatus === "failed"
    ) {
      const saved = await saveCurrentPage({ flush: true });
      if (!saved) {
        showError("Could not autosave before deleting the page.");
        return;
      }
    }

    setDeletingPageId(page.id);
    clearFeedback();
    try {
      const deletedIndex = pages.findIndex((candidate) => candidate.id === page.id);
      const nextPages = await deleteNotebookPage(user.uid, notebook.id, page.id);
      const nextSelectedPage =
        page.id === pageState.read().selectedPage?.id
          ? nextPages[Math.min(Math.max(deletedIndex, 0), nextPages.length - 1)] ?? nextPages[0]
          : nextPages.find((candidate) => candidate.id === pageState.read().selectedPage?.id) ??
            nextPages[0];

      pageState.resetHydration();
      setPages(nextPages);
      // Ink first, as everywhere else: the page taking this one's place must
      // not open on an empty canvas that autosave could write over its drawing.
      if (nextSelectedPage) await hydratePageInk(nextSelectedPage.id);
      setSelectedPageId(nextSelectedPage?.id ?? null);
      resetTextBlockInteraction();
      success(`Page ${page.pageNumber} deleted.`);
    } catch (error) {
      showThrownError(error, "Could not delete this page.");
    } finally {
      setDeletingPageId(null);
    }
  };

  const closeAddPagesDialog = () => {
    if (addingNotebookFile) return;
    setShowAddPagesDialog(false);
    setNotebookFile(null);
    setNotebookUploadProgress(null);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    if (!search.has("settings")) return;
    search.delete("settings");
    const query = search.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
  }, []);

  const handleAddNotebookFile = async () => {
    if (!user?.uid || !notebook || !notebookFile) return;
    setAddingNotebookFile(true);
    setNotebookUploadProgress(null);
    clearFeedback();
    try {
      const appended = await appendUploadedFileToNotebook({
        userId: user.uid,
        notebook,
        existingPageCount: pages.length,
        file: notebookFile,
        onProgress: setNotebookUploadProgress,
      });
      const nextPages = [...pages, ...appended.pages].sort(
        (a, b) => a.pageNumber - b.pageNumber
      );
      setPages(nextPages);
      setFiles((current) => [appended.file, ...current]);
      if (!notebook.uploadedFileId) {
        setNotebook((current) =>
          current
            ? {
                ...current,
                uploadedFileId: appended.file.id,
                updatedAt: Date.now(),
              }
            : current
        );
      }
      setSelectedPageId(appended.pages[0]?.id ?? selectedPageId);
      setNotebookFile(null);
      setNotebookUploadProgress(null);
      setShowAddPagesDialog(false);
      success(`${appended.pages.length} ${
          appended.pages.length === 1 ? "page" : "pages"
        } added to ${notebook.title}`);
    } catch (error) {
      showThrownError(error, "Could not add these pages to the notebook.");
    } finally {
      setAddingNotebookFile(false);
      setNotebookUploadProgress(null);
    }
  };

  // Ink history lives entirely in js-draw; the page-level stack only tracks
  // text-block changes. Undo drains js-draw first, then falls back to text.
  const performClearCurrentPage = () => {
    inkEditorRef.current?.clear();
    setInkHasContent(false);
    markPageUnsaved();
  };

  useEffect(() => {
    if (!fullNotebookEditingEnabled) return;

    const handleShortcut = (event: KeyboardEvent) => {
      if (isNotebookTextEditingTarget(event.target)) return;
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (key === "t") {
        switchNotebookTool(pageState.read().tool === "text" ? "select" : "text");
      }
      if (key === "p") {
        switchNotebookTool(pageState.read().tool === "pen" ? "select" : "pen");
      }
      if (key === "h") {
        switchNotebookTool(
          pageState.read().tool === "highlighter" ? "select" : "highlighter"
        );
      }
      if (key === "e") {
        switchNotebookTool(
          pageState.read().tool === "eraser" ? "select" : "eraser"
        );
      }
      if (key === "escape") {
        switchNotebookTool("select");
        setPenMenuOpen(false);
        setHighlighterMenuOpen(false);
        setEraserMenuOpen(false);
        clearTextBlockSelection();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    clearTextBlockSelection,
    fullNotebookEditingEnabled,
    handleRedo,
    handleUndo,
    pageState,
    setEraserMenuOpen,
    setHighlighterMenuOpen,
    setPenMenuOpen,
    switchNotebookTool,
  ]);

  const closeDrawingToolMenus = useCallback(() => {
    setPenMenuOpen(false);
    setHighlighterMenuOpen(false);
    setEraserMenuOpen(false);
  }, [setEraserMenuOpen, setHighlighterMenuOpen, setPenMenuOpen]);

  /** Which tool options popover is showing. The three are mutually exclusive. */
  const openToolMenu: NotebookToolMenu = penMenuOpen
    ? "pen"
    : highlighterMenuOpen
      ? "highlighter"
      : eraserMenuOpen
        ? "eraser"
        : null;

  const setToolMenuOpen = useCallback(
    (menu: Exclude<NotebookToolMenu, null>, open: boolean) => {
      setPenMenuOpen(menu === "pen" && open);
      setHighlighterMenuOpen(menu === "highlighter" && open);
      setEraserMenuOpen(menu === "eraser" && open);
    },
    [setEraserMenuOpen, setHighlighterMenuOpen, setPenMenuOpen]
  );

  /** Selecting an inactive tool switches to it; the active one toggles options. */
  const handleSelectDrawingTool = useCallback(
    (nextTool: "pen" | "highlighter" | "eraser") => {
      if (pageState.read().tool !== nextTool) {
        switchNotebookTool(nextTool);
        closeDrawingToolMenus();
        return;
      }
      setToolMenuOpen(nextTool, openToolMenu !== nextTool);
    },
    [
      closeDrawingToolMenus,
      openToolMenu,
      pageState,
      setToolMenuOpen,
      switchNotebookTool,
    ]
  );

  const handleToggleTextTool = useCallback(() => {
    closeDrawingToolMenus();
    switchNotebookTool(pageState.read().tool === "text" ? "select" : "text");
  }, [closeDrawingToolMenus, pageState, switchNotebookTool]);

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

  const handleImportPagesFromDrawer = useCallback(() => {
    setShowAddPagesDialog(true);
  }, [setShowAddPagesDialog]);

  const handleTextBlockTextChange = useCallback(
    (blockId: string, text: string) => {
      updateTextBlock(blockId, { text });
    },
    [updateTextBlock]
  );

  const handleRequestDeletePage = useCallback((page: NotebookPage) => {
    setConfirmDialog({ kind: "delete-page", page });
  }, [setConfirmDialog]);

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
          <Skeleton className="h-40 rounded-[1.7rem]" />
          <Skeleton className="h-[34rem] rounded-[1.9rem]" />
        </div>
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
        <header className="z-40 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)]/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] shadow-[0_8px_20px_rgba(0,0,0,0.14)] backdrop-blur-xl">
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
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="truncate text-sm font-semibold text-text-primary">{notebook.title}</div>
              <NotebookSaveIndicator status={saveStatus} onRetry={handleRetryPageSave} />
            </div>
            <ToolbarIconButton
              label="Pages"
              icon="pages"
              active={pagesDrawerOpen}
              onClick={() => {
                setPenMenuOpen(false);
                setHighlighterMenuOpen(false);
                setEraserMenuOpen(false);
                const nextOpen = !pagesDrawerOpen;
                setPagesDrawerOpen(nextOpen);
                if (nextOpen) handleAssistantOpenChange(false);
              }}
            />
            <ToolbarIconButton
              label="Jami Tutor"
              icon="ai"
              active={assistantOpen}
              onClick={() => {
                handleAssistantOpenChange(!assistantOpen);
              }}
            />
          </div>
        </header>
        <div className="relative isolate min-h-0 flex-1 overflow-hidden">
        <NotebookToolSettingsPopover
          dock={toolbarDock}
          openMenu={openToolMenu}
          pen={{
            color: penColor,
            thicknessPercent: penThicknessPercent,
            onColorChange: (color) => {
              setPenColor(color);
              switchNotebookTool("pen");
            },
            onThicknessChange: (value) => {
              setPenThicknessPercent(clampNotebookThicknessPercent(value));
              switchNotebookTool("pen");
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
            onColorChange: (color) => {
              setHighlighterColor(color);
              switchNotebookTool("highlighter");
            },
            onThicknessChange: (value) => {
              setHighlighterThicknessPercent(
                clampNotebookThicknessPercent(value)
              );
              switchNotebookTool("highlighter");
            },
          }}
          eraser={{
            mode: eraserMode,
            size: eraserWidth,
            onModeChange: (mode) => {
              setEraserMode(mode);
              switchNotebookTool("eraser");
            },
            onSizeChange: (size) => {
              setEraserWidth(size);
              switchNotebookTool("eraser");
            },
            canClearPage: inkHasContent,
            onClearPage: () => {
              setEraserMenuOpen(false);
              setConfirmDialog({ kind: "clear-page" });
            },
          }}
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

        <NotebookDraftConflictBanner
          open={Boolean(
            draftConflict && draftConflict.pageId === selectedPage?.id
          )}
          belowFeedback={Boolean(feedback)}
          onKeepSynced={handleKeepSavedDraftVersion}
          onRestoreLocal={handleRestoreLocalDraft}
        />

        <NotebookAddPagesDialog
          open={showAddPagesDialog}
          file={notebookFile}
          adding={addingNotebookFile}
          progress={notebookUploadProgress}
          onFileChange={setNotebookFile}
          onCancel={closeAddPagesDialog}
          onConfirm={() => void handleAddNotebookFile()}
        />

        <NotebookPhoneLayoutNotice
          open={isPhoneLayout}
          fullEditing={phoneFullEditing}
          onToggleFullEditing={() => setPhoneFullEditing((value) => !value)}
        />

        <JamiAssistantDrawer
          open={assistantOpen}
          onOpenChange={handleAssistantOpenChange}
          resetKey={`notebook:${notebook.id}:page:${selectedPage?.id ?? "no-page"}`}
          contextKey={`notebook:${notebook.id}:page:${selectedPage?.id ?? "no-page"}`}
          contextLabel="Current notebook page"
          historyContextLabel={`${notebook.title} · Page ${Math.max(selectedPageIndex + 1, 1)}`}
          getContext={getNotebookAssistantContext}
          quickActions={NOTEBOOK_ASSISTANT_QUICK_ACTIONS}
        />

        {pagesDrawerOpen ? (
          <NotebookPagesDrawer
            pages={pages}
            notebook={notebook}
            selectedPageId={selectedPage?.id ?? null}
            deletingPageId={deletingPageId}
            editingEnabled={fullNotebookEditingEnabled}
            creatingPage={creatingPage}
            navigationBusy={Boolean(pageSwipeMotion)}
            resolvePageBackground={resolvePageBackground}
            onSelectPage={handleSelectPageFromDrawer}
            onCreatePage={handleCreatePageFromDrawer}
            onImportPages={handleImportPagesFromDrawer}
            onRequestDeletePage={handleRequestDeletePage}
          />
        ) : null}

          <NotebookViewport
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
              selectedPage?.questionPrompt ? (
                <div
                  className={`absolute left-1/2 z-20 w-[min(92vw,36rem)] -translate-x-1/2 ${
                    toolbarDock === "top" ? "top-[5rem]" : "top-3"
                  }`}
                >
                  <Card tone="warm" padding="sm">
                    <p className="text-sm leading-6 text-text-primary">
                      {selectedPage.questionPrompt}
                    </p>
                  </Card>
                </div>
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
                      fullNotebookEditingEnabled && !selectedPageInkUnloaded
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
                      eraserMode,
                      scribbleToErase,
                      onScribbleErase: handleScribbleErase,
                      penColor,
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
                          setPenMenuOpen(false);
                          setHighlighterMenuOpen(false);
                          setEraserMenuOpen(false);
                          setPagesDrawerOpen(false);
                          clearTextBlockSelection();
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
                  <NotebookTextBlockLayer
                    textBlocks={textBlocks}
                    pageColor={pageColor}
                    editingEnabled={fullNotebookEditingEnabled}
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
                    onResize={resizeTextBlock}
                    onStopResize={stopTextBlockResize}
                    onChangeText={handleTextBlockTextChange}
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
                  className={`grid h-16 w-16 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] shadow-[0_12px_30px_rgba(0,0,0,0.2)] ${
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
            {fullNotebookEditingEnabled ? (
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
                undoDepth={undoDepth}
                redoDepth={redoDepth}
                onUndo={handleToolbarUndo}
                onRedo={handleToolbarRedo}
              />
            ) : null}
            <div
              className={`notebook-floating-control absolute right-3 z-20 flex items-center gap-1 rounded-full border border-[var(--color-border)] p-1 md:right-4 ${
                fullNotebookEditingEnabled
                  ? "bottom-[calc(var(--notebook-control-bottom-inset)+3.95rem)] md:bottom-[var(--notebook-control-bottom-inset)]"
                  : "bottom-[var(--notebook-control-bottom-inset)]"
              }`}
              aria-label="Page navigation"
            >
              <button
                type="button"
                aria-label="Previous page"
                title="Previous page"
                disabled={selectedPageIndex <= 0 || Boolean(pageSwipeMotion)}
                onClick={() => void selectPageByOffset(-1)}
                className="inline-grid h-9 w-9 place-items-center rounded-full text-text-secondary transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
              >
                <span className="rotate-90">
                  <NotebookIcon name="chevron" />
                </span>
              </button>
              <div className="min-w-[3.25rem] px-1 text-center text-xs font-semibold tabular-nums text-text-secondary">
                {selectedPageIndex >= 0 ? selectedPageIndex + 1 : 0} / {pages.length || 0}
              </div>
              {selectedPageIndex >= 0 &&
              selectedPageIndex >= pages.length - 1 &&
              fullNotebookEditingEnabled ? (
                <button
                  type="button"
                  aria-label="New page"
                  title="New page"
                  disabled={creatingPage || Boolean(pageSwipeMotion)}
                  onClick={() => void createBlankPageAtEnd()}
                  className="inline-grid h-9 w-9 place-items-center rounded-full text-[var(--color-selected-text)] transition hover:bg-[var(--color-selected-bg)] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <NotebookIcon name="plus" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Next page"
                  title="Next page"
                  disabled={
                    selectedPageIndex < 0 ||
                    selectedPageIndex >= pages.length - 1 ||
                    Boolean(pageSwipeMotion)
                  }
                  onClick={() => void selectPageByOffset(1)}
                  className="inline-grid h-9 w-9 place-items-center rounded-full text-text-secondary transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <span className="-rotate-90">
                    <NotebookIcon name="chevron" />
                  </span>
                </button>
              )}
            </div>
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
            {selectedPageInkUnloaded && fullNotebookEditingEnabled ? (
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
            {scribbleEraseNotice !== null ? (
              <div
                role="status"
                // The pill sits over the page for a couple of seconds. Only the
                // Undo button takes pointer events, so it cannot swallow a
                // Pencil stroke that lands underneath it.
                className={`notebook-floating-control pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--color-border)] py-1.5 pl-3.5 pr-1.5 text-xs font-semibold text-text-secondary ${
                  toolbarDock === "bottom"
                    ? "bottom-[calc(var(--notebook-control-bottom-inset)+6.35rem)]"
                    : "bottom-[var(--notebook-control-bottom-inset)]"
                }`}
              >
                Scribbled out{" "}
                {scribbleEraseNotice === 1
                  ? "1 stroke"
                  : `${scribbleEraseNotice} strokes`}
                <button
                  type="button"
                  onClick={() => {
                    handleUndo();
                    setScribbleEraseNotice(null);
                  }}
                  className="pointer-events-auto rounded-full bg-[var(--color-selected-bg)] px-2.5 py-1 text-[var(--color-selected-text)] transition hover:brightness-110"
                >
                  Undo
                </button>
              </div>
            ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDialog !== null}
        title={
          confirmDialog?.kind === "delete-page"
            ? `Delete page ${confirmDialog.page.pageNumber}?`
            : "Clear ink from this page?"
        }
        description={
          confirmDialog?.kind === "delete-page"
            ? "This removes the page's writing and text boxes. The other pages are renumbered."
            : "All handwriting and highlights on this page will be removed. Text boxes stay."
        }
        confirmLabel={
          confirmDialog?.kind === "delete-page" ? "Delete page" : "Clear ink"
        }
        busy={Boolean(deletingPageId)}
        onConfirm={() => {
          if (!confirmDialog) return;
          if (confirmDialog.kind === "delete-page") {
            const { page } = confirmDialog;
            setConfirmDialog(null);
            void handleDeletePage(page);
            return;
          }
          performClearCurrentPage();
          setConfirmDialog(null);
        }}
        onClose={() => setConfirmDialog(null)}
      />
    </main>
  );
}
