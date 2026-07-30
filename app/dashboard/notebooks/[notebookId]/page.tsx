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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import AppPage from "@/components/layout/AppPage";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import type { NotebookInkEditorHandle } from "@/components/workspace/NotebookInkEditor";
import InkColorPicker from "@/components/workspace/NotebookInkColorPicker";
import NotebookLivePageLayers from "@/components/workspace/NotebookLivePageLayers";
import { PAGE_COLOR_CLASS } from "@/components/workspace/NotebookPageBackground";
import NotebookPageStaticContent from "@/components/workspace/NotebookPageStaticContent";
import NotebookPageThumbnail from "@/components/workspace/NotebookPageThumbnail";
import NotebookSaveIndicator from "@/components/workspace/NotebookSaveIndicator";
import ThicknessSlider from "@/components/workspace/NotebookThicknessSlider";
import NotebookTextBlockOptions from "@/components/workspace/NotebookTextBlockOptions";
import ToolbarIconButton, {
  NotebookIcon,
} from "@/components/workspace/NotebookToolbarIconButton";
import NotebookViewport, {
  type NotebookViewportPreview,
} from "@/components/workspace/NotebookViewport";
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  Skeleton,
} from "@/components/ui";
import type { Feedback } from "@/lib/app/feedback";
import { useUser } from "@/components/providers/UserProvider";
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
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import type {
  NotebookFile,
  NotebookPage,
  NotebookPageColor,
  NotebookStrokeColor,
  NotebookStrokeTool,
  NotebookTextBlock,
  NotebookTextBlockResizeEdge,
} from "@/lib/workspace/notebooks";
import {
  MAX_NOTEBOOK_TEXT_BLOCK_TEXT,
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";
import {
  getNotebookPageStyleBackground,
  getNotebookStrokePaintColor,
  normalizeNotebookStrokes,
} from "@/lib/workspace/notebook-page-content";
import {
  getNotebookSwipePreviewDirection,
  isNotebookPageSwipePreviewEnabled,
  resolveNotebookCarouselPages,
  shouldShowNotebookNewPagePreview,
  type NotebookPageSwipeMotion as PageSwipeMotion,
} from "@/lib/workspace/notebook-carousel";
import {
  type NotebookEraserMode,
  type NotebookEraserSize,
} from "@/lib/workspace/notebook-eraser";
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
import { resolveNotebookPageBackgroundFileId } from "@/lib/workspace/notebook-pdf";
import {
  trackNotebookPdfCanvas,
  type NotebookPdfCanvasTracking,
} from "@/lib/workspace/notebook-pdf-canvas";
import {
  isNotebookToolbarSideDock,
  type NotebookToolbarDock,
} from "@/lib/workspace/notebook-toolbar";

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
};
type PageFrameSize = { width: number; height: number };
type NotebookConfirmRequest =
  | { kind: "clear-page" }
  | { kind: "delete-page"; page: NotebookPage };

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
const NOTEBOOK_TOOLBAR_DOCK_CLASS: Record<NotebookToolbarDock, string> = {
  top: "left-1/2 top-[0.9rem] -translate-x-1/2",
  right:
    "right-[calc(env(safe-area-inset-right,0px)+0.9rem)] top-1/2 -translate-y-1/2",
  bottom:
    "bottom-[var(--notebook-control-bottom-inset)] left-1/2 -translate-x-1/2",
  left:
    "left-[calc(env(safe-area-inset-left,0px)+0.9rem)] top-1/2 -translate-y-1/2",
};
const NOTEBOOK_TOOLBAR_POPOVER_DOCK_CLASS: Record<
  NotebookToolbarDock,
  string
> = {
  top: "left-1/2 top-[4.85rem] -translate-x-1/2",
  right:
    "right-[calc(env(safe-area-inset-right,0px)+4.85rem)] top-1/2 -translate-y-1/2",
  bottom:
    "bottom-[calc(var(--notebook-control-bottom-inset)+3.95rem)] left-1/2 -translate-x-1/2",
  left:
    "left-[calc(env(safe-area-inset-left,0px)+4.85rem)] top-1/2 -translate-y-1/2",
};
const TEXT_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "text-slate-950 placeholder:text-slate-400",
  black: "text-[#f8fafc] placeholder:text-slate-500",
};
// Each edge keeps a generous 32px invisible hit area, but the visible
// affordance is a slim grip bar sitting on the border, not a bubble.
const TEXT_BLOCK_RESIZE_HANDLES: Array<{
  edge: NotebookTextBlockResizeEdge;
  label: string;
  positionClass: string;
  gripClass: string;
}> = [
  {
    edge: "top",
    label: "Resize text box from top edge",
    positionClass: "left-1/2 top-0 h-8 w-8 -translate-x-1/2 -translate-y-1/2",
    gripClass: "h-[3px] w-4",
  },
  {
    edge: "right",
    label: "Resize text box from right edge",
    positionClass: "right-0 top-1/2 h-8 w-8 -translate-y-1/2 translate-x-1/2",
    gripClass: "h-4 w-[3px]",
  },
  {
    edge: "bottom",
    label: "Resize text box from bottom edge",
    positionClass: "bottom-0 left-1/2 h-8 w-8 -translate-x-1/2 translate-y-1/2",
    gripClass: "h-[3px] w-4",
  },
  {
    edge: "left",
    label: "Resize text box from left edge",
    positionClass: "left-0 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2",
    gripClass: "h-4 w-[3px]",
  },
];

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
    setTextBlocks,
    setPageColor,
    setPageStyle,
    setSaveStatus,
    setTool,
  } = pageState;
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const {
    notebook,
    setNotebook,
    pages,
    setPages,
    files,
    setFiles,
    fileUrls,
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
    onFeedback: setFeedback,
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
      setFeedback((current) =>
        current?.message === "Could not autosave this page." ? null : current
      ),
  });

  const [penColor, setPenColor] = useState<NotebookStrokeColor>("black");
  const [penThicknessPercent, setPenThicknessPercent] = useState(50);
  const [highlighterColor, setHighlighterColor] = useState<NotebookStrokeColor>("yellow");
  const [highlighterThicknessPercent, setHighlighterThicknessPercent] = useState(50);
  const [eraserMode, setEraserMode] = useState<NotebookEraserMode>("precision");
  const [eraserWidth, setEraserWidth] = useState<NotebookEraserSize>("medium");
  const [pageZoom, setPageZoom] = useState(1);
  const [pagePan, setPagePan] = useState<NotebookPagePan>({ x: 0, y: 0 });
  const [frameSize, setFrameSize] = useState<PageFrameSize>({ width: 0, height: 0 });
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<NotebookConfirmRequest | null>(null);
  const [inkEditorMountRevision, setInkEditorMountRevision] = useState(0);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [phoneFullEditing, setPhoneFullEditing] = useState(false);
  const [showAddPagesDialog, setShowAddPagesDialog] = useState(false);
  const [notebookFile, setNotebookFile] = useState<File | null>(null);
  const [notebookUploadProgress, setNotebookUploadProgress] = useState<number | null>(
    null
  );
  const [addingNotebookFile, setAddingNotebookFile] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [pagesDrawerOpen, setPagesDrawerOpen] = useState(false);
  const [penMenuOpen, setPenMenuOpen] = useState(false);
  const [highlighterMenuOpen, setHighlighterMenuOpen] = useState(false);
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const [pageSwipeMotion, setPageSwipeMotion] =
    useState<PageSwipeMotion | null>(null);
  const [pageSwipeInkSnapshot, setPageSwipeInkSnapshot] = useState<{
    pageId: string;
    svg: string;
  } | null>(null);
  const [createPageActive, setCreatePageActive] = useState(false);
  const [createPageProgress, setCreatePageProgress] = useState(0);
  const [creatingPage, setCreatingPage] = useState(false);
  const [createPageBounce, setCreatePageBounce] = useState(false);
  const [touchInkHintVisible, setTouchInkHintVisible] = useState(false);
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
  const editorRevisionRef = useRef(0);
  const ignoredTouchInkCountRef = useRef(0);
  const touchInkHintTimeoutRef = useRef<number | null>(null);
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
    isNavigationLocked: () => pageNavigationLockedRef.current,
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
  }, []);

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
  }, [loading, notebook?.id]);

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
  }, [frameSize, pageHeightPx, pageWidthPx]);

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
    onFeedback: setFeedback,
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
    setFeedback({
      type: "error",
      message: `A page can contain up to ${maximum} text boxes. Move or delete one before adding another.`,
    });
  }, []);

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
    isNavigationLocked: () => pageNavigationLockedRef.current,
    pageState,
    pageSurfaceRef,
    onChange: markPageUnsaved,
    onHistoryCommit: commitTextBlockHistory,
    onGestureStart: cancelCompetingPageGestures,
    onCreateLimitReached: handleTextBlockLimitReached,
    onCreateComplete: handleTextBlockCreated,
    onTouchPointerDown: (event) => handleTouchPointerDown(event),
    onTouchPointerMove: (event) => handleTouchPointerMove(event),
    onTouchPointerEnd: (event, options) =>
      handleTouchPointerEnd(event, options),
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const update = () => setIsPhoneLayout(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

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
    pageState.hydratePage(selectedPage.id, selectedPage.contentRevision);
    const recoveredDraft = takeRecoveredDraft(selectedPage.id);
    if (recoveredDraft) {
      editorRevisionRef.current = Math.max(1, recoveredDraft.localRevision);
      setSaveStatus("unsaved");
      setFeedback({
        type: "success",
        message: "Recovered unsaved work from this device. Syncing it now.",
      });
      schedulePendingWork();
    } else {
      editorRevisionRef.current = 0;
      setSaveStatus("saved");
    }
    window.requestAnimationFrame(() => maybeFinishPageHandoffRef.current());
  }, [
    cancelInkUiSync,
    clearInkHistory,
    setInkHasContent,
    notebook?.pageColor,
    notebook?.pageStyle,
    pageState,
    resetTextBlockInteraction,
    schedulePendingWork,
    selectedPage,
    setPageColor,
    setPageStyle,
    setSaveStatus,
    setTextBlocks,
    takeRecoveredDraft,
  ]);

  useEffect(() => {
    setPenColor((current) => {
      if (pageColor === "black" && current === "black") return "white";
      if (pageColor === "white" && current === "white") return "black";
      return current;
    });
  }, [pageColor]);

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
  const cancelPageSwipeForPinch = () => {
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
  };

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
    if (inkEditorRef.current?.isInteracting() || inkInteractionActiveRef.current) {
      return false;
    }
    if (
      hasSaveInFlight() ||
      pageState.read().saveStatus === "saving" ||
      pageState.read().saveStatus === "unsaved" ||
      pageState.read().saveStatus === "failed"
    ) {
      return saveCurrentPage({ flush: true });
    }
    return true;
  }, [hasSaveInFlight, inkInteractionActiveRef, pageState, saveCurrentPage]);

  const selectPageById = useCallback(
    async (pageId: string) => {
      if (pageId === pageState.read().selectedPage?.id) return true;
      if (pageNavigationLockedRef.current) return false;
      const ready = await prepareCurrentPageForNavigation();
      if (!ready) return false;
      setSelectedPageId(pageId);
      return true;
    },
    [pageState, prepareCurrentPageForNavigation, setSelectedPageId]
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
      const readyPromise = prepareCurrentPageForNavigation();
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
        setFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not save this page before changing pages.",
        });
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
      pageTrackOffsetRef,
      pageTrackTravelDistance,
      prefersReducedNotebookMotion,
      prepareCurrentPageForNavigation,
      returnPageTrackToSource,
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
      setFeedback({
        type: "error",
        message: "Could not autosave before leaving the notebook.",
      });
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

  const createBlankPageAtEnd = async (velocityX = -2) => {
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
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not add a new page.",
      });
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
  };

  const handleStartPageSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      !fullNotebookEditingEnabled ||
      !shouldPointerSwipePages(event.pointerType) ||
      pageNavigationLockedRef.current ||
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
    };
    safelySetPointerCapture(event.currentTarget, event.pointerId);
  };

  const handlePageSwipeMove = (event: ReactPointerEvent<HTMLElement>) => {
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
        if (swipe.intent === "page") {
          setPagePreviewVisibility(true);
        }
      }
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
  };

  const handleStopPageSwipe = (
    event: ReactPointerEvent<HTMLElement>,
    options: { allowTextTap?: boolean; cancelled?: boolean } = {}
  ) => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    safelyReleasePointerCapture(event.currentTarget, event.pointerId);
    pageSwipeRef.current = null;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;

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
  };

  const maybeShowIgnoredTouchInkHint = (event: ReactPointerEvent<HTMLElement>) => {
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
  };

  const handlePagePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!fullNotebookEditingEnabled) return;
    if (pageNavigationLockedRef.current) {
      event.preventDefault();
      event.stopPropagation();
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
  };

  const handlePagePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (handleTouchPointerMove(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handlePageSwipeMove(event);
    }
  };

  const handlePagePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
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
  };

  const handlePagePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    if (handleTouchPointerEnd(event, { cancelled: true })) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStopPageSwipe(event, { cancelled: true });
    }
  };

  const handleDeletePage = async (page: NotebookPage) => {
    if (!user?.uid || !notebook || !fullNotebookEditingEnabled) return;
    if (pages.length <= 1) {
      setFeedback({ type: "error", message: "A notebook needs at least one page." });
      return;
    }

    if (
      pageState.read().saveStatus === "unsaved" ||
      pageState.read().saveStatus === "failed"
    ) {
      const saved = await saveCurrentPage({ flush: true });
      if (!saved) {
        setFeedback({
          type: "error",
          message: "Could not autosave before deleting the page.",
        });
        return;
      }
    }

    setDeletingPageId(page.id);
    setFeedback(null);
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
      setSelectedPageId(nextSelectedPage?.id ?? null);
      resetTextBlockInteraction();
      setFeedback({ type: "success", message: `Page ${page.pageNumber} deleted.` });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not delete this page.",
      });
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
    setFeedback(null);
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
      setFeedback({
        type: "success",
        message: `${appended.pages.length} ${
          appended.pages.length === 1 ? "page" : "pages"
        } added to ${notebook.title}`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not add these pages to the notebook.",
      });
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
    switchNotebookTool,
  ]);

  const closeDrawingToolMenus = useCallback(() => {
    setPenMenuOpen(false);
    setHighlighterMenuOpen(false);
    setEraserMenuOpen(false);
  }, []);

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
        {penMenuOpen || highlighterMenuOpen || eraserMenuOpen ? (
            <div
              className={`notebook-toolbar-popover-in notebook-drawer-surface absolute z-50 w-[min(92vw,22rem)] rounded-[1.25rem] border border-[var(--color-border)] p-3.5 shadow-[0_18px_44px_rgba(0,0,0,0.32)] ${NOTEBOOK_TOOLBAR_POPOVER_DOCK_CLASS[toolbarDock]}`}
            >
              {penMenuOpen ? (
                <div className="space-y-3">
                  <InkColorPicker
                    label="Pen color"
                    value={penColor}
                    presets={["black", "white", "red", "green"]}
                    getPresetColor={(color) =>
                      getNotebookStrokePaintColor(color, "pen")
                    }
                    onPresetSelect={(color) => {
                      setPenColor(color);
                      switchNotebookTool("pen");
                    }}
                    onCustomColorChange={(color) => {
                      setPenColor(color);
                      switchNotebookTool("pen");
                    }}
                  />
                  <ThicknessSlider
                    label="Pen thickness"
                    percent={penThicknessPercent}
                    color={getNotebookStrokePaintColor(penColor, "pen")}
                    previewWidth={getPenWidthFromPercent(penThicknessPercent)}
                    onChange={(value) => {
                      setPenThicknessPercent(clampNotebookThicknessPercent(value));
                      switchNotebookTool("pen");
                    }}
                  />
                </div>
              ) : null}
              {highlighterMenuOpen ? (
                <div className="space-y-3">
                  <InkColorPicker
                    label="Highlighter color"
                    value={highlighterColor}
                    presets={["yellow", "green", "pink"]}
                    getPresetColor={(color) =>
                      getNotebookStrokePaintColor(color, "highlighter")
                    }
                    onPresetSelect={(color) => {
                      setHighlighterColor(color);
                      switchNotebookTool("highlighter");
                    }}
                    onCustomColorChange={(color) => {
                      setHighlighterColor(color);
                      switchNotebookTool("highlighter");
                    }}
                  />
                  <ThicknessSlider
                    label="Highlighter thickness"
                    percent={highlighterThicknessPercent}
                    color={getNotebookStrokePaintColor(highlighterColor, "highlighter")}
                    previewWidth={getHighlighterWidthFromPercent(highlighterThicknessPercent) / 2}
                    onChange={(value) => {
                      setHighlighterThicknessPercent(clampNotebookThicknessPercent(value));
                      switchNotebookTool("highlighter");
                    }}
                  />
                </div>
              ) : null}
              {eraserMenuOpen ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-text-secondary">
                      Eraser mode
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(["precision", "stroke"] as NotebookEraserMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          aria-label={`${mode} eraser mode`}
                          onClick={() => {
                            setEraserMode(mode);
                            switchNotebookTool("eraser");
                          }}
                          className={`min-h-11 rounded-full border px-3 py-2 text-xs font-semibold capitalize transition ${
                            eraserMode === mode ? "app-selected" : "app-chip"
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-text-secondary">
                      Eraser size
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {(["small", "medium", "large"] as NotebookEraserSize[]).map((width) => (
                        <button
                          key={width}
                          type="button"
                          aria-label={`${width} eraser`}
                          title={`${width[0].toUpperCase()}${width.slice(1)} eraser`}
                          onClick={() => {
                            setEraserWidth(width);
                            switchNotebookTool("eraser");
                          }}
                          className={`grid h-11 place-items-center rounded-full border transition ${
                            eraserWidth === width ? "app-selected" : "app-chip"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="rounded-full border-2 border-current"
                            style={{
                              width:
                                width === "small"
                                  ? "0.7rem"
                                  : width === "medium"
                                    ? "1rem"
                                    : "1.35rem",
                              height:
                                width === "small"
                                  ? "0.7rem"
                                  : width === "medium"
                                    ? "1rem"
                                    : "1.35rem",
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-[var(--color-border)] pt-2 sm:col-span-2">
                    <button
                      type="button"
                      disabled={!inkHasContent}
                      onClick={() => {
                        setEraserMenuOpen(false);
                        setConfirmDialog({ kind: "clear-page" });
                      }}
                      className="inline-flex min-h-[2.25rem] w-full items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--color-error-text)] transition hover:bg-[var(--color-error-text)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <NotebookIcon name="trash" />
                      Clear ink from this page
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

        {feedback ? (
          <div className="absolute left-3 right-3 top-3 z-50 mx-auto max-w-2xl">
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
          </div>
        ) : null}

        {draftConflict && draftConflict.pageId === selectedPage?.id ? (
          <div
            className={`absolute left-3 right-3 z-50 mx-auto max-w-2xl ${
              feedback ? "top-24" : "top-3"
            }`}
          >
            <Card
              padding="sm"
              role="alert"
              className="border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] shadow-[var(--shadow-shell)]"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    Unsaved work found on this device
                  </p>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    The synced page changed after this recovery copy was made. Choose which version to keep.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleKeepSavedDraftVersion}
                  >
                    Keep synced
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleRestoreLocalDraft}
                  >
                    Restore mine
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {showAddPagesDialog ? (
          <div className="absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-sm sm:items-center sm:p-4">
            <Card
              padding="sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-notebook-pages-title"
              aria-describedby="add-notebook-pages-description"
              className="my-4 w-full max-w-lg"
            >
              <div>
                <div
                  id="add-notebook-pages-title"
                  className="text-sm font-semibold text-text-primary"
                >
                  Add PDF or image pages
                </div>
                <p
                  id="add-notebook-pages-description"
                  className="mt-0.5 text-xs leading-5 text-text-muted"
                >
                  The new pages will be added after the current last page.
                </p>
              </div>
              <label className="mt-4 block">
                <span className="sr-only">PDF or image</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={addingNotebookFile}
                  onChange={(event) =>
                    setNotebookFile(event.target.files?.[0] ?? null)
                  }
                  className="block min-h-[2.75rem] w-full rounded-xl border border-border bg-surface-panel-strong px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-warm-glow file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-warm-accent disabled:cursor-not-allowed"
                />
              </label>
              {addingNotebookFile && notebookUploadProgress !== null ? (
                <div
                  role="progressbar"
                  aria-label="Notebook file upload progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={notebookUploadProgress}
                  className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-glass-subtle)]"
                >
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
                    style={{ width: `${notebookUploadProgress}%` }}
                  />
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={addingNotebookFile}
                  onClick={closeAddPagesDialog}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!notebookFile || addingNotebookFile}
                  onClick={() => void handleAddNotebookFile()}
                >
                  {addingNotebookFile
                    ? notebookUploadProgress !== null
                      ? `Adding ${notebookUploadProgress}%`
                      : "Adding pages..."
                    : "Add pages"}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        {isPhoneLayout ? (
          <div className="absolute left-3 right-3 top-3 z-30 mx-auto max-w-2xl">
          <Card tone="warm" padding="sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  Notebook editing works best on iPad or desktop.
                </div>
                <p className="mt-1 text-sm text-text-secondary">
                  View pages and edit text here, or continue anyway for full controls.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={phoneFullEditing ? "secondary" : "primary"}
                  onClick={() => setPhoneFullEditing((value) => !value)}
                >
                  {phoneFullEditing ? "Use light mode" : "Continue anyway"}
                </Button>
                <Link
                  href="/dashboard/study"
                  className="app-button-secondary inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium transition duration-fast"
                >
                  Go to flashcards
                </Link>
              </div>
            </div>
          </Card>
          </div>
        ) : null}

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
          <aside
            aria-label="Notebook pages"
            className="notebook-drawer-in notebook-drawer-surface absolute bottom-0 left-0 top-0 z-50 flex min-h-0 w-64 flex-col border-r border-[var(--color-border)] p-3 shadow-[18px_0_42px_rgba(0,0,0,0.2)]"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                Pages
              </div>
              <span className="app-chip rounded-full px-2 py-0.5 text-[0.68rem] font-semibold tabular-nums">
                {pages.length}
              </span>
            </div>
            <div className="grid shrink-0 grid-cols-1 gap-2 px-1 pb-3">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="w-full gap-1.5"
                disabled={
                  !fullNotebookEditingEnabled ||
                  creatingPage ||
                  Boolean(pageSwipeMotion)
                }
                onClick={() => void createBlankPageAtEnd()}
              >
                <NotebookIcon name="plus" />
                New page
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="w-full"
                disabled={!fullNotebookEditingEnabled}
                onClick={() => setShowAddPagesDialog(true)}
              >
                Import PDF or image
              </Button>
            </div>
            <div
              role="region"
              aria-label="Notebook page list"
              className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pr-1"
            >
              {pages.length > 0 ? (
                pages.map((page) => {
                  const selected = page.id === selectedPage?.id;
                  const deleting = deletingPageId === page.id;
                  const thumbnailBackground = resolvePageBackground(page);
                  return (
                    <div
                      key={page.id}
                      className={`group relative rounded-[0.95rem] border transition ${
                        selected
                          ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] shadow-[0_0_0_3px_rgba(143,125,232,0.14)]"
                          : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)]"
                      }`}
                    >
                      <button
                        type="button"
                        aria-label={`Open page ${page.pageNumber}`}
                        aria-current={selected ? "page" : undefined}
                        disabled={Boolean(pageSwipeMotion)}
                        onClick={() => {
                          setPagesDrawerOpen(false);
                          void selectPageById(page.id);
                        }}
                        className="block w-full rounded-[0.95rem] p-1.5 text-left transition"
                      >
                        <NotebookPageThumbnail
                          page={page}
                          notebook={notebook}
                          backgroundFile={thumbnailBackground.file ?? undefined}
                          backgroundUrl={thumbnailBackground.url}
                        />
                      </button>
                      {pages.length > 1 ? (
                        <button
                          type="button"
                          aria-label={`Delete Page ${page.pageNumber}`}
                          title={`Delete Page ${page.pageNumber}`}
                          disabled={
                            Boolean(deletingPageId) ||
                            !fullNotebookEditingEnabled ||
                            Boolean(pageSwipeMotion)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirmDialog({ kind: "delete-page", page });
                          }}
                          className="absolute right-3 top-3 inline-grid h-8 w-8 place-items-center rounded-full bg-error text-[var(--color-text-inverse)] shadow-[0_3px_10px_rgba(0,0,0,0.35)] transition hover:scale-105 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {deleting ? (
                            <span className="text-[0.65rem] font-bold">...</span>
                          ) : (
                            <NotebookIcon name="trash" />
                          )}
                        </button>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 text-sm leading-6 text-text-muted">
                  Start with a fresh page using New page above.
                </div>
              )}
            </div>
          </aside>
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
                    editingEnabled={fullNotebookEditingEnabled}
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
                        setFeedback({
                          type: "error",
                          message:
                            "This page opened, but the ink editor could not start. Your saved writing is still visible.",
                        });
                        window.requestAnimationFrame(() =>
                          maybeFinishPageHandoffRef.current()
                        );
                      },
                      activeTool: tool,
                      eraserMode,
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
                  <div className="pointer-events-none absolute inset-0 z-30">
                    {textBlocks.map((block) => {
                      const selected = selectedTextBlockId === block.id;
                      const editing = editingTextBlockId === block.id;
                      const gesturing = activeTextGestureId === block.id;
                      const displayText = block.text.trim() ? block.text : selected ? "Tap again to type" : "";
                      const frameBorderClass =
                        pageColor === "black" ? "border-white/55" : "border-slate-950/40";
                      const idleBorderClass = block.outlineVisible
                        ? pageColor === "black"
                          ? "border-white/30"
                          : "border-slate-950/25"
                        : "border-transparent";
                      const optionsOpen = openTextBlockOptionsId === block.id;
                      const optionsOpenAbove =
                        block.y + block.height / 2 > CANVAS_HEIGHT / 2;
                      const optionsAlignFromLeft = block.x + block.width < 420;
                      return (
                        <div
                          key={block.id}
                          className={`notebook-text-object pointer-events-auto absolute rounded-[0.45rem] border bg-transparent transition-[border-color,box-shadow] duration-150 ${
                            editing
                              ? `cursor-text ${frameBorderClass} shadow-[0_2px_12px_rgba(0,0,0,0.12)]`
                              : selected
                                ? `cursor-grab touch-none select-none ${frameBorderClass} active:cursor-grabbing`
                                : `cursor-grab touch-none select-none ${idleBorderClass} active:cursor-grabbing`
                          }`}
                          style={{
                            left: `${(block.x / CANVAS_WIDTH) * 100}%`,
                            top: `${(block.y / CANVAS_HEIGHT) * 100}%`,
                            width: `${(block.width / CANVAS_WIDTH) * 100}%`,
                            height: `${(block.height / CANVAS_HEIGHT) * 100}%`,
                          }}
                          onPointerDown={(event) =>
                            handleTextBlockPointerDown(block, event)
                          }
                          onPointerMove={(event) =>
                            handleTextBlockPointerMove(block, event)
                          }
                          onPointerUp={(event) =>
                            handleTextBlockPointerUp(block, event)
                          }
                          onPointerCancel={(event) =>
                            handleTextBlockPointerCancel(block, event)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            selectTextBlock(block.id);
                          }}
                        >
                          {selected && fullNotebookEditingEnabled && !gesturing ? (
                            <>
                              <NotebookTextBlockOptions
                                blockId={block.id}
                                open={optionsOpen}
                                outlineVisible={block.outlineVisible}
                                openAbove={optionsOpenAbove}
                                alignFromLeft={optionsAlignFromLeft}
                                onOpenChange={(open) =>
                                  setTextBlockOptionsOpen(block.id, open)
                                }
                                onToggleOutline={() =>
                                  toggleTextBlockOutline(block.id)
                                }
                                onDelete={() => deleteTextBlock(block.id)}
                                onKeyDown={(event) =>
                                  handleTextBlockOptionsKeyDown(
                                    block.id,
                                    event
                                  )
                                }
                              />
                              {TEXT_BLOCK_RESIZE_HANDLES.map((handle) => (
                                <button
                                  key={handle.edge}
                                  type="button"
                                  data-text-resize-handle="true"
                                  aria-label={handle.label}
                                  title={handle.label}
                                  className={`group absolute z-20 inline-grid touch-none place-items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-selected-border)] ${handle.positionClass}`}
                                  onPointerDown={(event) =>
                                    startTextBlockResize(block, handle.edge, event)
                                  }
                                  onPointerMove={resizeTextBlock}
                                  onPointerUp={stopTextBlockResize}
                                  onPointerCancel={stopTextBlockResize}
                                >
                                  <span
                                    aria-hidden="true"
                                    className={`rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition group-hover:scale-110 ${
                                      pageColor === "black" ? "bg-white/75" : "bg-slate-950/55"
                                    } ${handle.gripClass}`}
                                  />
                                </button>
                              ))}
                            </>
                          ) : null}
                          {editing && fullNotebookEditingEnabled ? (
                            <textarea
                              value={block.text}
                              maxLength={MAX_NOTEBOOK_TEXT_BLOCK_TEXT}
                              autoFocus
                              onPointerDown={(event) => event.stopPropagation()}
                              onPointerMove={(event) => event.stopPropagation()}
                              onPointerUp={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.stopPropagation();
                                  stopEditingTextBlock();
                                }
                              }}
                              onFocus={() => selectTextBlock(block.id)}
                              onChange={(event) => updateTextBlock(block.id, { text: event.target.value })}
                              placeholder="Type here..."
                              data-notebook-text-editor="true"
                              className={`notebook-text-editor h-full w-full resize-none rounded-[0.45rem] bg-transparent p-2 pr-16 text-sm font-medium leading-6 outline-none ${TEXT_COLOR_CLASS[pageColor]}`}
                            />
                          ) : (
                            <div
                              className={`h-full w-full overflow-hidden whitespace-pre-wrap rounded-[0.45rem] p-2 pr-10 text-sm font-medium leading-6 ${
                                pageColor === "black" ? "text-[#f8fafc]" : "text-slate-950"
                              } ${block.text.trim() ? "" : "opacity-60"}`}
                            >
                              {displayText}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
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
              <div
                className={`pointer-events-none absolute z-40 ${NOTEBOOK_TOOLBAR_DOCK_CLASS[toolbarDock]}`}
              >
                <div
                  ref={drawingToolbarRef}
                  role="toolbar"
                  aria-label="Drawing tools"
                  aria-orientation={
                    isNotebookToolbarSideDock(toolbarDock)
                      ? "vertical"
                      : "horizontal"
                  }
                  title="Drag the toolbar to dock it to another edge"
                  data-toolbar-dock={toolbarDock}
                  {...toolbarBindings}
                  className={`notebook-dockable-toolbar notebook-floating-control pointer-events-auto flex items-center gap-1 rounded-full border border-[var(--color-border)] p-1.5 ${
                    isNotebookToolbarSideDock(toolbarDock)
                      ? "flex-col"
                      : "flex-row"
                  } cursor-grab data-[toolbar-dragging=true]:cursor-grabbing data-[toolbar-dragging=true]:border-[var(--color-border-strong)]`}
                >
                  <div className="relative">
                    <ToolbarIconButton
                      label="Pen (P)"
                      icon="pen"
                      active={tool === "pen" || penMenuOpen}
                      onClick={() => {
                        setHighlighterMenuOpen(false);
                        setEraserMenuOpen(false);
                        if (tool !== "pen") {
                          switchNotebookTool("pen");
                          setPenMenuOpen(false);
                          return;
                        }
                        setPenMenuOpen((value) => !value);
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-[0.35rem] left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full"
                        style={{
                          backgroundColor: getNotebookStrokePaintColor(
                            penColor,
                            "pen"
                          ),
                        }}
                      />
                    </ToolbarIconButton>
                  </div>
                  <div className="relative">
                    <ToolbarIconButton
                      label="Highlighter (H)"
                      icon="highlighter"
                      active={tool === "highlighter" || highlighterMenuOpen}
                      onClick={() => {
                        setPenMenuOpen(false);
                        setEraserMenuOpen(false);
                        if (tool !== "highlighter") {
                          switchNotebookTool("highlighter");
                          setHighlighterMenuOpen(false);
                          return;
                        }
                        setHighlighterMenuOpen((value) => !value);
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-[0.35rem] left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full"
                        style={{
                          backgroundColor: getNotebookStrokePaintColor(
                            highlighterColor,
                            "highlighter"
                          ),
                        }}
                      />
                    </ToolbarIconButton>
                  </div>
                  <div className="relative">
                    <ToolbarIconButton
                      label="Eraser (E)"
                      icon="eraser"
                      active={tool === "eraser" || eraserMenuOpen}
                      onClick={() => {
                        setPenMenuOpen(false);
                        setHighlighterMenuOpen(false);
                        if (tool !== "eraser") {
                          switchNotebookTool("eraser");
                          setEraserMenuOpen(false);
                          return;
                        }
                        setEraserMenuOpen((value) => !value);
                      }}
                    />
                  </div>
                  <ToolbarIconButton
                    label="Text box (T)"
                    icon="text"
                    active={tool === "text"}
                    onClick={() => {
                      setPenMenuOpen(false);
                      setHighlighterMenuOpen(false);
                      setEraserMenuOpen(false);
                      switchNotebookTool(
                        pageState.read().tool === "text" ? "select" : "text"
                      );
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className={`shrink-0 rounded-full bg-[var(--color-border)] ${
                      isNotebookToolbarSideDock(toolbarDock)
                        ? "my-0.5 h-px w-6"
                        : "mx-0.5 h-6 w-px"
                    }`}
                  />
                  <ToolbarIconButton
                    label="Undo (Ctrl+Z)"
                    icon="undo"
                    disabled={undoDepth === 0}
                    onClick={() => {
                      setPenMenuOpen(false);
                      setHighlighterMenuOpen(false);
                      setEraserMenuOpen(false);
                      handleUndo();
                    }}
                  />
                  <ToolbarIconButton
                    label="Redo (Ctrl+Shift+Z)"
                    icon="redo"
                    disabled={redoDepth === 0}
                    onClick={() => {
                      setPenMenuOpen(false);
                      setHighlighterMenuOpen(false);
                      setEraserMenuOpen(false);
                      handleRedo();
                    }}
                  />
                </div>
              </div>
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
