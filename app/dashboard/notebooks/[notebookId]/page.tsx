"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import AppPage from "@/components/layout/AppPage";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/components/workspace/object-card-styles";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { useUser } from "@/lib/auth/user-context";
import type {
  Notebook,
  NotebookFile,
  NotebookPage,
  NotebookPageColor,
  NotebookPageStatus,
  NotebookPenColor,
  NotebookStrokeTool,
  NotebookTextBlock,
} from "@/lib/workspace/notebooks";
import { buildTypedContentFromTextBlocks } from "@/lib/workspace/notebooks";
import {
  appendInkPoints,
  clampNotebookPageZoom,
  finalizeInkStroke,
  getNotebookPageIndexAfterSwipe,
  getNotebookSwipeDirection,
  getNotebookPageZoomAfterPinch,
  getPinchDistance,
  getPointerClientSamples,
  mapClientPointToNotebookPage,
  shouldPointerDraw,
  shouldPointerSwipePages,
  type PointerClientSample,
} from "@/lib/workspace/notebook-inking";
import {
  createNotebookPage,
  getNotebookById,
  getNotebookFiles,
  getNotebookPages,
  updateNotebook,
  updateNotebookPage,
} from "@/services/study/notebooks";

type Feedback = { type: "success" | "error"; message: string };
type Point = { x: number; y: number };
type Stroke = {
  points: Point[];
  color: NotebookPenColor;
  width: number;
  tool: NotebookStrokeTool;
};
type LiveInkPoint = Point & { pressure: number };
type LiveStroke = Omit<Stroke, "points"> & {
  points: LiveInkPoint[];
};
type SaveStatus = "saved" | "unsaved" | "saving" | "failed";
type EditorTool = NotebookStrokeTool | "text";
type PenWidth = "thin" | "medium" | "thick";
type EraserWidth = "small" | "medium" | "large";
type EraserCursorState = {
  x: number;
  y: number;
  visible: boolean;
};
type TextBlockDragState = {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  pageWidth: number;
  pageHeight: number;
  previousTextBlocks: NotebookTextBlock[];
};
type TextBlockResizeState = {
  id: string;
  startX: number;
  startY: number;
  originWidth: number;
  originHeight: number;
  pageWidth: number;
  pageHeight: number;
  previousTextBlocks: NotebookTextBlock[];
};
type ActiveStrokeState = {
  pointerId: number;
  stroke: Stroke;
  liveStroke: LiveStroke;
};
type PageSwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  lastX: number;
  lastY: number;
  completed: boolean;
};
type PinchZoomState = {
  startDistance: number;
  startZoom: number;
};
type EditorViewportState = {
  height: number;
  isLandscape: boolean;
};
type NotebookUndoAction =
  | {
      type: "strokes";
      previous: Stroke[];
      next: Stroke[];
    }
  | {
      type: "textBlocks";
      previous: NotebookTextBlock[];
      next: NotebookTextBlock[];
    };

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 1240;
const NOTEBOOK_PAGE_BASE_WIDTH_REM = 48;
const NOTEBOOK_PAGE_ASPECT_RATIO = CANVAS_HEIGHT / CANVAS_WIDTH;
const NOTEBOOK_PAGE_LANDSCAPE_VERTICAL_GUTTER = 88;
const PAGE_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "bg-[#f8fafc] text-slate-950",
  black: "bg-[#080a10] text-[#f8fafc]",
};
const PAGE_COLOR_HEX: Record<NotebookPageColor, string> = {
  white: "#f8fafc",
  black: "#080a10",
};
const PEN_COLOR_HEX: Record<NotebookPenColor, string> = {
  black: "#111827",
  white: "#f8fafc",
  red: "#ef4444",
  green: "#22c55e",
};
const TEXT_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "text-slate-950 placeholder:text-slate-400",
  black: "text-[#f8fafc] placeholder:text-slate-500",
};
const PEN_WIDTH_VALUE: Record<PenWidth, number> = {
  thin: 3,
  medium: 5,
  thick: 9,
};
const ERASER_WIDTH_VALUE: Record<EraserWidth, number> = {
  small: 16,
  medium: 24,
  large: 36,
};

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && typeof point.y === "number";
}

function normalizeStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value)) return [];

  const strokes: Stroke[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const points = (entry as { points?: unknown }).points;
    if (!Array.isArray(points)) continue;
    const cleanPoints = points.filter(isPoint).slice(0, 1_200);
    if (cleanPoints.length > 0) {
      const stroke = entry as Record<string, unknown>;
      const color =
        stroke.color === "white" ||
        stroke.color === "red" ||
        stroke.color === "green" ||
        stroke.color === "black"
          ? stroke.color
          : "black";
      const tool = stroke.tool === "eraser" ? "eraser" : "pen";
      const width =
        typeof stroke.width === "number" && Number.isFinite(stroke.width)
          ? Math.max(1, Math.min(48, Math.round(stroke.width)))
          : tool === "eraser"
            ? 18
            : 5;
      strokes.push({ points: cleanPoints, color, tool, width });
    }
  }

  return strokes;
}

function makeTextBlockId() {
  return `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampTextBlock(block: NotebookTextBlock): NotebookTextBlock {
  const width = Math.max(120, Math.min(CANVAS_WIDTH, Math.round(block.width)));
  const height = Math.max(48, Math.min(CANVAS_HEIGHT, Math.round(block.height)));
  return {
    ...block,
    width,
    height,
    x: Math.max(0, Math.min(CANVAS_WIDTH - width, Math.round(block.x))),
    y: Math.max(0, Math.min(CANVAS_HEIGHT - height, Math.round(block.y))),
  };
}

function strokePaintColor(stroke: Stroke | LiveStroke, pageColor: NotebookPageColor) {
  return stroke.tool === "eraser" ? PAGE_COLOR_HEX[pageColor] : PEN_COLOR_HEX[stroke.color];
}

function drawStrokePath(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  pageColor: NotebookPageColor
) {
  if (stroke.points.length === 0) return;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = strokePaintColor(stroke, pageColor);
  context.fillStyle = strokePaintColor(stroke, pageColor);
  context.lineWidth = stroke.width;

  if (stroke.points.length === 1) {
    const [point] = stroke.points;
    context.beginPath();
    context.arc(point.x, point.y, Math.max(1, stroke.width / 2), 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  const [firstPoint] = stroke.points;
  context.beginPath();
  context.moveTo(firstPoint.x, firstPoint.y);

  for (let index = 1; index < stroke.points.length - 1; index += 1) {
    const currentPoint = stroke.points[index];
    const nextPoint = stroke.points[index + 1];
    context.quadraticCurveTo(
      currentPoint.x,
      currentPoint.y,
      (currentPoint.x + nextPoint.x) / 2,
      (currentPoint.y + nextPoint.y) / 2
    );
  }

  const lastPoint = stroke.points[stroke.points.length - 1];
  context.lineTo(lastPoint.x, lastPoint.y);
  context.stroke();
  context.restore();
}

function getLivePointWidth(stroke: LiveStroke, point: LiveInkPoint) {
  if (stroke.tool === "eraser") return stroke.width;
  return Math.max(1, stroke.width * (0.72 + point.pressure * 0.42));
}

function drawLiveStrokePath(
  context: CanvasRenderingContext2D,
  stroke: LiveStroke,
  pageColor: NotebookPageColor
) {
  if (stroke.points.length === 0) return;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = strokePaintColor(stroke, pageColor);
  context.fillStyle = strokePaintColor(stroke, pageColor);

  if (stroke.points.length === 1) {
    const [point] = stroke.points;
    const width = getLivePointWidth(stroke, point);
    context.beginPath();
    context.arc(point.x, point.y, Math.max(1, width / 2), 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    const previousPoint = stroke.points[index - 1];
    const currentPoint = stroke.points[index];
    const midpoint = {
      x: (previousPoint.x + currentPoint.x) / 2,
      y: (previousPoint.y + currentPoint.y) / 2,
    };

    context.beginPath();
    context.lineWidth = getLivePointWidth(stroke, currentPoint);
    context.moveTo(previousPoint.x, previousPoint.y);
    context.quadraticCurveTo(previousPoint.x, previousPoint.y, midpoint.x, midpoint.y);
    context.stroke();
  }

  context.restore();
}

function prepareNotebookCanvas(canvas: HTMLCanvasElement) {
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(CANVAS_WIDTH * pixelRatio);
  const height = Math.round(CANVAS_HEIGHT * pixelRatio);

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  return context;
}

function clearNotebookCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  prepareNotebookCanvas(canvas);
}

function drawSavedNotebookCanvas(input: {
  canvas: HTMLCanvasElement;
  strokes: Stroke[];
  pageColor: NotebookPageColor;
}) {
  const context = prepareNotebookCanvas(input.canvas);
  if (!context) return;

  for (const stroke of input.strokes) {
    drawStrokePath(context, stroke, input.pageColor);
  }
}

function drawLiveInkCanvas(input: {
  canvas: HTMLCanvasElement;
  activeStroke: LiveStroke | null;
  pageColor: NotebookPageColor;
}) {
  const context = prepareNotebookCanvas(input.canvas);
  if (!context || !input.activeStroke) return;
  drawLiveStrokePath(context, input.activeStroke, input.pageColor);
}

function shouldAppendLiveInkPoint(
  points: LiveInkPoint[],
  point: LiveInkPoint,
  minDistance = 1.35
) {
  if (points.length < 3) return true;
  const previousPoint = points[points.length - 1];
  const dx = point.x - previousPoint.x;
  const dy = point.y - previousPoint.y;
  return dx * dx + dy * dy >= minDistance * minDistance;
}

function appendLiveInkPoints(
  currentPoints: LiveInkPoint[],
  incomingPoints: LiveInkPoint[],
  maxPoints: number
) {
  const nextPoints = [...currentPoints];
  for (const point of incomingPoints) {
    if (nextPoints.length >= maxPoints) break;
    if (shouldAppendLiveInkPoint(nextPoints, point)) {
      nextPoints.push(point);
    }
  }
  return nextPoints;
}

function strokeTouchesEraser(stroke: Stroke, eraser: Stroke) {
  const radius = Math.max(12, eraser.width * 1.2);
  const radiusSquared = radius * radius;
  return stroke.points.some((strokePoint) =>
    eraser.points.some((eraserPoint) => {
      const dx = strokePoint.x - eraserPoint.x;
      const dy = strokePoint.y - eraserPoint.y;
      return dx * dx + dy * dy <= radiusSquared;
    })
  );
}

type NotebookIconName =
  | "back"
  | "pages"
  | "text"
  | "pen"
  | "eraser"
  | "undo"
  | "clear"
  | "settings"
  | "ai"
  | "plus"
  | "save"
  | "chevron"
  | "trash"
  | "dots";

function NotebookIcon({ name }: { name: NotebookIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]">
      {name === "back" ? <path {...common} d="M15 18l-6-6 6-6" /> : null}
      {name === "pages" ? (
        <>
          <path {...common} d="M7 4h9.5A2.5 2.5 0 0 1 19 6.5V19H8.5A3.5 3.5 0 0 0 5 22V6A2 2 0 0 1 7 4Z" />
          <path {...common} d="M8 19V6.5A2.5 2.5 0 0 1 10.5 4" />
        </>
      ) : null}
      {name === "text" ? (
        <>
          <path {...common} d="M5 6h14M12 6v12M9 18h6" />
          <path {...common} d="M5 9V6h14v3" />
        </>
      ) : null}
      {name === "pen" ? (
        <>
          <path {...common} d="M4 20l4.2-1 10-10a2.2 2.2 0 0 0-3.1-3.1l-10 10L4 20Z" />
          <path {...common} d="M13.5 7.5l3 3" />
        </>
      ) : null}
      {name === "eraser" ? (
        <>
          <path {...common} d="M4 15.5 12.5 7a2.8 2.8 0 0 1 4 0l1.5 1.5a2.8 2.8 0 0 1 0 4L11.5 19H7.5L4 15.5Z" />
          <path {...common} d="M9 10.5l4.5 4.5M11.5 19H20" />
        </>
      ) : null}
      {name === "undo" ? (
        <path {...common} d="M9 8H5V4M5 8c2-2.6 5.6-4.1 9-2.7 4.8 2 5.8 8.1 2.1 11.4-2.5 2.2-6.2 2.4-8.8.5" />
      ) : null}
      {name === "clear" ? (
        <>
          <path {...common} d="M6 7h12M10 7V5h4v2M8 10v8M12 10v8M16 10v8" />
          <path {...common} d="M7 7l1 14h8l1-14" />
        </>
      ) : null}
      {name === "settings" ? (
        <>
          <path {...common} d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
          <path {...common} d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 3.1h5l.3-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" />
        </>
      ) : null}
      {name === "ai" ? (
        <path {...common} d="M12 3l1.6 5 5.1 1.6-5.1 1.7L12 16l-1.6-4.7-5.1-1.7 5.1-1.6L12 3ZM18 15l.7 2.1L21 18l-2.3.8L18 21l-.8-2.2L15 18l2.2-.9L18 15Z" />
      ) : null}
      {name === "plus" ? <path {...common} d="M12 5v14M5 12h14" /> : null}
      {name === "save" ? (
        <>
          <path {...common} d="M5 5h11l3 3v11H5V5Z" />
          <path {...common} d="M8 5v5h7V5M8 19v-5h8v5" />
        </>
      ) : null}
      {name === "chevron" ? <path {...common} d="m7 10 5 5 5-5" /> : null}
      {name === "trash" ? (
        <>
          <path {...common} d="M6 7h12M10 7V5h4v2M8 10v8M12 10v8M16 10v8" />
          <path {...common} d="M7 7l1 14h8l1-14" />
        </>
      ) : null}
      {name === "dots" ? (
        <>
          <circle cx="6.5" cy="12" r="1.35" fill="currentColor" />
          <circle cx="12" cy="12" r="1.35" fill="currentColor" />
          <circle cx="17.5" cy="12" r="1.35" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}

function ToolbarIconButton({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  icon: NotebookIconName;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-10 min-w-10 items-center justify-center rounded-full border text-sm font-semibold transition disabled:cursor-not-allowed disabled:!border-[var(--button-disabled-border)] disabled:!bg-[var(--button-disabled-bg)] disabled:!text-[var(--button-disabled-text)] disabled:saturate-[0.82] ${
        active
          ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-[var(--color-selected-text)]"
          : "border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)]"
      }`}
    >
      <NotebookIcon name={icon} />
      {children}
    </button>
  );
}

export default function NotebookEditorPage() {
  const { user } = useUser();
  const router = useRouter();
  const params = useParams<{ notebookId?: string | string[] }>();
  const notebookId = Array.isArray(params.notebookId)
    ? params.notebookId[0]
    : params.notebookId;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [textBlocks, setTextBlocks] = useState<NotebookTextBlock[]>([]);
  const [selectedTextBlockId, setSelectedTextBlockId] = useState<string | null>(null);
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pageColor, setPageColor] = useState<NotebookPageColor>("white");
  const [penColor, setPenColor] = useState<NotebookPenColor>("black");
  const [penWidth, setPenWidth] = useState<PenWidth>("medium");
  const [eraserWidth, setEraserWidth] = useState<EraserWidth>("medium");
  const [eraserCursor, setEraserCursor] = useState<EraserCursorState>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [undoDepth, setUndoDepth] = useState(0);
  const [pageZoom, setPageZoom] = useState(1);
  const [userAdjustedZoom, setUserAdjustedZoom] = useState(false);
  const [editorViewport, setEditorViewport] = useState<EditorViewportState>({
    height: 0,
    isLandscape: false,
  });
  const [tool, setTool] = useState<EditorTool>("pen");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [loading, setLoading] = useState(true);
  const [addingPage, setAddingPage] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [phoneFullEditing, setPhoneFullEditing] = useState(false);
  const [showNotebookSettings, setShowNotebookSettings] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState("");
  const [notebookColor, setNotebookColor] = useState<ObjectColorId>("sky");
  const [notebookIcon, setNotebookIcon] = useState<ObjectIconId>("none");
  const [notebookDefaultPageColor, setNotebookDefaultPageColor] =
    useState<NotebookPageColor>("white");
  const [savingNotebookSettings, setSavingNotebookSettings] = useState(false);
  const [aiPlaceholderOpen, setAiPlaceholderOpen] = useState(false);
  const [pagesDrawerOpen, setPagesDrawerOpen] = useState(false);
  const [penMenuOpen, setPenMenuOpen] = useState(false);
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const [activeTextGestureId, setActiveTextGestureId] = useState<string | null>(null);
  const textBlockDragRef = useRef<TextBlockDragState | null>(null);
  const textBlockResizeRef = useRef<TextBlockResizeState | null>(null);
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const savedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<ActiveStrokeState | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const savedCanvasFrameRef = useRef<number | null>(null);
  const liveCanvasFrameRef = useRef<number | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const selectedPageRef = useRef<NotebookPage | null>(null);
  const textBlocksRef = useRef<NotebookTextBlock[]>([]);
  const saveStatusRef = useRef<SaveStatus>("saved");
  const pageColorRef = useRef<NotebookPageColor>("white");
  const pageSwipeRef = useRef<PageSwipeState | null>(null);
  const touchPointersRef = useRef<Map<number, PointerClientSample>>(new Map());
  const pinchZoomRef = useRef<PinchZoomState | null>(null);
  const undoStackRef = useRef<NotebookUndoAction[]>([]);
  const fullNotebookEditingEnabled = !isPhoneLayout || phoneFullEditing;

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );
  const selectedPageIndex = useMemo(
    () => pages.findIndex((page) => page.id === selectedPage?.id),
    [pages, selectedPage?.id]
  );
  const landscapeFitZoom = useMemo(() => {
    if (!editorViewport.isLandscape || editorViewport.height <= 0) return 1;
    const rootFontSize =
      typeof window === "undefined"
        ? 16
        : Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const basePageHeight = NOTEBOOK_PAGE_BASE_WIDTH_REM * rootFontSize * NOTEBOOK_PAGE_ASPECT_RATIO;
    const availableHeight = Math.max(320, editorViewport.height - NOTEBOOK_PAGE_LANDSCAPE_VERTICAL_GUTTER);
    return clampNotebookPageZoom(Math.min(1, availableHeight / basePageHeight));
  }, [editorViewport.height, editorViewport.isLandscape]);

  useEffect(() => {
    selectedPageRef.current = selectedPage;
  }, [selectedPage]);

  useEffect(() => {
    textBlocksRef.current = textBlocks;
  }, [textBlocks]);

  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const landscapeQuery = window.matchMedia("(orientation: landscape) and (min-width: 768px)");
    const updateViewport = () => {
      setEditorViewport({
        height: window.innerHeight,
        isLandscape: landscapeQuery.matches,
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    landscapeQuery.addEventListener("change", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      landscapeQuery.removeEventListener("change", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (editorViewport.isLandscape) {
      setUserAdjustedZoom(false);
    }
  }, [editorViewport.isLandscape]);

  useEffect(() => {
    if (!editorViewport.isLandscape || userAdjustedZoom) return;
    setPageZoom(landscapeFitZoom);
  }, [editorViewport.isLandscape, landscapeFitZoom, userAdjustedZoom]);

  const pushUndoAction = useCallback((action: NotebookUndoAction) => {
    undoStackRef.current = [...undoStackRef.current.slice(-39), action];
    setUndoDepth(undoStackRef.current.length);
  }, []);

  const markPageUnsaved = useCallback(() => {
    setSaveStatus("unsaved");
    setFeedback((current) =>
      current?.message === "Could not autosave this page." ? null : current
    );
  }, []);

  const renderSavedCanvasNow = useCallback(() => {
    const canvas = savedCanvasRef.current;
    if (!canvas) return;
    drawSavedNotebookCanvas({
      canvas,
      strokes: strokesRef.current,
      pageColor: pageColorRef.current,
    });
  }, []);

  const renderLiveCanvasNow = useCallback(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    drawLiveInkCanvas({
      canvas,
      activeStroke: activeStrokeRef.current?.liveStroke ?? null,
      pageColor: pageColorRef.current,
    });
  }, []);

  const scheduleSavedCanvasRender = useCallback(() => {
    if (savedCanvasFrameRef.current !== null) return;
    savedCanvasFrameRef.current = window.requestAnimationFrame(() => {
      savedCanvasFrameRef.current = null;
      renderSavedCanvasNow();
    });
  }, [renderSavedCanvasNow]);

  const scheduleLiveCanvasRender = useCallback(() => {
    if (liveCanvasFrameRef.current !== null) return;
    liveCanvasFrameRef.current = window.requestAnimationFrame(() => {
      liveCanvasFrameRef.current = null;
      renderLiveCanvasNow();
    });
  }, [renderLiveCanvasNow]);

  const finishActiveStroke = useCallback(
    (options?: { pointerId?: number; canvas?: HTMLCanvasElement | null }) => {
      const activeStroke = activeStrokeRef.current;
      if (!activeStroke) {
        document.body.classList.remove("jami-inking-active");
        return;
      }
      if (options?.pointerId !== undefined && options.pointerId !== activeStroke.pointerId) {
        return;
      }

      if (
        options?.canvas &&
        options.pointerId !== undefined &&
        options.canvas.hasPointerCapture(options.pointerId)
      ) {
        options.canvas.releasePointerCapture(options.pointerId);
      }

      const finalizedStroke = finalizeInkStroke(activeStroke.stroke);
      activeStrokeRef.current = null;
      document.body.classList.remove("jami-inking-active");
      clearNotebookCanvas(liveCanvasRef.current);

      if (finalizedStroke) {
        setStrokes((current) => {
          const next =
            finalizedStroke.tool === "eraser"
              ? current.filter((stroke) => !strokeTouchesEraser(stroke, finalizedStroke))
              : [...current, finalizedStroke];
          const changed =
            finalizedStroke.tool === "pen" || next.length !== current.length;
          if (changed) {
            pushUndoAction({ type: "strokes", previous: current, next });
          }
          strokesRef.current = next;
          return next;
        });
      }
      scheduleSavedCanvasRender();
    },
    [pushUndoAction, scheduleSavedCanvasRender]
  );

  const loadNotebook = useCallback(async () => {
    if (!user?.uid || !notebookId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextNotebook = await getNotebookById(user.uid, notebookId);
      let nextPages: NotebookPage[] = [];
      let nextFiles: NotebookFile[] = [];

      if (nextNotebook) {
        const [pagesResult, filesResult] = await Promise.allSettled([
          getNotebookPages(user.uid, notebookId),
          getNotebookFiles(user.uid, notebookId),
        ]);

        if (pagesResult.status === "fulfilled") {
          nextPages = pagesResult.value;
        }
        if (filesResult.status === "fulfilled") {
          nextFiles = filesResult.value;
        }
        if (pagesResult.status === "rejected" || filesResult.status === "rejected") {
          console.warn("Some notebook sections could not load.", {
            pagesError: pagesResult.status === "rejected" ? pagesResult.reason : null,
            filesError: filesResult.status === "rejected" ? filesResult.reason : null,
          });
          setFeedback({
            type: "error",
            message:
              "This notebook opened, but pages or file details are still syncing. Refresh in a moment if something looks missing.",
          });
        }
      }

      setNotebook(nextNotebook);
      setPages(nextPages);
      setFiles(nextFiles);
      setSelectedPageId(nextPages[0]?.id ?? null);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not load this notebook.",
      });
    } finally {
      setLoading(false);
    }
  }, [notebookId, user?.uid]);

  useEffect(() => {
    void loadNotebook();
  }, [loadNotebook]);

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
      setSelectedTextBlockId(null);
      setEditingTextBlockId(null);
      setStrokes([]);
      strokesRef.current = [];
      activeStrokeRef.current = null;
      undoStackRef.current = [];
      setUndoDepth(0);
      setActiveTextGestureId(null);
      clearNotebookCanvas(savedCanvasRef.current);
      clearNotebookCanvas(liveCanvasRef.current);
      return;
    }

    const nextStrokes = normalizeStrokes(selectedPage.strokeData?.strokes);
    setTextBlocks(selectedPage.textBlocks);
    setSelectedTextBlockId(null);
    setEditingTextBlockId(null);
    setStrokes(nextStrokes);
    strokesRef.current = nextStrokes;
    activeStrokeRef.current = null;
    undoStackRef.current = [];
    setUndoDepth(0);
    setActiveTextGestureId(null);
    clearNotebookCanvas(liveCanvasRef.current);
    setPageColor(selectedPage.pageColor ?? notebook?.pageColor ?? "white");
    setSaveStatus("saved");
  }, [notebook?.pageColor, selectedPage]);

  useEffect(() => {
    strokesRef.current = strokes;
    scheduleSavedCanvasRender();
  }, [scheduleSavedCanvasRender, strokes]);

  useEffect(() => {
    pageColorRef.current = pageColor;
    setPenColor((current) => {
      if (pageColor === "black" && current === "black") return "white";
      if (pageColor === "white" && current === "white") return "black";
      return current;
    });
    scheduleSavedCanvasRender();
    scheduleLiveCanvasRender();
  }, [pageColor, scheduleLiveCanvasRender, scheduleSavedCanvasRender]);

  useEffect(() => {
    const handleBlur = () => {
      finishActiveStroke();
      touchPointersRef.current.clear();
      pinchZoomRef.current = null;
      pageSwipeRef.current = null;
    };
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
      if (savedCanvasFrameRef.current !== null) {
        window.cancelAnimationFrame(savedCanvasFrameRef.current);
        savedCanvasFrameRef.current = null;
      }
      if (liveCanvasFrameRef.current !== null) {
        window.cancelAnimationFrame(liveCanvasFrameRef.current);
        liveCanvasFrameRef.current = null;
      }
      document.body.classList.remove("jami-inking-active");
    };
  }, [finishActiveStroke]);

  const updateTouchPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    touchPointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      pressure: 0.5,
    });
  };

  const startPinchZoom = () => {
    const [first, second] = Array.from(touchPointersRef.current.values());
    if (!first || !second) return;
    setUserAdjustedZoom(true);
    pinchZoomRef.current = {
      startDistance: getPinchDistance(first, second),
      startZoom: pageZoom,
    };
    pageSwipeRef.current = null;
  };

  const handleTouchPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType !== "touch") return false;
    updateTouchPointer(event);
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (touchPointersRef.current.size >= 2) {
      startPinchZoom();
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  };

  const handleTouchPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType !== "touch" || !touchPointersRef.current.has(event.pointerId)) {
      return false;
    }
    updateTouchPointer(event);
    const pinch = pinchZoomRef.current;
    if (!pinch || touchPointersRef.current.size < 2) return false;

    const [first, second] = Array.from(touchPointersRef.current.values());
    if (first && second) {
      setPageZoom(
        getNotebookPageZoomAfterPinch({
          startDistance: pinch.startDistance,
          currentDistance: getPinchDistance(first, second),
          startZoom: pinch.startZoom,
        })
      );
    }
    pageSwipeRef.current = null;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const handleTouchPointerEnd = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    options: { allowTextTap?: boolean } = {}
  ) => {
    if (event.pointerType !== "touch") return false;
    const wasPinching = Boolean(pinchZoomRef.current) || touchPointersRef.current.size >= 2;
    touchPointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wasPinching) {
      pinchZoomRef.current = null;
      pageSwipeRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    handleStopPageSwipe(event, options);
    return true;
  };

  const getNotebookSamplesFromEvent = (
    event: ReactPointerEvent<HTMLCanvasElement>
  ): LiveInkPoint[] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return getPointerClientSamples(event.nativeEvent).map((sample) =>
      ({
        ...mapClientPointToNotebookPage({
        clientX: sample.clientX,
        clientY: sample.clientY,
        rect,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        }),
        pressure: sample.pressure,
      })
    );
  };

  const getNotebookPointsFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): Point[] =>
    getNotebookSamplesFromEvent(event).map(({ x, y }) => ({ x, y }));

  const createTextBlockAtPoint = (point: Point) => {
    const block = clampTextBlock({
      id: makeTextBlockId(),
      x: point.x - 120,
      y: point.y - 36,
      width: 300,
      height: 96,
      text: "",
    });
    setTextBlocks((current) => {
      const next = [...current, block];
      pushUndoAction({ type: "textBlocks", previous: current, next });
      return next;
    });
    setSelectedTextBlockId(block.id);
    setEditingTextBlockId(block.id);
    markPageUnsaved();
  };

  const updateEraserCursorFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool !== "eraser" || !shouldPointerDraw(event.pointerType, tool)) {
      setEraserCursor((current) => (current.visible ? { ...current, visible: false } : current));
      return;
    }
    const [point] = getNotebookPointsFromEvent(event);
    if (!point) return;
    setEraserCursor({ ...point, visible: true });
  };

  const handleStartDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!fullNotebookEditingEnabled || !shouldPointerDraw(event.pointerType, tool)) return;
    event.preventDefault();
    event.stopPropagation();
    setPenMenuOpen(false);
    setEraserMenuOpen(false);
    updateEraserCursorFromEvent(event);
    finishActiveStroke();

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const livePoints = getNotebookSamplesFromEvent(event);
    const points = livePoints.map(({ x, y }) => ({ x, y }));
    const strokeTool: NotebookStrokeTool = tool === "eraser" ? "eraser" : "pen";
    const strokeColor = strokeTool === "eraser" ? "white" : penColor;
    const strokeWidth = strokeTool === "eraser" ? ERASER_WIDTH_VALUE[eraserWidth] : PEN_WIDTH_VALUE[penWidth];
    activeStrokeRef.current = {
      pointerId: event.pointerId,
      stroke: {
        points: appendInkPoints([], points, 1_200),
        color: strokeColor,
        tool: strokeTool,
        width: strokeWidth,
      },
      liveStroke: {
        points: appendLiveInkPoints([], livePoints, 1_200),
        color: strokeColor,
        tool: strokeTool,
        width: strokeWidth,
      },
    };
    document.body.classList.add("jami-inking-active");
    markPageUnsaved();
    renderLiveCanvasNow();
  };

  const handleDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const activeStroke = activeStrokeRef.current;
    if (
      !activeStroke ||
      activeStroke.pointerId !== event.pointerId ||
      !fullNotebookEditingEnabled ||
      !shouldPointerDraw(event.pointerType, tool)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateEraserCursorFromEvent(event);
    const livePoints = getNotebookSamplesFromEvent(event);
    activeStroke.stroke = {
      ...activeStroke.stroke,
      points: appendInkPoints(
        activeStroke.stroke.points,
        livePoints.map(({ x, y }) => ({ x, y })),
        1_200
      ),
    };
    activeStroke.liveStroke = {
      ...activeStroke.liveStroke,
      points: appendLiveInkPoints(activeStroke.liveStroke.points, livePoints, 1_200),
    };
    scheduleLiveCanvasRender();
  };

  const handleStopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setEraserCursor((current) => (current.visible ? { ...current, visible: false } : current));
    finishActiveStroke({ pointerId: event.pointerId, canvas: event.currentTarget });
  };

  const collectCurrentStrokes = useCallback(
    (options: { includeActiveStroke?: boolean } = {}) => {
      let currentStrokes = strokesRef.current;
      const activeStroke = activeStrokeRef.current;
      if (activeStroke && options.includeActiveStroke) {
        const finalizedStroke = finalizeInkStroke(activeStroke.stroke);
        activeStrokeRef.current = null;
        document.body.classList.remove("jami-inking-active");
        clearNotebookCanvas(liveCanvasRef.current);
        const canvas = liveCanvasRef.current;
        if (canvas?.hasPointerCapture(activeStroke.pointerId)) {
          canvas.releasePointerCapture(activeStroke.pointerId);
        }
        if (finalizedStroke) {
          currentStrokes =
            finalizedStroke.tool === "eraser"
              ? currentStrokes.filter((stroke) => !strokeTouchesEraser(stroke, finalizedStroke))
              : [...currentStrokes, finalizedStroke];
          const changed =
            finalizedStroke.tool === "pen" || currentStrokes.length !== strokesRef.current.length;
          if (changed) {
            pushUndoAction({
              type: "strokes",
              previous: strokesRef.current,
              next: currentStrokes,
            });
          }
          strokesRef.current = currentStrokes;
          setStrokes(currentStrokes);
        }
        scheduleSavedCanvasRender();
      }
      return currentStrokes;
    },
    [pushUndoAction, scheduleSavedCanvasRender]
  );

  const savePageSnapshot = useCallback(
    async (input: {
      page: NotebookPage;
      textBlocks: NotebookTextBlock[];
      strokes: Stroke[];
      pageColor: NotebookPageColor;
    }) => {
      if (!user?.uid) return false;
      setSaveStatus("saving");
      try {
        const cleanedTextBlocks = input.textBlocks.filter((block) => block.text.trim());
        const typedContent = buildTypedContentFromTextBlocks(cleanedTextBlocks) ?? "";
        const status: NotebookPageStatus =
          typedContent.trim() || input.strokes.length > 0 ? "working" : "blank";
        await updateNotebookPage(user.uid, input.page.id, {
          typedContent,
          textBlocks: cleanedTextBlocks,
          strokeData: { version: 1, strokes: input.strokes },
          pageColor: input.pageColor,
          status,
        });
        setPages((current) =>
          current.map((page) =>
            page.id === input.page.id
              ? {
                  ...page,
                  typedContent: typedContent.trim() || undefined,
                  textBlocks: cleanedTextBlocks,
                  strokeData: { version: 1, strokes: input.strokes },
                  pageColor: input.pageColor,
                  status,
                  updatedAt: Date.now(),
                }
              : page
          )
        );
        if (selectedPageRef.current?.id === input.page.id) {
          setTextBlocks(cleanedTextBlocks);
          textBlocksRef.current = cleanedTextBlocks;
        }
        setSaveStatus("saved");
        setFeedback((current) =>
          current?.message === "Could not autosave this page." ? null : current
        );
        return true;
      } catch (error) {
        setSaveStatus("failed");
        setFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Could not autosave this page.",
        });
        return false;
      }
    },
    [user?.uid]
  );

  const saveCurrentPage = useCallback(
    async (options: { includeActiveStroke?: boolean } = {}) => {
      const page = selectedPageRef.current;
      if (!page || !user?.uid) return false;
      if (activeStrokeRef.current && !options.includeActiveStroke) return false;
      return savePageSnapshot({
        page,
        textBlocks: textBlocksRef.current,
        strokes: collectCurrentStrokes({ includeActiveStroke: options.includeActiveStroke }),
        pageColor: pageColorRef.current,
      });
    },
    [collectCurrentStrokes, savePageSnapshot, user?.uid]
  );

  const selectPageById = useCallback(
    async (pageId: string) => {
      if (pageId === selectedPageRef.current?.id) return true;
      if (
        saveStatusRef.current === "unsaved" ||
        saveStatusRef.current === "failed" ||
        activeStrokeRef.current
      ) {
        await saveCurrentPage({ includeActiveStroke: true });
      }
      setSelectedPageId(pageId);
      return true;
    },
    [saveCurrentPage]
  );

  const selectPageByOffset = useCallback(
    async (offset: -1 | 1) => {
      if (selectedPageIndex < 0) return false;
      const nextIndex = getNotebookPageIndexAfterSwipe({
        currentIndex: selectedPageIndex,
        pageCount: pages.length,
        direction: offset === 1 ? "next" : "previous",
      });
      if (nextIndex === selectedPageIndex) return false;
      const nextPage = pages[nextIndex];
      if (!nextPage) return false;
      await selectPageById(nextPage.id);
      return true;
    },
    [pages, selectPageById, selectedPageIndex]
  );

  useEffect(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (loading || saveStatus !== "unsaved" || !selectedPage) return;

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveCurrentPage();
    }, 1200);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [loading, pageColor, saveCurrentPage, saveStatus, selectedPage, strokes, textBlocks]);

  useEffect(() => {
    const saveBeforeExit = () => {
      if (
        saveStatusRef.current === "unsaved" ||
        saveStatusRef.current === "failed" ||
        activeStrokeRef.current
      ) {
        void saveCurrentPage({ includeActiveStroke: true });
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
  }, [saveCurrentPage]);

  const handleExitNotebook = async (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (
      saveStatusRef.current === "unsaved" ||
      saveStatusRef.current === "failed" ||
      activeStrokeRef.current
    ) {
      await saveCurrentPage({ includeActiveStroke: true });
    }
    router.push(`/dashboard/folders/${notebook?.folderId ?? ""}`);
  };

  const handleStartPageSwipe = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!fullNotebookEditingEnabled || !shouldPointerSwipePages(event.pointerType)) return;
    if (activeStrokeRef.current) return;
    if (activeTextGestureId) return;
    pageSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      completed: false,
    };
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePageSwipeMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId || swipe.completed) return;

    const deltaX = event.clientX - swipe.lastX;
    const deltaY = event.clientY - swipe.lastY;
    swipe.currentX = event.clientX;
    swipe.currentY = event.clientY;
    swipe.lastX = event.clientX;
    swipe.lastY = event.clientY;
    const direction = getNotebookSwipeDirection({
      startX: swipe.startX,
      startY: swipe.startY,
      currentX: swipe.currentX,
      currentY: swipe.currentY,
    });

    const totalDx = swipe.currentX - swipe.startX;
    const totalDy = swipe.currentY - swipe.startY;
    if (
      Math.abs(totalDy) > 10 &&
      Math.abs(totalDy) > Math.abs(totalDx) * 1.15 &&
      pageScrollRef.current
    ) {
      pageScrollRef.current.scrollBy({
        top: -deltaY,
        left: pageZoom > 1 ? -deltaX : 0,
        behavior: "auto",
      });
      event.preventDefault();
      return;
    }

    if (!direction) return;

    swipe.completed = true;
    event.preventDefault();
    void selectPageByOffset(direction === "next" ? 1 : -1);
  };

  const handleStopPageSwipe = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    options: { allowTextTap?: boolean } = {}
  ) => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pageSwipeRef.current = null;

    if (!swipe.completed && tool === "text" && options.allowTextTap) {
      const direction = getNotebookSwipeDirection({
        startX: swipe.startX,
        startY: swipe.startY,
        currentX: event.clientX,
        currentY: event.clientY,
      });
      if (!direction) {
        const [point] = getNotebookPointsFromEvent(event);
        if (point) createTextBlockAtPoint(point);
      }
    }
  };

  const handlePagePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!fullNotebookEditingEnabled) return;
    setPenMenuOpen(false);
    setEraserMenuOpen(false);
    if (handleTouchPointerDown(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStartPageSwipe(event);
      return;
    }
    if (shouldPointerDraw(event.pointerType, tool)) {
      handleStartDrawing(event);
      return;
    }

    event.preventDefault();
    const [point] = getNotebookPointsFromEvent(event);
    if (!point) return;
    createTextBlockAtPoint(point);
  };

  const handlePagePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (handleTouchPointerMove(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handlePageSwipeMove(event);
      return;
    }
    updateEraserCursorFromEvent(event);
    handleDraw(event);
  };

  const handlePagePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (handleTouchPointerEnd(event, { allowTextTap: true })) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStopPageSwipe(event, { allowTextTap: true });
      return;
    }
    handleStopDrawing(event);
  };

  const handlePagePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    setEraserCursor((current) => (current.visible ? { ...current, visible: false } : current));
    if (handleTouchPointerEnd(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStopPageSwipe(event);
      return;
    }
    handleStopDrawing(event);
  };

  const updateTextBlock = (blockId: string, updates: Partial<NotebookTextBlock>) => {
    setTextBlocks((current) =>
      current.map((block) =>
        block.id === blockId ? clampTextBlock({ ...block, ...updates }) : block
      )
    );
    markPageUnsaved();
  };

  const deleteTextBlock = (blockId: string) => {
    setTextBlocks((current) => {
      const next = current.filter((block) => block.id !== blockId);
      if (next.length !== current.length) {
        pushUndoAction({ type: "textBlocks", previous: current, next });
      }
      return next;
    });
    setSelectedTextBlockId((current) => (current === blockId ? null : current));
    setEditingTextBlockId((current) => (current === blockId ? null : current));
    markPageUnsaved();
  };

  const startTextBlockDrag = (
    block: NotebookTextBlock,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (!fullNotebookEditingEnabled) return;
    const pageElement = event.currentTarget.closest<HTMLElement>("[data-notebook-page-surface]");
    if (!pageElement) return;
    const rect = pageElement.getBoundingClientRect();
    textBlockDragRef.current = {
      id: block.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: block.x,
      originY: block.y,
      pageWidth: rect.width,
      pageHeight: rect.height,
      previousTextBlocks: textBlocksRef.current,
    };
    pageSwipeRef.current = null;
    pinchZoomRef.current = null;
    setActiveTextGestureId(block.id);
    setSelectedTextBlockId(block.id);
    setEditingTextBlockId((current) => (current === block.id ? null : current));
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const dragTextBlock = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = textBlockDragRef.current;
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.pageWidth) * CANVAS_WIDTH;
    const dy = ((event.clientY - drag.startY) / drag.pageHeight) * CANVAS_HEIGHT;
    updateTextBlock(drag.id, {
      x: drag.originX + dx,
      y: drag.originY + dy,
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const stopTextBlockDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = textBlockDragRef.current;
    if (drag && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag) {
      const next = textBlocksRef.current;
      const previousBlock = drag.previousTextBlocks.find((block) => block.id === drag.id);
      const nextBlock = next.find((block) => block.id === drag.id);
      if (
        previousBlock &&
        nextBlock &&
        (previousBlock.x !== nextBlock.x || previousBlock.y !== nextBlock.y)
      ) {
        pushUndoAction({ type: "textBlocks", previous: drag.previousTextBlocks, next });
      }
    }
    textBlockDragRef.current = null;
    setActiveTextGestureId(null);
    event.stopPropagation();
  };

  const startTextBlockResize = (
    block: NotebookTextBlock,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (!fullNotebookEditingEnabled) return;
    const pageElement = event.currentTarget.closest<HTMLElement>("[data-notebook-page-surface]");
    if (!pageElement) return;
    const rect = pageElement.getBoundingClientRect();
    textBlockResizeRef.current = {
      id: block.id,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: block.width,
      originHeight: block.height,
      pageWidth: rect.width,
      pageHeight: rect.height,
      previousTextBlocks: textBlocksRef.current,
    };
    pageSwipeRef.current = null;
    pinchZoomRef.current = null;
    setActiveTextGestureId(block.id);
    setSelectedTextBlockId(block.id);
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const resizeTextBlock = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = textBlockResizeRef.current;
    if (!resize) return;
    const dx = ((event.clientX - resize.startX) / resize.pageWidth) * CANVAS_WIDTH;
    const dy = ((event.clientY - resize.startY) / resize.pageHeight) * CANVAS_HEIGHT;
    updateTextBlock(resize.id, {
      width: resize.originWidth + dx,
      height: resize.originHeight + dy,
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const stopTextBlockResize = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = textBlockResizeRef.current;
    if (resize && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (resize) {
      const next = textBlocksRef.current;
      const previousBlock = resize.previousTextBlocks.find((block) => block.id === resize.id);
      const nextBlock = next.find((block) => block.id === resize.id);
      if (
        previousBlock &&
        nextBlock &&
        (previousBlock.width !== nextBlock.width || previousBlock.height !== nextBlock.height)
      ) {
        pushUndoAction({ type: "textBlocks", previous: resize.previousTextBlocks, next });
      }
    }
    textBlockResizeRef.current = null;
    setActiveTextGestureId(null);
    event.stopPropagation();
  };

  const handleAddPage = async () => {
    if (!user?.uid || !notebook || !fullNotebookEditingEnabled) return;
    if (
      saveStatusRef.current === "unsaved" ||
      saveStatusRef.current === "failed" ||
      activeStrokeRef.current
    ) {
      await saveCurrentPage({ includeActiveStroke: true });
    }
    setAddingPage(true);
    try {
      const nextPageNumber =
        pages.length > 0 ? Math.max(...pages.map((page) => page.pageNumber)) + 1 : 1;
      const page = await createNotebookPage(user.uid, {
        notebookId: notebook.id,
        folderId: notebook.folderId,
        pageNumber: nextPageNumber,
        pageType: "free_working",
        title: `Page ${nextPageNumber}`,
        pageColor: notebook.pageColor,
      });
      setPages((current) => [...current, page].sort((a, b) => a.pageNumber - b.pageNumber));
      setSelectedPageId(page.id);
      setFeedback({ type: "success", message: `Page ${page.pageNumber} added.` });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not add a page.",
      });
    } finally {
      setAddingPage(false);
    }
  };

  const openNotebookSettings = () => {
    if (!notebook) return;
    setNotebookTitle(notebook.title);
    setNotebookColor(normalizeObjectColor(notebook.color));
    setNotebookIcon(normalizeObjectIcon(notebook.icon));
    setNotebookDefaultPageColor(notebook.pageColor ?? "white");
    setShowNotebookSettings(true);
  };

  const handleSaveNotebookSettings = async () => {
    if (!user?.uid || !notebook) return;
    setSavingNotebookSettings(true);
    setFeedback(null);
    try {
      await updateNotebook(user.uid, notebook.id, {
        title: notebookTitle,
        color: notebookColor,
        icon: notebookIcon,
        pageColor: notebookDefaultPageColor,
      });
      setNotebook((current) =>
        current
          ? {
              ...current,
              title: notebookTitle.trim() || current.title,
              color: notebookColor,
              icon: notebookIcon,
              pageColor: notebookDefaultPageColor,
              updatedAt: Date.now(),
            }
          : current
      );
      setShowNotebookSettings(false);
      setFeedback({ type: "success", message: "Notebook updated." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update notebook.",
      });
    } finally {
      setSavingNotebookSettings(false);
    }
  };

  const handleArchiveNotebook = async () => {
    if (!user?.uid || !notebook) return;
    const confirmed = window.confirm(
      "Archive this notebook? This hides the notebook from the folder, but does not affect decks or sources."
    );
    if (!confirmed) return;
    setSavingNotebookSettings(true);
    try {
      await updateNotebook(user.uid, notebook.id, { archived: true });
      setNotebook((current) => (current ? { ...current, archived: true, updatedAt: Date.now() } : current));
      setShowNotebookSettings(false);
      setFeedback({ type: "success", message: "Notebook archived." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not archive notebook.",
      });
    } finally {
      setSavingNotebookSettings(false);
    }
  };

  const handleUndo = () => {
    const action = undoStackRef.current.at(-1);
    if (!action) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setUndoDepth(undoStackRef.current.length);

    if (action.type === "strokes") {
      strokesRef.current = action.previous;
      setStrokes(action.previous);
      scheduleSavedCanvasRender();
    } else {
      textBlocksRef.current = action.previous;
      setTextBlocks(action.previous);
      setSelectedTextBlockId(null);
      setEditingTextBlockId(null);
      setActiveTextGestureId(null);
    }
    markPageUnsaved();
  };

  const handleClearCurrentPage = () => {
    const confirmed = window.confirm("Clear drawing from this page?");
    if (!confirmed) return;
    activeStrokeRef.current = null;
    if (strokesRef.current.length > 0) {
      pushUndoAction({ type: "strokes", previous: strokesRef.current, next: [] });
    }
    strokesRef.current = [];
    setStrokes([]);
    markPageUnsaved();
    clearNotebookCanvas(liveCanvasRef.current);
    scheduleSavedCanvasRender();
  };

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
            <Link
              href="/dashboard/folders"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] px-4 text-sm font-medium text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)]"
            >
              Back to folders
            </Link>
          }
        />
      </AppPage>
    );
  }

  return (
    <main
      data-app-surface="true"
      className="fixed inset-0 z-[70] flex min-w-0 flex-col overflow-hidden bg-[var(--color-surface-base)] text-text-primary"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="z-40 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)]/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] shadow-[0_12px_26px_rgba(0,0,0,0.18)] backdrop-blur-xl">
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
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text-primary">{notebook.title}</div>
              <div className="text-xs text-text-muted">
                {saveStatus === "saving"
                  ? "Saving..."
                  : saveStatus === "unsaved"
                    ? "Unsaved changes"
                    : saveStatus === "failed"
                      ? "Save failed"
                      : "Autosaved just now"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <ToolbarIconButton
                label="Pages"
                icon="pages"
                active={pagesDrawerOpen}
                onClick={() => {
                  setPenMenuOpen(false);
                  setEraserMenuOpen(false);
                  setPagesDrawerOpen((value) => !value);
                }}
              />
              <ToolbarIconButton
                label="Add page"
                icon="plus"
                disabled={addingPage || !fullNotebookEditingEnabled}
                onClick={() => {
                  setPenMenuOpen(false);
                  setEraserMenuOpen(false);
                  void handleAddPage();
                }}
              />
              <ToolbarIconButton
                label="Text box"
                icon="text"
                active={tool === "text"}
                disabled={!fullNotebookEditingEnabled}
                onClick={() => {
                  setTool("text");
                  setPenMenuOpen(false);
                  setEraserMenuOpen(false);
                }}
              />
              <div className="relative">
                <ToolbarIconButton
                  label="Pen"
                  icon="pen"
                  active={tool === "pen" || penMenuOpen}
                  disabled={!fullNotebookEditingEnabled}
                  onClick={() => {
                    setTool("pen");
                    setEraserMenuOpen(false);
                    setPenMenuOpen((value) => !value);
                  }}
                >
                  <span
                    className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border border-black/30"
                    style={{ backgroundColor: PEN_COLOR_HEX[penColor] }}
                  />
                </ToolbarIconButton>
                {penMenuOpen ? (
                  <div className="absolute right-0 top-12 z-50 w-56 rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-3 shadow-[0_18px_42px_rgba(0,0,0,0.28)]">
                    <div className="grid grid-cols-4 gap-2">
                      {(["black", "white", "red", "green"] as NotebookPenColor[]).map((color) => (
                        <button
                          key={color}
                          type="button"
                          aria-label={`${color} ink`}
                          onClick={() => {
                            setPenColor(color);
                            setTool("pen");
                            setPenMenuOpen(false);
                          }}
                          className={`h-9 rounded-full border transition ${
                            penColor === color
                              ? "border-[var(--color-selected-border)] ring-2 ring-[var(--color-selected-border)]/40"
                              : "border-[var(--color-border)]"
                          }`}
                          style={{ backgroundColor: PEN_COLOR_HEX[color] }}
                        />
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {(["thin", "medium", "thick"] as PenWidth[]).map((width) => (
                        <button
                          key={width}
                          type="button"
                          aria-label={`${width} line`}
                          onClick={() => {
                            setPenWidth(width);
                            setTool("pen");
                            setPenMenuOpen(false);
                          }}
                          className={`rounded-full border px-2 py-1.5 text-xs font-semibold capitalize transition ${
                            penWidth === width ? "app-selected" : "app-chip"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="mx-auto block w-8 rounded-full bg-current"
                            style={{ height: `${Math.max(2, PEN_WIDTH_VALUE[width] / 2)}px` }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <ToolbarIconButton
                  label="Eraser"
                  icon="eraser"
                  active={tool === "eraser" || eraserMenuOpen}
                  disabled={!fullNotebookEditingEnabled}
                  onClick={() => {
                    setTool("eraser");
                    setPenMenuOpen(false);
                    setEraserMenuOpen((value) => !value);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 right-1 rounded-full border border-current bg-transparent opacity-80"
                    style={{
                      width:
                        eraserWidth === "small"
                          ? "0.45rem"
                          : eraserWidth === "medium"
                            ? "0.6rem"
                            : "0.78rem",
                      height:
                        eraserWidth === "small"
                          ? "0.45rem"
                          : eraserWidth === "medium"
                            ? "0.6rem"
                            : "0.78rem",
                    }}
                  />
                </ToolbarIconButton>
                {eraserMenuOpen ? (
                  <div className="absolute right-0 top-12 z-50 w-48 rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-3 shadow-[0_18px_42px_rgba(0,0,0,0.28)]">
                    <div className="grid grid-cols-3 gap-2">
                      {(["small", "medium", "large"] as EraserWidth[]).map((width) => (
                        <button
                          key={width}
                          type="button"
                          aria-label={`${width} eraser`}
                          onClick={() => {
                            setEraserWidth(width);
                            setTool("eraser");
                            setEraserMenuOpen(false);
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
                ) : null}
              </div>
              <ToolbarIconButton
                label="Undo"
                icon="undo"
                disabled={!fullNotebookEditingEnabled || undoDepth === 0}
                onClick={() => {
                  setPenMenuOpen(false);
                  setEraserMenuOpen(false);
                  handleUndo();
                }}
              />
              <ToolbarIconButton
                label="Clear drawing"
                icon="clear"
                disabled={!fullNotebookEditingEnabled || strokes.length === 0}
                onClick={() => {
                  setPenMenuOpen(false);
                  setEraserMenuOpen(false);
                  handleClearCurrentPage();
                }}
              />
              <ToolbarIconButton
                label="Jami Tutor"
                icon="ai"
                active={aiPlaceholderOpen}
                onClick={() => {
                  setPenMenuOpen(false);
                  setEraserMenuOpen(false);
                  setAiPlaceholderOpen((value) => !value);
                }}
              />
              <ToolbarIconButton
                label="Notebook settings"
                icon="settings"
                onClick={() => {
                  setPenMenuOpen(false);
                  setEraserMenuOpen(false);
                  openNotebookSettings();
                }}
              />
            </div>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden">
        {feedback ? (
          <div className="absolute left-3 right-3 top-3 z-50 mx-auto max-w-2xl">
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
          </div>
        ) : null}

        {showNotebookSettings ? (
          <div className="absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-sm">
          <Card padding="md" className="mt-10 w-full max-w-3xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <SectionHeader
                eyebrow="Edit notebook"
                title="Notebook settings"
              />
              <Button type="button" variant="secondary" onClick={() => setShowNotebookSettings(false)}>
                Close
              </Button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <Input
                label="Notebook title"
                value={notebookTitle}
                onChange={(event) => setNotebookTitle(event.target.value)}
              />
              <ObjectStylePicker
                color={notebookColor}
                icon={notebookIcon}
                onColorChange={setNotebookColor}
                onIconChange={setNotebookIcon}
                colorLabel="Cover colour"
                iconLabel="Cover icon"
              />
            </div>
            <div className="mt-5">
              <div className="text-sm font-medium text-text-secondary">Default page colour</div>
              <div className="mt-2 flex gap-2">
                {(["white", "black"] as NotebookPageColor[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNotebookDefaultPageColor(color)}
                    className={`min-h-[2.35rem] rounded-full border px-4 text-sm font-semibold capitalize transition ${
                      notebookDefaultPageColor === color ? "app-selected" : "app-chip"
                    }`}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={savingNotebookSettings || !notebookTitle.trim()}
                onClick={() => void handleSaveNotebookSettings()}
              >
                {savingNotebookSettings ? "Saving..." : "Save notebook"}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={savingNotebookSettings}
                onClick={() => void handleArchiveNotebook()}
              >
                Archive notebook
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

        {aiPlaceholderOpen ? (
          <aside className="absolute bottom-0 right-0 top-0 z-30 w-full max-w-sm border-l border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-4 shadow-[-20px_0_44px_rgba(0,0,0,0.22)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-text-primary">Jami Tutor</div>
                <div className="text-xs text-text-muted">Placeholder</div>
              </div>
              <button
                type="button"
                className="app-chip rounded-full px-3 py-1 text-xs font-semibold"
                onClick={() => setAiPlaceholderOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-text-secondary">
              Tutor will use this notebook page later. No page content is sent yet.
            </p>
            <div className="mt-5 flex min-h-[2.75rem] items-center gap-2 rounded-full border border-[var(--color-field-border)] bg-[var(--color-field-bg)] px-3 text-sm text-[var(--color-field-placeholder)]">
              Ask Jami Tutor...
              <span className="ml-auto text-xs">mic</span>
              <span className="text-xs">send</span>
            </div>
          </aside>
        ) : null}

        {pagesDrawerOpen ? (
          <aside className="absolute bottom-0 left-0 top-0 z-30 w-64 border-r border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-3 shadow-[18px_0_42px_rgba(0,0,0,0.2)]">
            <div className="flex items-center justify-between gap-2 px-1 pb-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                Pages
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={addingPage || !fullNotebookEditingEnabled}
                onClick={() => void handleAddPage()}
              >
                {addingPage ? "..." : "+ Page"}
              </Button>
            </div>
            <div className="max-h-[calc(100vh-7rem)] space-y-2 overflow-y-auto pr-1">
              {pages.length > 0 ? (
                pages.map((page) => {
                  const selected = page.id === selectedPage?.id;
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => {
                        setPagesDrawerOpen(false);
                        void selectPageById(page.id);
                      }}
                      className={`w-full rounded-[0.95rem] border p-2 text-left transition ${
                        selected
                          ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-[var(--color-selected-text)]"
                          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-secondary hover:border-border-strong"
                      }`}
                    >
                      <div className={`mb-2 aspect-[900/1240] rounded-[0.65rem] border shadow-sm ${
                        PAGE_COLOR_CLASS[page.pageColor ?? notebook.pageColor]
                      }`}>
                        <div className="h-full w-full p-2">
                          <div className="h-1.5 w-2/3 rounded-full bg-current opacity-20" />
                          <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-current opacity-15" />
                        </div>
                      </div>
                      <div className="text-xs font-semibold">Page {page.pageNumber}</div>
                      <div className="mt-0.5 truncate text-[0.68rem] text-text-muted">
                        {page.textBlocks.length > 0 ? "Text" : page.strokeData?.strokes?.length ? "Ink" : "Blank"}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 text-sm leading-6 text-text-muted">
                  Add a page to start.
                </div>
              )}
            </div>
          </aside>
        ) : null}

          <div ref={pageScrollRef} className="h-full min-w-0 overflow-auto px-4 py-6 sm:px-6">
            <div className="mx-auto flex w-full max-w-[58rem] flex-col gap-3">
            {selectedPage?.questionPrompt ? (
              <Card tone="warm" padding="sm">
                <p className="text-sm leading-6 text-text-primary">{selectedPage.questionPrompt}</p>
              </Card>
            ) : null}

            {files.length > 0 ? (
              <Card padding="sm">
                <div className="flex flex-wrap gap-2">
                  {files.map((file) => (
                    <span
                      key={file.id}
                      className="app-chip rounded-full px-3 py-1.5 text-xs font-semibold"
                    >
                      {file.fileName} · {Math.round((file.sizeBytes ?? 0) / 1024)} KB
                    </span>
                  ))}
                </div>
              </Card>
            ) : null}

              <div className="mx-auto w-full rounded-[1.35rem] bg-[var(--color-glass-subtle)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-3">
                <div
                  data-notebook-page-surface
                  className={`relative mx-auto w-full overflow-hidden rounded-[0.95rem] border border-[var(--color-border)] shadow-[0_18px_48px_rgba(0,0,0,0.2)] ${PAGE_COLOR_CLASS[pageColor]}`}
                  style={{
                    width: `${Math.round(clampNotebookPageZoom(pageZoom) * 100)}%`,
                    maxWidth: `${NOTEBOOK_PAGE_BASE_WIDTH_REM * clampNotebookPageZoom(pageZoom)}rem`,
                  }}
                >
                  <canvas
                    ref={savedCanvasRef}
                    aria-hidden="true"
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    draggable={false}
                    className="pointer-events-none relative z-10 block aspect-[900/1240] w-full select-none"
                  />
                  <canvas
                    ref={liveCanvasRef}
                    role="img"
                    aria-label="Notebook drawing page"
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    draggable={false}
                    className="notebook-ink-surface absolute inset-0 z-20 block h-full w-full touch-none select-none"
                    onPointerDown={handlePagePointerDown}
                    onPointerMove={handlePagePointerMove}
                    onPointerUp={handlePagePointerUp}
                    onPointerCancel={handlePagePointerCancel}
                    onPointerLeave={handlePagePointerCancel}
                    onLostPointerCapture={handlePagePointerCancel}
                  />
                  {tool === "eraser" && eraserCursor.visible ? (
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute z-[25] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm ${
                        pageColor === "black"
                          ? "border-[#f8fafc]/80 bg-[#f8fafc]/10"
                          : "border-slate-950/55 bg-slate-950/5"
                      }`}
                      style={{
                        left: `${(eraserCursor.x / CANVAS_WIDTH) * 100}%`,
                        top: `${(eraserCursor.y / CANVAS_HEIGHT) * 100}%`,
                        width: `${(ERASER_WIDTH_VALUE[eraserWidth] / CANVAS_WIDTH) * 100}%`,
                        height: `${(ERASER_WIDTH_VALUE[eraserWidth] / CANVAS_HEIGHT) * 100}%`,
                      }}
                    />
                  ) : null}
                  <div className="pointer-events-none absolute inset-0 z-30">
                    {textBlocks.map((block) => {
                      const selected = selectedTextBlockId === block.id;
                      const editing = editingTextBlockId === block.id;
                      const gesturing = activeTextGestureId === block.id;
                      const displayText = block.text.trim() ? block.text : selected ? "Tap dots to type" : "";
                      return (
                        <div
                          key={block.id}
                          className={`pointer-events-auto absolute rounded-lg border bg-transparent transition ${
                            editing
                              ? "cursor-text border-[var(--color-selected-border)] shadow-[0_0_0_3px_rgba(183,124,255,0.16)]"
                              : selected
                                ? "cursor-grab touch-none select-none border-[var(--color-selected-border)] shadow-[0_0_0_3px_rgba(183,124,255,0.14)] active:cursor-grabbing"
                                : "cursor-grab touch-none select-none border-transparent active:cursor-grabbing"
                          }`}
                          style={{
                            left: `${(block.x / CANVAS_WIDTH) * 100}%`,
                            top: `${(block.y / CANVAS_HEIGHT) * 100}%`,
                            width: `${(block.width / CANVAS_WIDTH) * 100}%`,
                            height: `${(block.height / CANVAS_HEIGHT) * 100}%`,
                          }}
                          onPointerDown={(event) => {
                            if (!editing) startTextBlockDrag(block, event);
                          }}
                          onPointerMove={(event) => {
                            if (!editing) dragTextBlock(event);
                          }}
                          onPointerUp={(event) => {
                            if (!editing) stopTextBlockDrag(event);
                          }}
                          onPointerCancel={(event) => {
                            if (!editing) stopTextBlockDrag(event);
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedTextBlockId(block.id);
                          }}
                        >
                          {selected && fullNotebookEditingEnabled && !gesturing ? (
                            <>
                              <div className="absolute right-1 top-1 z-20 flex gap-1 rounded-full border border-black/10 bg-black/60 p-1 shadow-sm backdrop-blur">
                                <button
                                  type="button"
                                  aria-label={editing ? "Close text editor" : "Edit text block"}
                                  title={editing ? "Close text editor" : "Edit text block"}
                                  className="inline-grid h-7 w-7 place-items-center rounded-full text-[#f8fafc] transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f8fafc]"
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedTextBlockId(block.id);
                                    setEditingTextBlockId((current) =>
                                      current === block.id ? null : block.id
                                    );
                                  }}
                                >
                                  <NotebookIcon name="dots" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Delete text block"
                                  title="Delete text block"
                                  className="inline-grid h-7 w-7 place-items-center rounded-full text-[#f8fafc] transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f8fafc]"
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteTextBlock(block.id);
                                  }}
                                >
                                  <NotebookIcon name="trash" />
                                </button>
                              </div>
                              <button
                                type="button"
                                aria-label="Resize text box"
                                title="Resize text box"
                                className="absolute bottom-1 right-1 z-20 h-6 w-6 touch-none rounded-full border border-black/10 bg-black/55 text-[#f8fafc] shadow-sm backdrop-blur transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f8fafc]"
                                onPointerDown={(event) => startTextBlockResize(block, event)}
                                onPointerMove={resizeTextBlock}
                                onPointerUp={stopTextBlockResize}
                                onPointerCancel={stopTextBlockResize}
                              >
                                <span
                                  aria-hidden="true"
                                  className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 border-b-2 border-r-2 border-current"
                                />
                              </button>
                            </>
                          ) : null}
                          {editing && fullNotebookEditingEnabled ? (
                            <textarea
                              value={block.text}
                              autoFocus
                              onPointerDown={(event) => event.stopPropagation()}
                              onPointerMove={(event) => event.stopPropagation()}
                              onPointerUp={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                              onFocus={() => setSelectedTextBlockId(block.id)}
                              onChange={(event) => updateTextBlock(block.id, { text: event.target.value })}
                              placeholder="Type here..."
                              className={`h-full w-full resize-none rounded-lg bg-transparent p-2 pb-8 pr-20 text-sm font-medium leading-6 outline-none ${TEXT_COLOR_CLASS[pageColor]}`}
                            />
                          ) : (
                            <div
                              className={`h-full w-full overflow-hidden whitespace-pre-wrap rounded-lg p-2 pb-8 pr-10 text-sm font-medium leading-6 ${
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
                </div>
              </div>
            </div>
            </div>
            <button
              type="button"
              aria-label="Previous page"
              title="Previous page"
              disabled={selectedPageIndex <= 0}
              onClick={() => void selectPageByOffset(-1)}
              className="hidden md:inline-flex pointer-events-auto absolute left-4 top-1/2 z-20 h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] shadow-[0_12px_26px_rgba(0,0,0,0.18)] transition hover:bg-[var(--button-secondary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="rotate-90">
                <NotebookIcon name="chevron" />
              </span>
            </button>
            <button
              type="button"
              aria-label="Next page"
              title="Next page"
              disabled={selectedPageIndex < 0 || selectedPageIndex >= pages.length - 1}
              onClick={() => void selectPageByOffset(1)}
              className="hidden md:inline-flex pointer-events-auto absolute right-4 top-1/2 z-20 h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] shadow-[0_12px_26px_rgba(0,0,0,0.18)] transition hover:bg-[var(--button-secondary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="-rotate-90">
                <NotebookIcon name="chevron" />
              </span>
            </button>
            <div className="pointer-events-none absolute bottom-4 left-4 z-20 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-[0_12px_26px_rgba(0,0,0,0.24)]">
              {selectedPageIndex >= 0 ? selectedPageIndex + 1 : 0} of {pages.length || 0}
            </div>
        </div>
      </div>
    </main>
  );
}
