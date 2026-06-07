"use client";

import Link from "next/link";
import Image from "next/image";
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
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import {
  NotebookInkEditor,
  type NotebookInkEditorHandle,
} from "@/components/workspace/NotebookInkEditor";
import NotebookPdfPage from "@/components/workspace/NotebookPdfPage";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/components/workspace/object-card-styles";
import {
  Button,
  ButtonLink,
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
  NotebookHighlighterColor,
  NotebookPage,
  NotebookPageColor,
  NotebookPageStyle,
  NotebookPageStatus,
  NotebookPenColor,
  NotebookStrokeColor,
  NotebookStrokeTool,
  NotebookTextBlock,
  NotebookTextBlockResizeEdge,
} from "@/lib/workspace/notebooks";
import {
  buildTypedContentFromTextBlocks,
  normalizeNotebookStrokeColor,
  resizeNotebookTextBlockFromEdge,
} from "@/lib/workspace/notebooks";
import { applyNotebookEraser, type NotebookEraserMode } from "@/lib/workspace/notebook-eraser";
import {
  getFreehandOutline,
  normalizeTimedInkPoint,
  type StrokeOutlinePoint,
} from "@/lib/workspace/notebook-ink-engine";
import {
  clearNotebookNativeSelection,
  isNotebookTextEditingTarget,
  NOTEBOOK_EDITOR_LOCK_BODY_CLASS,
  shouldSuppressNotebookNativeEvent,
} from "@/lib/workspace/notebook-interaction-lock";
import {
  NOTEBOOK_AUTOSAVE_IDLE_MS,
  NOTEBOOK_INK_UI_SYNC_IDLE_MS,
  isNotebookSaveCompletionCurrent,
  shouldDiscardNotebookInkExport,
  shouldNotebookSaveReplaceStoredPageContent,
  shouldNotebookSaveUpdateLivePage,
} from "@/lib/workspace/notebook-autosave";
import {
  appendInkPoints,
  appendPendingNotebookStroke,
  clampNotebookPageZoom,
  clampNotebookThicknessPercent,
  finalizeInkStroke,
  getHighlighterWidthFromPercent,
  getNotebookPageIndexAfterSwipe,
  getNotebookSwipeDirection,
  getNotebookPageZoomAfterPinch,
  getPenWidthFromPercent,
  getPinchDistance,
  getPointerClientSamples,
  mapClientPointToNotebookPage,
  NOTEBOOK_MAX_PENDING_NATIVE_STROKES,
  NOTEBOOK_NATIVE_COMMIT_IDLE_MS,
  shouldPointerDraw,
  shouldPointerDrawEvent,
  shouldPointerSwipePages,
  shouldSuppressTouchAfterStylus,
  type PointerClientSample,
} from "@/lib/workspace/notebook-inking";
import { orderNotebookStrokesForRendering } from "@/lib/workspace/notebook-rendering";
import {
  createNotebookPage,
  deleteNotebookPage,
  getNotebookById,
  getNotebookFiles,
  getNotebookPages,
  saveNotebookPageSnapshot,
  updateNotebook,
} from "@/services/study/notebooks";
import { appendUploadedFileToNotebook } from "@/services/study/notebook-import";
import { getNotebookFileDownloadUrl } from "@/services/study/notebook-files";
import {
  legacyStrokesToJsDrawSvg,
  makeNotebookInkData,
} from "@/lib/workspace/notebook-ink-data";
import {
  buildNotebookPageSearch,
  getNotebookPageIdFromSearch,
} from "@/lib/workspace/notebook-navigation";
import { resolveNotebookPageBackgroundFileId } from "@/lib/workspace/notebook-pdf";

type Feedback = { type: "success" | "error"; message: string };
type Point = { x: number; y: number };
type InkPoint = Point & { pressure?: number; time?: number };
type Stroke = {
  points: InkPoint[];
  color: NotebookStrokeColor;
  width: number;
  tool: NotebookStrokeTool;
};
type LiveInkPoint = InkPoint & { pressure: number; time: number };
type LiveStroke = Omit<Stroke, "points"> & {
  points: LiveInkPoint[];
};
type SaveStatus = "saved" | "unsaved" | "saving" | "failed";
type EditorTool = NotebookStrokeTool | "text" | "select";
type EraserWidth = "small" | "medium" | "large";
type PageTransitionDirection = "next" | "previous" | null;
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
  edge: NotebookTextBlockResizeEdge;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
  originText: string;
  pageWidth: number;
  pageHeight: number;
  previousTextBlocks: NotebookTextBlock[];
};
type ActiveStrokeState = {
  pointerId: number;
  startTime: number;
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
  lastTime: number;
  velocityX: number;
  completed: boolean;
};
type PinchZoomState = {
  startDistance: number;
  startZoom: number;
  lastCenterX: number;
  lastCenterY: number;
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
const NOTEBOOK_PAGE_PORTRAIT_STRETCH = 1.035;
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
const HIGHLIGHTER_COLOR_HEX: Record<NotebookHighlighterColor, string> = {
  yellow: "#fde047",
  green: "#86efac",
  pink: "#f9a8d4",
};
const TEXT_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "text-slate-950 placeholder:text-slate-400",
  black: "text-[#f8fafc] placeholder:text-slate-500",
};
const PAGE_STYLE_LABELS: Record<NotebookPageStyle, string> = {
  plain: "Plain",
  lined: "Lined",
  grid: "Grid",
  dot: "Dot",
};
const ERASER_WIDTH_VALUE: Record<EraserWidth, number> = {
  small: 36,
  medium: 56,
  large: 76,
};
const TEXT_BLOCK_RESIZE_HANDLES: Array<{
  edge: NotebookTextBlockResizeEdge;
  label: string;
  positionClass: string;
  arrowClass: string;
}> = [
  {
    edge: "top",
    label: "Resize text box from top edge",
    positionClass: "left-1/2 top-0 h-8 w-8 -translate-x-1/2 -translate-y-1/2",
    arrowClass: "rotate-180",
  },
  {
    edge: "right",
    label: "Resize text box from right edge",
    positionClass: "right-0 top-1/2 h-8 w-8 -translate-y-1/2 translate-x-1/2",
    arrowClass: "-rotate-90",
  },
  {
    edge: "bottom",
    label: "Resize text box from bottom edge",
    positionClass: "bottom-0 left-1/2 h-8 w-8 -translate-x-1/2 translate-y-1/2",
    arrowClass: "rotate-0",
  },
  {
    edge: "left",
    label: "Resize text box from left edge",
    positionClass: "left-0 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2",
    arrowClass: "rotate-90",
  },
];
const NOTEBOOK_THICKNESS_TICKS = [25, 50, 75] as const;

function isPoint(value: unknown): value is InkPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
  );
}

function normalizeInkPoint(point: InkPoint): InkPoint {
  return normalizeTimedInkPoint(point);
}

function getNotebookStrokePaintColor(color: NotebookStrokeColor, tool: NotebookStrokeTool) {
  if (color.startsWith("#")) return color;
  if (tool === "highlighter" && color in HIGHLIGHTER_COLOR_HEX) {
    return HIGHLIGHTER_COLOR_HEX[color as NotebookHighlighterColor];
  }
  return (
    PEN_COLOR_HEX[color as NotebookPenColor] ??
    HIGHLIGHTER_COLOR_HEX[color as NotebookHighlighterColor] ??
    PEN_COLOR_HEX.black
  );
}

function normalizeStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value)) return [];

  const strokes: Stroke[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const points = (entry as { points?: unknown }).points;
    if (!Array.isArray(points)) continue;
    const cleanPoints = points.filter(isPoint).map(normalizeInkPoint).slice(0, 1_200);
    if (cleanPoints.length > 0) {
      const stroke = entry as Record<string, unknown>;
      const tool =
        stroke.tool === "eraser" || stroke.tool === "highlighter"
          ? stroke.tool
          : "pen";
      const width =
        typeof stroke.width === "number" && Number.isFinite(stroke.width)
          ? Math.max(1, Math.min(96, Math.round(stroke.width)))
          : tool === "eraser"
            ? 18
            : 5;
      strokes.push({
        points: cleanPoints,
        color: normalizeNotebookStrokeColor(stroke.color),
        tool,
        width,
      });
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
  if (stroke.tool === "eraser") return PAGE_COLOR_HEX[pageColor];
  return getNotebookStrokePaintColor(stroke.color, stroke.tool);
}

function fillStrokeOutline(context: CanvasRenderingContext2D, outline: StrokeOutlinePoint[]) {
  if (outline.length === 0) return false;
  context.beginPath();
  context.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length; index += 1) {
    context.lineTo(outline[index][0], outline[index][1]);
  }
  context.closePath();
  context.fill();
  return true;
}

function drawFallbackDot(
  context: CanvasRenderingContext2D,
  stroke: Stroke | LiveStroke,
  point: InkPoint
) {
  const normalizedPoint = normalizeTimedInkPoint(point);
  const pressureMultiplier =
    stroke.tool === "highlighter"
      ? 0.92 + normalizedPoint.pressure * 0.18
      : 0.72 + normalizedPoint.pressure * 0.56;
  const width = stroke.tool === "eraser" ? stroke.width : stroke.width * pressureMultiplier;
  context.beginPath();
  context.arc(point.x, point.y, Math.max(1, width / 2), 0, Math.PI * 2);
  context.fill();
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
  if (stroke.tool === "highlighter") {
    context.globalAlpha = 0.28;
  }

  if (stroke.points.length === 1) {
    drawFallbackDot(context, stroke, stroke.points[0]);
    context.restore();
    return;
  }

  if (stroke.tool !== "eraser") {
    const outline = getFreehandOutline({
      points: stroke.points,
      tool: stroke.tool,
      width: stroke.width,
      mode: "committed",
    });
    if (fillStrokeOutline(context, outline)) {
      context.restore();
      return;
    }
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    const previousPoint = stroke.points[index - 1];
    const currentPoint = stroke.points[index];
    const midpoint = {
      x: (previousPoint.x + currentPoint.x) / 2,
      y: (previousPoint.y + currentPoint.y) / 2,
    };

    context.beginPath();
    context.lineWidth = stroke.width;
    context.moveTo(previousPoint.x, previousPoint.y);
    context.quadraticCurveTo(previousPoint.x, previousPoint.y, midpoint.x, midpoint.y);
    context.stroke();
  }
  context.restore();
}

function getLivePointWidth(stroke: LiveStroke, point: LiveInkPoint) {
  const normalizedPoint = normalizeTimedInkPoint(point);
  const multiplier =
    stroke.tool === "highlighter" ? 0.92 + normalizedPoint.pressure * 0.18 : 0.72 + normalizedPoint.pressure * 0.56;
  return Math.max(1, stroke.width * multiplier);
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
  if (stroke.tool === "highlighter") {
    context.globalAlpha = 0.28;
  }

  if (stroke.points.length === 1) {
    drawFallbackDot(context, stroke, stroke.points[0]);
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
    context.lineWidth = stroke.tool === "eraser" ? stroke.width : getLivePointWidth(stroke, currentPoint);
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

  for (const stroke of orderNotebookStrokesForRendering(input.strokes)) {
    drawStrokePath(context, stroke, input.pageColor);
  }
}

function drawLiveInkCanvas(input: {
  canvas: HTMLCanvasElement;
  activeStroke: LiveStroke | null;
  pageColor: NotebookPageColor;
  tool?: NotebookStrokeTool;
}) {
  const context = prepareNotebookCanvas(input.canvas);
  if (!context || !input.activeStroke) return;
  if (input.tool && input.activeStroke.tool !== input.tool) return;
  drawLiveStrokePath(context, input.activeStroke, input.pageColor);
}

function getPageStyleBackground(pageColor: NotebookPageColor, style: NotebookPageStyle) {
  if (style === "plain") return undefined;
  const lineColor =
    pageColor === "black" ? "rgba(248,250,252,0.14)" : "rgba(30,41,59,0.14)";
  if (style === "lined") {
    return {
      backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent 39px, ${lineColor} 40px)`,
    };
  }
  if (style === "grid") {
    return {
      backgroundImage: `repeating-linear-gradient(to right, ${lineColor} 0 1px, transparent 1px 40px), repeating-linear-gradient(to bottom, ${lineColor} 0 1px, transparent 1px 40px)`,
    };
  }
  return {
    backgroundImage: `radial-gradient(circle, ${lineColor} 1.35px, transparent 1.35px)`,
    backgroundSize: "28px 28px",
  };
}

function buildThumbnailPoints(points: InkPoint[]) {
  return points
    .slice(0, 80)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

function NotebookPageThumbnail({
  page,
  notebook,
  backgroundFile,
  backgroundUrl,
}: {
  page: NotebookPage;
  notebook: Notebook;
  backgroundFile?: NotebookFile;
  backgroundUrl?: string;
}) {
  const pageColor = page.pageColor ?? notebook.pageColor ?? "white";
  const pageStyle = page.pageStyle ?? notebook.pageStyle ?? "plain";
  const strokes = normalizeStrokes(page.strokeData?.strokes).slice(0, 10);
  const textBlocks = page.textBlocks.slice(0, 3);
  const inkSvg = page.inkData?.svg;

  return (
    <div
      className={`relative mb-2 aspect-[900/1240] overflow-hidden rounded-[0.65rem] border shadow-sm ${PAGE_COLOR_CLASS[pageColor]}`}
      style={getPageStyleBackground(pageColor, pageStyle)}
    >
      {backgroundUrl && backgroundFile?.fileType.startsWith("image/") ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${backgroundUrl}")` }}
        />
      ) : null}
      {backgroundFile?.fileType === "application/pdf" &&
      backgroundFile.storagePath ? (
        <NotebookPdfPage
          aria-hidden="true"
          storagePath={backgroundFile.storagePath}
          pageIndex={page.pdfPageIndex ?? 0}
          lazy
          maxPixelRatio={1.25}
          className="absolute inset-0"
        />
      ) : null}
      {inkSvg ? (
        <Image
          alt=""
          aria-hidden="true"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(inkSvg)}`}
          fill
          unoptimized
          sizes="10rem"
          className="object-fill"
        />
      ) : null}
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        {orderNotebookStrokesForRendering(strokes).map((stroke, index) =>
          stroke.points.length === 1 ? (
            <circle
              key={`${page.id}-stroke-${index}`}
              cx={stroke.points[0].x}
              cy={stroke.points[0].y}
              r={Math.max(3, stroke.width * 1.7)}
              fill={strokePaintColor(stroke, pageColor)}
              opacity={stroke.tool === "highlighter" ? 0.32 : 0.72}
            />
          ) : (
            <polyline
              key={`${page.id}-stroke-${index}`}
              points={buildThumbnailPoints(stroke.points)}
              fill="none"
              stroke={strokePaintColor(stroke, pageColor)}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={Math.max(5, stroke.width * 2.3)}
              opacity={stroke.tool === "highlighter" ? 0.32 : 0.72}
            />
          )
        )}
      </svg>
      <div className="absolute inset-0">
        {textBlocks.map((block) => (
          <div
            key={`${page.id}-${block.id}`}
            className={`absolute overflow-hidden rounded-sm px-1 text-[0.34rem] font-semibold leading-tight ${
              pageColor === "black" ? "text-[#f8fafc]/80" : "text-slate-950/75"
            }`}
            style={{
              left: `${(block.x / CANVAS_WIDTH) * 100}%`,
              top: `${(block.y / CANVAS_HEIGHT) * 100}%`,
              width: `${(block.width / CANVAS_WIDTH) * 100}%`,
              maxHeight: `${(block.height / CANVAS_HEIGHT) * 100}%`,
            }}
          >
            {block.text.trim().slice(0, 34)}
          </div>
        ))}
      </div>
    </div>
  );
}

function shouldAppendLiveInkPoint(
  points: LiveInkPoint[],
  point: LiveInkPoint,
  minDistance = 1.05
) {
  if (points.length < 5) return true;
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

function getLivePointKey(point: LiveInkPoint) {
  return `${Math.round(point.x * 100)}/${Math.round(point.y * 100)}/${point.time}`;
}

function dedupeLiveInkPoints(
  currentPoints: LiveInkPoint[],
  incomingPoints: LiveInkPoint[]
) {
  const recentKeys = new Set(currentPoints.slice(-8).map(getLivePointKey));
  return incomingPoints.filter((point) => {
    const key = getLivePointKey(point);
    if (recentKeys.has(key)) return false;
    recentKeys.add(key);
    return true;
  });
}

function safelySetPointerCapture(element: HTMLElement, pointerId: number) {
  try {
    if (!element.hasPointerCapture(pointerId)) {
      element.setPointerCapture(pointerId);
    }
    return true;
  } catch {
    return false;
  }
}

function safelyReleasePointerCapture(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Safari can drop capture during rapid stylus re-contact; cleanup should continue.
  }
}

function isTextResizeHandleTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-text-resize-handle='true']"));
}

type NotebookIconName =
  | "back"
  | "pages"
  | "text"
  | "pen"
  | "highlighter"
  | "eraser"
  | "undo"
  | "redo"
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
      {name === "highlighter" ? (
        <>
          <path {...common} d="M5 18.5 14.8 8.7l3.5 3.5-9.8 9.8H5v-3.5Z" />
          <path {...common} d="M13.5 7.2 15.7 5a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8l-2.2 2.2" />
          <path {...common} d="M4 22h10" />
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
      {name === "redo" ? (
        <path {...common} d="M15 8h4V4M19 8c-2-2.6-5.6-4.1-9-2.7-4.8 2-5.8 8.1-2.1 11.4 2.5 2.2 6.2 2.4 8.8.5" />
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
      className={`relative inline-flex h-11 min-w-11 items-center justify-center rounded-full border text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:!border-[var(--button-disabled-border)] disabled:!bg-[var(--button-disabled-bg)] disabled:!text-[var(--button-disabled-text)] disabled:saturate-[0.82] ${
        active
          ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-[var(--color-selected-text)] shadow-[0_0_0_3px_rgba(143,125,232,0.18),0_8px_18px_rgba(0,0,0,0.16)]"
          : "border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] hover:-translate-y-0.5 hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)] active:translate-y-0 active:scale-95"
      }`}
    >
      <NotebookIcon name={icon} />
      {children}
    </button>
  );
}

function ThicknessSlider({
  label,
  percent,
  color,
  previewWidth,
  onChange,
}: {
  label: string;
  percent: number;
  color: string;
  previewWidth: number;
  onChange: (value: number) => void;
}) {
  const clampedPercent = clampNotebookThicknessPercent(percent);
  const sliderId = `${label.toLowerCase().replace(/\s+/g, "-")}-slider`;
  return (
    <div className="mt-3 rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="text-xs font-semibold text-text-secondary" htmlFor={sliderId}>
          {label}
        </label>
        <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-2 py-0.5 text-[0.68rem] font-semibold text-text-secondary">
          {clampedPercent}%
        </span>
      </div>
      <div className="relative px-1 py-3">
        <div className="pointer-events-none absolute left-1 right-1 top-1/2 h-px -translate-y-1/2 rounded-full bg-[var(--color-border)]" />
        {NOTEBOOK_THICKNESS_TICKS.map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 rounded-full bg-text-muted"
            style={{ left: `calc(${tick}% - 0.5px)` }}
          />
        ))}
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={clampedPercent}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
          className="notebook-thickness-slider relative z-10 h-7 w-full cursor-pointer bg-transparent"
        />
      </div>
      <div className="mt-1 flex h-8 items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-3">
        <span
          aria-hidden="true"
          className="block w-full rounded-full"
          style={{
            backgroundColor: color,
            height: `${Math.max(2, Math.min(18, previewWidth))}px`,
          }}
        />
      </div>
    </div>
  );
}

function InkColorPicker({
  label,
  value,
  presets,
  getPresetColor,
  onPresetSelect,
  onCustomColorChange,
}: {
  label: string;
  value: NotebookStrokeColor;
  presets: NotebookStrokeColor[];
  getPresetColor: (color: NotebookStrokeColor) => string;
  onPresetSelect: (color: NotebookStrokeColor) => void;
  onCustomColorChange: (color: NotebookStrokeColor) => void;
}) {
  const currentColor = getNotebookStrokePaintColor(value, label === "Highlighter color" ? "highlighter" : "pen");
  const colorInputId = `${label.toLowerCase().replace(/\s+/g, "-")}-custom`;
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {presets.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`${color} ${label.toLowerCase()}`}
              onClick={() => onPresetSelect(color)}
              className={`h-7 w-7 rounded-full border transition ${
                value === color
                  ? "border-[var(--color-selected-border)] ring-2 ring-[var(--color-selected-border)]/40"
                  : "border-[var(--color-border)]"
              }`}
              style={{ backgroundColor: getPresetColor(color) }}
            />
          ))}
        </div>
        <label
          htmlFor={colorInputId}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-1 shadow-sm"
          title={label}
        >
          <span
            aria-hidden="true"
            className="h-full w-full rounded-full border border-black/20"
            style={{ backgroundColor: currentColor }}
          />
        </label>
      </div>
      <input
        id={colorInputId}
        type="color"
        aria-label={label}
        value={currentColor}
        onChange={(event) => {
          onCustomColorChange(normalizeNotebookStrokeColor(event.target.value));
        }}
        className="sr-only"
      />
    </div>
  );
}

export default function NotebookEditorPage() {
  const { user, isDemoUser } = useUser();
  const router = useRouter();
  const params = useParams<{ notebookId?: string | string[] }>();
  const notebookId = Array.isArray(params.notebookId)
    ? params.notebookId[0]
    : params.notebookId;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [textBlocks, setTextBlocks] = useState<NotebookTextBlock[]>([]);
  const [selectedTextBlockId, setSelectedTextBlockId] = useState<string | null>(null);
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pageColor, setPageColor] = useState<NotebookPageColor>("white");
  const [pageStyle, setPageStyle] = useState<NotebookPageStyle>("plain");
  const [penColor, setPenColor] = useState<NotebookStrokeColor>("black");
  const [penThicknessPercent, setPenThicknessPercent] = useState(50);
  const [highlighterColor, setHighlighterColor] = useState<NotebookStrokeColor>("yellow");
  const [highlighterThicknessPercent, setHighlighterThicknessPercent] = useState(50);
  const [eraserMode, setEraserMode] = useState<NotebookEraserMode>("precision");
  const [eraserWidth, setEraserWidth] = useState<EraserWidth>("medium");
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const [inkUndoDepth, setInkUndoDepth] = useState(0);
  const [inkRedoDepth, setInkRedoDepth] = useState(0);
  const [inkHasContent, setInkHasContent] = useState(false);
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
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [phoneFullEditing, setPhoneFullEditing] = useState(false);
  const [showNotebookSettings, setShowNotebookSettings] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState("");
  const [notebookColor, setNotebookColor] = useState<ObjectColorId>("sky");
  const [notebookIcon, setNotebookIcon] = useState<ObjectIconId>("none");
  const [notebookDefaultPageStyle, setNotebookDefaultPageStyle] =
    useState<NotebookPageStyle>("plain");
  const [savingNotebookSettings, setSavingNotebookSettings] = useState(false);
  const [notebookFile, setNotebookFile] = useState<File | null>(null);
  const [notebookUploadProgress, setNotebookUploadProgress] = useState<number | null>(
    null
  );
  const [addingNotebookFile, setAddingNotebookFile] = useState(false);
  const [aiPlaceholderOpen, setAiPlaceholderOpen] = useState(false);
  const [pagesDrawerOpen, setPagesDrawerOpen] = useState(false);
  const [penMenuOpen, setPenMenuOpen] = useState(false);
  const [highlighterMenuOpen, setHighlighterMenuOpen] = useState(false);
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const [pageTransitionDirection, setPageTransitionDirection] =
    useState<PageTransitionDirection>(null);
  const [pageSwipeOffset, setPageSwipeOffset] = useState(0);
  const [pageSwipeSettling, setPageSwipeSettling] = useState(false);
  const [activeTextGestureId, setActiveTextGestureId] = useState<string | null>(null);
  const [touchInkHintVisible, setTouchInkHintVisible] = useState(false);
  const textBlockDragRef = useRef<TextBlockDragState | null>(null);
  const textBlockResizeRef = useRef<TextBlockResizeState | null>(null);
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const inkEditorRef = useRef<NotebookInkEditorHandle | null>(null);
  const savedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveHighlighterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<ActiveStrokeState | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const inkUiSyncTimerRef = useRef<number | null>(null);
  const nativeCommitTimerRef = useRef<number | null>(null);
  const nativeCommitOperationRef = useRef<Promise<boolean> | null>(null);
  const savedCanvasFrameRef = useRef<number | null>(null);
  const liveCanvasFrameRef = useRef<number | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const pendingNativeStrokesRef = useRef<Stroke[]>([]);
  const pendingNativeRedoRef = useRef<Stroke[]>([]);
  const selectedPageRef = useRef<NotebookPage | null>(null);
  const textBlocksRef = useRef<NotebookTextBlock[]>([]);
  const saveStatusRef = useRef<SaveStatus>("saved");
  const inkInteractionActiveRef = useRef(false);
  const saveOperationRef = useRef<Promise<boolean> | null>(null);
  const saveCurrentPageRef = useRef<
    ((options?: { includeActiveStroke?: boolean; flush?: boolean }) => Promise<boolean>) | null
  >(null);
  const saveQueuedRef = useRef(false);
  const pendingInkUiRef = useRef<{
    hasContent: boolean;
    redoDepth: number;
    undoDepth: number;
  } | null>(null);
  const pageColorRef = useRef<NotebookPageColor>("white");
  const pageStyleRef = useRef<NotebookPageStyle>("plain");
  const pageSwipeRef = useRef<PageSwipeState | null>(null);
  const touchPointersRef = useRef<Map<number, PointerClientSample>>(new Map());
  const pinchZoomRef = useRef<PinchZoomState | null>(null);
  const undoStackRef = useRef<NotebookUndoAction[]>([]);
  const redoStackRef = useRef<NotebookUndoAction[]>([]);
  const editorRevisionRef = useRef(0);
  const latestSaveIdRef = useRef(0);
  const ignoredTouchInkCountRef = useRef(0);
  const touchInkHintTimeoutRef = useRef<number | null>(null);
  const stylusInteractionRef = useRef(false);
  const stylusCooldownUntilRef = useRef(0);
  const hydratedPageIdRef = useRef<string | null>(null);
  const fullNotebookEditingEnabled = !isPhoneLayout || phoneFullEditing;
  const fullNotebookEditingEnabledRef = useRef(fullNotebookEditingEnabled);
  const toolRef = useRef<EditorTool>("pen");
  const penColorRef = useRef<NotebookStrokeColor>("black");
  const penThicknessPercentRef = useRef(50);
  const highlighterColorRef = useRef<NotebookStrokeColor>("yellow");
  const highlighterThicknessPercentRef = useRef(50);
  const eraserWidthRef = useRef<EraserWidth>("medium");

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );
  const selectedPageIndex = useMemo(
    () => pages.findIndex((page) => page.id === selectedPage?.id),
    [pages, selectedPage?.id]
  );
  const hasMappedBackgroundPages = useMemo(
    () => pages.some((page) => Boolean(page.backgroundFileId)),
    [pages]
  );
  const swipeAdjacentPage =
    pageSwipeOffset < 0
      ? pages[selectedPageIndex + 1]
      : pageSwipeOffset > 0
        ? pages[selectedPageIndex - 1]
        : null;
  const selectedPageInkSvg = useMemo(() => {
    if (!selectedPage) {
      return legacyStrokesToJsDrawSvg([], CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    return (
      selectedPage.inkData?.svg ??
      legacyStrokesToJsDrawSvg(
        normalizeStrokes(selectedPage.strokeData?.strokes),
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
    if (!backgroundFileId) return files[0] ?? null;
    return files.find((file) => file.id === backgroundFileId) ?? files[0] ?? null;
  }, [
    files,
    hasMappedBackgroundPages,
    notebook?.uploadedFileId,
    selectedPage?.backgroundFileId,
  ]);
  const activeNotebookFileUrl = activeNotebookFile ? fileUrls[activeNotebookFile.id] : undefined;
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
    if (typeof window === "undefined" || !selectedPage?.id) return;
    const nextSearch = buildNotebookPageSearch(
      window.location.search,
      selectedPage.id
    );
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [selectedPage?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadFileUrls = async () => {
      const entries = await Promise.all(
        files.map(async (file) => {
          if (
            !file.storagePath ||
            !file.fileType.startsWith("image/")
          ) {
            return [file.id, ""] as const;
          }
          try {
            return [file.id, await getNotebookFileDownloadUrl(file.storagePath)] as const;
          } catch {
            return [file.id, ""] as const;
          }
        })
      );
      if (!cancelled) {
        setFileUrls(
          Object.fromEntries(entries.filter(([, url]) => Boolean(url)))
        );
      }
    };

    if (files.length === 0) {
      setFileUrls({});
      return;
    }
    void loadFileUrls();
    return () => {
      cancelled = true;
    };
  }, [files]);

  useEffect(() => {
    fullNotebookEditingEnabledRef.current = fullNotebookEditingEnabled;
  }, [fullNotebookEditingEnabled]);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    penColorRef.current = penColor;
  }, [penColor]);

  useEffect(() => {
    penThicknessPercentRef.current = clampNotebookThicknessPercent(penThicknessPercent);
  }, [penThicknessPercent]);

  useEffect(() => {
    highlighterColorRef.current = highlighterColor;
  }, [highlighterColor]);

  useEffect(() => {
    highlighterThicknessPercentRef.current =
      clampNotebookThicknessPercent(highlighterThicknessPercent);
  }, [highlighterThicknessPercent]);

  useEffect(() => {
    eraserWidthRef.current = eraserWidth;
  }, [eraserWidth]);

  useEffect(() => {
    textBlocksRef.current = textBlocks;
  }, [textBlocks]);

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
    redoStackRef.current = [];
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(0);
  }, []);

  const cancelInkUiSync = useCallback(() => {
    if (inkUiSyncTimerRef.current === null) return;
    window.clearTimeout(inkUiSyncTimerRef.current);
    inkUiSyncTimerRef.current = null;
  }, []);

  const flushInkUiSync = useCallback(() => {
    cancelInkUiSync();
    const pending = pendingInkUiRef.current;
    if (pending) {
      pendingInkUiRef.current = null;
      setInkHasContent(pending.hasContent);
      setInkUndoDepth(pending.undoDepth);
      setInkRedoDepth(pending.redoDepth);
    }
    setSaveStatus(saveStatusRef.current);
    setFeedback((current) =>
      current?.message === "Could not autosave this page." ? null : current
    );
  }, [cancelInkUiSync]);

  const scheduleInkUiSync = useCallback(() => {
    cancelInkUiSync();
    inkUiSyncTimerRef.current = window.setTimeout(() => {
      inkUiSyncTimerRef.current = null;
      flushInkUiSync();
    }, NOTEBOOK_INK_UI_SYNC_IDLE_MS);
  }, [cancelInkUiSync, flushInkUiSync]);

  const scheduleNotebookAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      if (
        inkInteractionActiveRef.current ||
        inkEditorRef.current?.isInteracting()
      ) {
        scheduleNotebookAutosave();
        return;
      }
      void saveCurrentPageRef.current?.();
    }, NOTEBOOK_AUTOSAVE_IDLE_MS);
  }, []);

  const markPageUnsaved = useCallback((options?: {
    deferUi?: boolean;
    scheduleUi?: boolean;
  }) => {
    editorRevisionRef.current += 1;
    saveStatusRef.current = "unsaved";
    scheduleNotebookAutosave();
    if (options?.deferUi) {
      if (options.scheduleUi !== false) {
        scheduleInkUiSync();
      }
      return;
    }
    flushInkUiSync();
  }, [flushInkUiSync, scheduleInkUiSync, scheduleNotebookAutosave]);

  const renderSavedCanvasNow = useCallback(() => {
    const canvas = savedCanvasRef.current;
    if (!canvas) return;
    drawSavedNotebookCanvas({
      canvas,
      strokes: pendingNativeStrokesRef.current,
      pageColor: pageColorRef.current,
    });
  }, []);

  const cancelNativeCommit = useCallback(() => {
    if (nativeCommitTimerRef.current === null) return;
    window.clearTimeout(nativeCommitTimerRef.current);
    nativeCommitTimerRef.current = null;
  }, []);

  const flushPendingNativeStrokes = useCallback(async (): Promise<boolean> => {
    cancelNativeCommit();
    if (nativeCommitOperationRef.current) {
      return nativeCommitOperationRef.current;
    }
    const editor = inkEditorRef.current;
    const snapshot = pendingNativeStrokesRef.current.slice();
    if (snapshot.length === 0) return true;
    if (!editor) return false;

    const operation = (async () => {
      pendingNativeStrokesRef.current = pendingNativeStrokesRef.current.slice(
        snapshot.length
      );
      renderSavedCanvasNow();
      try {
        await editor.commitStrokes(snapshot);
        pendingNativeRedoRef.current = [];
        flushInkUiSync();
        return true;
      } catch (error) {
        pendingNativeStrokesRef.current = [
          ...snapshot,
          ...pendingNativeStrokesRef.current,
        ].slice(-NOTEBOOK_MAX_PENDING_NATIVE_STROKES);
        renderSavedCanvasNow();
        console.error("Could not commit native notebook ink.", error);
        setFeedback({
          type: "error",
          message: "Your writing is still visible, but it could not be prepared for saving yet.",
        });
        return false;
      }
    })();
    nativeCommitOperationRef.current = operation;
    try {
      return await operation;
    } finally {
      if (nativeCommitOperationRef.current === operation) {
        nativeCommitOperationRef.current = null;
      }
    }
  }, [cancelNativeCommit, flushInkUiSync, renderSavedCanvasNow]);

  const scheduleNativeCommit = useCallback(() => {
    cancelNativeCommit();
    nativeCommitTimerRef.current = window.setTimeout(() => {
      nativeCommitTimerRef.current = null;
      void flushPendingNativeStrokes();
    }, NOTEBOOK_NATIVE_COMMIT_IDLE_MS);
  }, [cancelNativeCommit, flushPendingNativeStrokes]);

  const renderLiveCanvasNow = useCallback(() => {
    const highlighterCanvas = liveHighlighterCanvasRef.current;
    if (highlighterCanvas) {
      drawLiveInkCanvas({
        canvas: highlighterCanvas,
        activeStroke: activeStrokeRef.current?.liveStroke ?? null,
        pageColor: pageColorRef.current,
        tool: "highlighter",
      });
    }
    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    drawLiveInkCanvas({
      canvas,
      activeStroke: activeStrokeRef.current?.liveStroke ?? null,
      pageColor: pageColorRef.current,
      tool: activeStrokeRef.current?.liveStroke.tool === "highlighter" ? "pen" : undefined,
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

      const releaseCanvas = options?.canvas ?? liveCanvasRef.current;
      if (releaseCanvas) {
        safelyReleasePointerCapture(releaseCanvas, activeStroke.pointerId);
      }

      const finalizedStroke = finalizeInkStroke(activeStroke.stroke);
      activeStrokeRef.current = null;
      document.body.classList.remove("jami-inking-active");
      clearNotebookCanvas(liveHighlighterCanvasRef.current);
      clearNotebookCanvas(liveCanvasRef.current);

      if (finalizedStroke) {
        pendingNativeStrokesRef.current = appendPendingNotebookStroke(
          pendingNativeStrokesRef.current,
          finalizedStroke
        );
        pendingNativeRedoRef.current = [];
        pendingInkUiRef.current = {
          hasContent: true,
          undoDepth: pendingNativeStrokesRef.current.length,
          redoDepth: 0,
        };
        markPageUnsaved({ deferUi: true, scheduleUi: false });
        scheduleNativeCommit();
      }
      scheduleSavedCanvasRender();
      inkInteractionActiveRef.current = false;
      stylusInteractionRef.current = false;
      stylusCooldownUntilRef.current = Date.now() + 180;
    },
    [markPageUnsaved, scheduleNativeCommit, scheduleSavedCanvasRender]
  );

  const loadNotebook = useCallback(async () => {
    if (!user?.uid || !notebookId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    hydratedPageIdRef.current = null;
    editorRevisionRef.current = 0;
    latestSaveIdRef.current = 0;
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
      const requestedPageId =
        typeof window === "undefined"
          ? null
          : getNotebookPageIdFromSearch(window.location.search);
      setSelectedPageId(
        nextPages.find((page) => page.id === requestedPageId)?.id ??
          nextPages[0]?.id ??
          null
      );
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
      redoStackRef.current = [];
      setUndoDepth(0);
      setRedoDepth(0);
      setInkUndoDepth(0);
      setInkRedoDepth(0);
      setInkHasContent(false);
      inkInteractionActiveRef.current = false;
      pendingInkUiRef.current = null;
      pendingNativeStrokesRef.current = [];
      pendingNativeRedoRef.current = [];
      cancelNativeCommit();
      cancelInkUiSync();
      setActiveTextGestureId(null);
      clearNotebookCanvas(savedCanvasRef.current);
      clearNotebookCanvas(liveHighlighterCanvasRef.current);
      clearNotebookCanvas(liveCanvasRef.current);
      hydratedPageIdRef.current = null;
      return;
    }

    if (hydratedPageIdRef.current === selectedPage.id) {
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
    redoStackRef.current = [];
    setUndoDepth(0);
    setRedoDepth(0);
    setInkUndoDepth(0);
    setInkRedoDepth(0);
    setInkHasContent(
      Boolean(selectedPage.inkData?.svg) || (selectedPage.strokeData?.strokes.length ?? 0) > 0
    );
    inkInteractionActiveRef.current = false;
    pendingInkUiRef.current = null;
    pendingNativeStrokesRef.current = [];
    pendingNativeRedoRef.current = [];
    cancelNativeCommit();
    cancelInkUiSync();
    setActiveTextGestureId(null);
    clearNotebookCanvas(liveHighlighterCanvasRef.current);
    clearNotebookCanvas(liveCanvasRef.current);
    setPageColor(selectedPage.pageColor ?? notebook?.pageColor ?? "white");
    setPageStyle(selectedPage.pageStyle ?? notebook?.pageStyle ?? "plain");
    hydratedPageIdRef.current = selectedPage.id;
    editorRevisionRef.current = 0;
    saveStatusRef.current = "saved";
    setSaveStatus("saved");
  }, [
    cancelNativeCommit,
    cancelInkUiSync,
    notebook?.pageColor,
    notebook?.pageStyle,
    selectedPage,
  ]);

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
    pageStyleRef.current = pageStyle;
  }, [pageStyle]);

  useEffect(() => {
    if (typeof document === "undefined") return;

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
      finishActiveStroke();
      stylusInteractionRef.current = false;
      stylusCooldownUntilRef.current = Date.now() + 180;
      touchPointersRef.current.clear();
      pinchZoomRef.current = null;
      pageSwipeRef.current = null;
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
      if (savedCanvasFrameRef.current !== null) {
        window.cancelAnimationFrame(savedCanvasFrameRef.current);
        savedCanvasFrameRef.current = null;
      }
      if (liveCanvasFrameRef.current !== null) {
        window.cancelAnimationFrame(liveCanvasFrameRef.current);
        liveCanvasFrameRef.current = null;
      }
      if (touchInkHintTimeoutRef.current !== null) {
        window.clearTimeout(touchInkHintTimeoutRef.current);
        touchInkHintTimeoutRef.current = null;
      }
      cancelNativeCommit();
      document.body.classList.remove("jami-inking-active");
    };
  }, [cancelNativeCommit, finishActiveStroke]);

  const updateTouchPointer = (event: ReactPointerEvent<HTMLElement>) => {
    touchPointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      pressure: 0.5,
      time: Math.max(0, Math.round(event.nativeEvent.timeStamp ?? 0)),
    });
  };

  const startPinchZoom = () => {
    const [first, second] = Array.from(touchPointersRef.current.values());
    if (!first || !second) return;
    setUserAdjustedZoom(true);
    pinchZoomRef.current = {
      startDistance: getPinchDistance(first, second),
      startZoom: pageZoom,
      lastCenterX: (first.clientX + second.clientX) / 2,
      lastCenterY: (first.clientY + second.clientY) / 2,
    };
    pageSwipeRef.current = null;
  };

  const handleTouchPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return false;
    if (
      shouldSuppressTouchAfterStylus({
        stylusActive: stylusInteractionRef.current,
        cooldownUntil: stylusCooldownUntilRef.current,
        now: Date.now(),
      })
    ) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
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

  const handleTouchPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" || !touchPointersRef.current.has(event.pointerId)) {
      return false;
    }
    updateTouchPointer(event);
    const pinch = pinchZoomRef.current;
    if (!pinch || touchPointersRef.current.size < 2) return false;

    const [first, second] = Array.from(touchPointersRef.current.values());
    if (first && second) {
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;
      setPageZoom(
        getNotebookPageZoomAfterPinch({
          startDistance: pinch.startDistance,
          currentDistance: getPinchDistance(first, second),
          startZoom: pinch.startZoom,
        })
      );
      pageScrollRef.current?.scrollBy({
        left: pinch.lastCenterX - centerX,
        top: pinch.lastCenterY - centerY,
        behavior: "auto",
      });
      pinch.lastCenterX = centerX;
      pinch.lastCenterY = centerY;
    }
    pageSwipeRef.current = null;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const handleTouchPointerEnd = (
    event: ReactPointerEvent<HTMLElement>,
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

  const getNotebookSampleBatchFromNativeEvent = useCallback((
    event: PointerEvent,
    canvas: HTMLElement,
    strokeStartTime?: number
  ): { points: LiveInkPoint[]; startTime: number } => {
    const rect = canvas.getBoundingClientRect();
    const samples = getPointerClientSamples(event);
    const startTime = strokeStartTime ?? samples[0]?.time ?? event.timeStamp ?? 0;
    return {
      startTime,
      points: samples.map((sample) => ({
        ...mapClientPointToNotebookPage({
          clientX: sample.clientX,
          clientY: sample.clientY,
          rect,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
        }),
        pressure: sample.pressure,
        time: Math.max(0, Math.round(sample.time - startTime)),
      })),
    };
  }, []);

  const getNotebookPointsFromEvent = (event: ReactPointerEvent<HTMLElement>): Point[] =>
    getNotebookSampleBatchFromNativeEvent(event.nativeEvent, event.currentTarget).points.map(
      ({ x, y }) => ({ x, y })
    );

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

  const startDrawingOnCanvas = useCallback(
    (event: PointerEvent, canvas: HTMLCanvasElement) => {
      const currentTool = toolRef.current;
      if (
        isNotebookTextEditingTarget(event.target) ||
        !fullNotebookEditingEnabledRef.current ||
        !shouldPointerDrawEvent(event, currentTool)
      ) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      clearNotebookNativeSelection(document);
      finishActiveStroke();
      cancelNativeCommit();
      cancelInkUiSync();

      safelySetPointerCapture(canvas, event.pointerId);

      const sampleBatch = getNotebookSampleBatchFromNativeEvent(event, canvas);
      const livePoints = sampleBatch.points;
      const points = livePoints.map(({ x, y, pressure, time }) => ({ x, y, pressure, time }));
      const strokeTool: NotebookStrokeTool =
        currentTool === "eraser" || currentTool === "highlighter" ? currentTool : "pen";
      const strokeColor =
        strokeTool === "eraser"
          ? "white"
          : strokeTool === "highlighter"
            ? highlighterColorRef.current
            : penColorRef.current;
      const strokeWidth =
        strokeTool === "eraser"
          ? ERASER_WIDTH_VALUE[eraserWidthRef.current]
          : strokeTool === "highlighter"
            ? getHighlighterWidthFromPercent(highlighterThicknessPercentRef.current)
            : getPenWidthFromPercent(penThicknessPercentRef.current);

      activeStrokeRef.current = {
        pointerId: event.pointerId,
        startTime: sampleBatch.startTime,
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
      inkInteractionActiveRef.current = true;
      stylusInteractionRef.current = event.pointerType === "pen";
      stylusCooldownUntilRef.current = Number.POSITIVE_INFINITY;
      document.body.classList.add("jami-inking-active");
      renderLiveCanvasNow();
      return true;
    },
    [
      cancelNativeCommit,
      cancelInkUiSync,
      finishActiveStroke,
      getNotebookSampleBatchFromNativeEvent,
      renderLiveCanvasNow,
    ]
  );

  const continueDrawingOnCanvas = useCallback(
    (event: PointerEvent, canvas: HTMLCanvasElement) => {
      const activeStroke = activeStrokeRef.current;
      if (!activeStroke || activeStroke.pointerId !== event.pointerId) return false;
      if (
        isNotebookTextEditingTarget(event.target) ||
        !fullNotebookEditingEnabledRef.current
      ) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      const sampleBatch = getNotebookSampleBatchFromNativeEvent(
        event,
        canvas,
        activeStroke.startTime
      );
      const livePoints = dedupeLiveInkPoints(activeStroke.liveStroke.points, sampleBatch.points);
      if (livePoints.length === 0) return true;
      activeStroke.stroke = {
        ...activeStroke.stroke,
        points: appendInkPoints(
          activeStroke.stroke.points,
          livePoints.map(({ x, y, pressure, time }) => ({ x, y, pressure, time })),
          1_200
        ),
      };
      activeStroke.liveStroke = {
        ...activeStroke.liveStroke,
        points: appendLiveInkPoints(activeStroke.liveStroke.points, livePoints, 1_200),
      };
      scheduleLiveCanvasRender();
      return true;
    },
    [getNotebookSampleBatchFromNativeEvent, scheduleLiveCanvasRender]
  );

  const stopDrawingOnCanvas = useCallback(
    (event: PointerEvent, canvas: HTMLCanvasElement) => {
      const activeStroke = activeStrokeRef.current;
      if (!activeStroke || activeStroke.pointerId !== event.pointerId) return false;
      event.preventDefault();
      event.stopPropagation();
      finishActiveStroke({ pointerId: event.pointerId, canvas });
      return true;
    },
    [finishActiveStroke]
  );

  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas || typeof window === "undefined") return;

    const stopReactIfHandled = (event: PointerEvent, handled: boolean) => {
      if (!handled) return;
      event.stopImmediatePropagation();
    };

    const handleNativePointerDown: EventListener = (event) => {
      if (!(event instanceof PointerEvent)) return;
      stopReactIfHandled(event, startDrawingOnCanvas(event, canvas));
    };
    const handleNativePointerMove: EventListener = (event) => {
      if (!(event instanceof PointerEvent)) return;
      stopReactIfHandled(event, continueDrawingOnCanvas(event, canvas));
    };
    const handleNativePointerStop: EventListener = (event) => {
      if (!(event instanceof PointerEvent)) return;
      stopReactIfHandled(event, stopDrawingOnCanvas(event, canvas));
    };
    const handleWindowPointerStop: EventListener = (event) => {
      if (!(event instanceof PointerEvent)) return;
      const activeStroke = activeStrokeRef.current;
      if (!activeStroke || activeStroke.pointerId !== event.pointerId) return;
      stopReactIfHandled(event, stopDrawingOnCanvas(event, canvas));
    };

    const listenerOptions = { passive: false, capture: true };
    const supportsRawUpdate = "onpointerrawupdate" in window;
    canvas.addEventListener("pointerdown", handleNativePointerDown, listenerOptions);
    canvas.addEventListener("pointermove", handleNativePointerMove, listenerOptions);
    if (supportsRawUpdate) {
      canvas.addEventListener("pointerrawupdate", handleNativePointerMove, listenerOptions);
    }
    canvas.addEventListener("pointerup", handleNativePointerStop, listenerOptions);
    canvas.addEventListener("pointercancel", handleNativePointerStop, listenerOptions);
    canvas.addEventListener("lostpointercapture", handleNativePointerStop, listenerOptions);
    window.addEventListener("pointerup", handleWindowPointerStop, listenerOptions);
    window.addEventListener("pointercancel", handleWindowPointerStop, listenerOptions);

    return () => {
      canvas.removeEventListener("pointerdown", handleNativePointerDown, listenerOptions);
      canvas.removeEventListener("pointermove", handleNativePointerMove, listenerOptions);
      if (supportsRawUpdate) {
        canvas.removeEventListener("pointerrawupdate", handleNativePointerMove, listenerOptions);
      }
      canvas.removeEventListener("pointerup", handleNativePointerStop, listenerOptions);
      canvas.removeEventListener("pointercancel", handleNativePointerStop, listenerOptions);
      canvas.removeEventListener("lostpointercapture", handleNativePointerStop, listenerOptions);
      window.removeEventListener("pointerup", handleWindowPointerStop, listenerOptions);
      window.removeEventListener("pointercancel", handleWindowPointerStop, listenerOptions);
    };
  }, [continueDrawingOnCanvas, startDrawingOnCanvas, stopDrawingOnCanvas]);

  useEffect(() => {
    if (tool === "pen" || tool === "highlighter") return;
    void flushPendingNativeStrokes();
  }, [flushPendingNativeStrokes, tool]);

  const collectCurrentStrokes = useCallback(
    (options: { includeActiveStroke?: boolean } = {}) => {
      let currentStrokes = strokesRef.current;
      const activeStroke = activeStrokeRef.current;
      if (activeStroke && options.includeActiveStroke) {
        const finalizedStroke = finalizeInkStroke(activeStroke.stroke);
        activeStrokeRef.current = null;
        document.body.classList.remove("jami-inking-active");
        clearNotebookCanvas(liveHighlighterCanvasRef.current);
        clearNotebookCanvas(liveCanvasRef.current);
        const canvas = liveCanvasRef.current;
        if (canvas) safelyReleasePointerCapture(canvas, activeStroke.pointerId);
        if (finalizedStroke) {
          currentStrokes =
            finalizedStroke.tool === "eraser"
              ? (applyNotebookEraser({
                  strokes: currentStrokes,
                  eraser: finalizedStroke,
                  mode: eraserMode,
                }) as Stroke[])
              : [...currentStrokes, finalizedStroke];
          const changed =
            finalizedStroke.tool !== "eraser" ||
            currentStrokes.length !== strokesRef.current.length;
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
    [eraserMode, pushUndoAction, scheduleSavedCanvasRender]
  );

  const savePageSnapshot = useCallback(
    async (input: {
      page: NotebookPage;
      textBlocks: NotebookTextBlock[];
      strokes: Stroke[];
      inkSvg: string;
      hasInk: boolean;
      pageColor: NotebookPageColor;
      pageStyle: NotebookPageStyle;
      saveId: number;
      saveRevision: number;
    }) => {
      if (!user?.uid) return false;
      saveStatusRef.current = "saving";
      setSaveStatus("saving");
      try {
        const persistedTextBlocks = input.textBlocks;
        const typedContent = buildTypedContentFromTextBlocks(persistedTextBlocks) ?? "";
        const status: NotebookPageStatus =
          typedContent.trim() || input.hasInk ? "working" : "blank";
        const inkData = makeNotebookInkData(input.inkSvg);
        await saveNotebookPageSnapshot(user.uid, {
          notebookId: input.page.notebookId,
          pageId: input.page.id,
          typedContent,
          textBlocks: persistedTextBlocks,
          inkData,
          pageStyle: input.pageStyle,
          status,
        });
        const currentRevision = editorRevisionRef.current;
        const selectedPageId = selectedPageRef.current?.id ?? null;
        const canUpdateLivePage = shouldNotebookSaveUpdateLivePage({
          pageId: input.page.id,
          selectedPageId,
          saveRevision: input.saveRevision,
          currentRevision,
        });
        const canReplaceStoredContent = shouldNotebookSaveReplaceStoredPageContent({
          pageId: input.page.id,
          selectedPageId,
          saveRevision: input.saveRevision,
          currentRevision,
        });
        setPages((current) =>
          current.map((page) =>
            page.id === input.page.id
              ? {
                  ...page,
                  typedContent: typedContent.trim() || undefined,
                  textBlocks: canReplaceStoredContent ? persistedTextBlocks : page.textBlocks,
                  inkData: canReplaceStoredContent ? inkData : page.inkData,
                  strokeData: canReplaceStoredContent ? undefined : page.strokeData,
                  pageColor: canReplaceStoredContent ? input.pageColor : page.pageColor,
                  pageStyle: canReplaceStoredContent ? input.pageStyle : page.pageStyle,
                  status,
                  updatedAt: Date.now(),
                }
              : page
          )
        );
        setNotebook((current) =>
          current
            ? {
                ...current,
                previewInkSvg:
                  input.inkSvg.length <= 120_000
                    ? input.inkSvg
                    : undefined,
                previewPageId: input.page.id,
                updatedAt: Date.now(),
              }
            : current
        );
        if (canUpdateLivePage) {
          setTextBlocks(persistedTextBlocks);
          textBlocksRef.current = persistedTextBlocks;
          strokesRef.current = input.strokes;
          setStrokes(input.strokes);
        }
        if (
          isNotebookSaveCompletionCurrent({
            saveId: input.saveId,
            saveRevision: input.saveRevision,
            currentRevision,
            latestSaveId: latestSaveIdRef.current,
          })
        ) {
          saveStatusRef.current = "saved";
          setSaveStatus("saved");
          setFeedback((current) =>
            current?.message === "Could not autosave this page." ? null : current
          );
        }
        return true;
      } catch (error) {
        if (
          isNotebookSaveCompletionCurrent({
            saveId: input.saveId,
            saveRevision: input.saveRevision,
            currentRevision: editorRevisionRef.current,
            latestSaveId: latestSaveIdRef.current,
          })
        ) {
          saveStatusRef.current = "failed";
          setSaveStatus("failed");
          setFeedback({
            type: "error",
            message: error instanceof Error ? error.message : "Could not autosave this page.",
          });
        }
        return false;
      }
    },
    [user?.uid]
  );

  const saveCurrentPage = useCallback(
    async function saveCurrentPage(
      options: { includeActiveStroke?: boolean; flush?: boolean } = {}
    ): Promise<boolean> {
      const activeSaveOperation = saveOperationRef.current;
      if (activeSaveOperation) {
        if (!options.flush) {
          saveQueuedRef.current = true;
          return true;
        }
        await activeSaveOperation;
        if (
          saveOperationRef.current &&
          saveOperationRef.current !== activeSaveOperation
        ) {
          return saveCurrentPage({ ...options, flush: true });
        }
        if (
          saveStatusRef.current === "unsaved" ||
          saveStatusRef.current === "failed"
        ) {
          return saveCurrentPage({ ...options, flush: true });
        }
        return true;
      }

      const page = selectedPageRef.current;
      if (!page || !user?.uid) return false;
      if (options.includeActiveStroke && activeStrokeRef.current) {
        finishActiveStroke();
      }
      if (inkEditorRef.current?.isInteracting() || inkInteractionActiveRef.current) {
        return false;
      }

      if (!(await flushPendingNativeStrokes())) return false;

      const operation = (async () => {
        const saveId = latestSaveIdRef.current + 1;
        latestSaveIdRef.current = saveId;
        const saveRevision = editorRevisionRef.current;
        const inkEditor = inkEditorRef.current;
        const inkSvg = inkEditor
          ? await inkEditor.serializeAsync()
          : selectedPageInkSvg;

        if (
          shouldDiscardNotebookInkExport({
            svgAvailable: inkSvg !== null,
            inkInteractionActive:
              Boolean(inkEditorRef.current?.isInteracting()) ||
              inkInteractionActiveRef.current,
            saveRevision,
            currentRevision: editorRevisionRef.current,
          })
        ) {
          return false;
        }

        if (inkSvg === null) return false;

        return savePageSnapshot({
          page,
          textBlocks: textBlocksRef.current,
          strokes: collectCurrentStrokes({
            includeActiveStroke: options.includeActiveStroke,
          }),
          inkSvg,
          hasInk:
            inkEditorRef.current?.hasInk() ?? strokesRef.current.length > 0,
          pageColor: pageColorRef.current,
          pageStyle: pageStyleRef.current,
          saveId,
          saveRevision,
        });
      })();

      saveOperationRef.current = operation;
      let saved = false;
      try {
        saved = await operation;
      } finally {
        if (saveOperationRef.current === operation) {
          saveOperationRef.current = null;
        }
      }

      const stillDirty =
        saveStatusRef.current === "unsaved" || saveStatusRef.current === "failed";
      if (options.flush && stillDirty) {
        if (saveStatusRef.current === "failed") return false;
        if (
          inkInteractionActiveRef.current ||
          inkEditorRef.current?.isInteracting()
        ) {
          return false;
        }
        return saveCurrentPage({ ...options, flush: true });
      }

      const shouldRunQueuedSave =
        saveQueuedRef.current && !inkInteractionActiveRef.current && stillDirty;
      saveQueuedRef.current = false;
      if (shouldRunQueuedSave) {
        void saveCurrentPage();
      }
      return saved;
    },
    [
      collectCurrentStrokes,
      finishActiveStroke,
      flushPendingNativeStrokes,
      savePageSnapshot,
      selectedPageInkSvg,
      user?.uid,
    ]
  );

  useEffect(() => {
    saveCurrentPageRef.current = saveCurrentPage;
    return () => {
      if (saveCurrentPageRef.current === saveCurrentPage) {
        saveCurrentPageRef.current = null;
      }
    };
  }, [saveCurrentPage]);

  const selectPageById = useCallback(
    async (pageId: string) => {
      if (pageId === selectedPageRef.current?.id) return true;
      if (inkEditorRef.current?.isInteracting()) return false;
      if (
        saveStatusRef.current === "unsaved" ||
        saveStatusRef.current === "failed"
      ) {
        const saved = await saveCurrentPage({
          includeActiveStroke: true,
          flush: true,
        });
        if (!saved) return false;
      }
      setSelectedPageId(pageId);
      return true;
    },
    [saveCurrentPage]
  );

  const selectPageByOffset = useCallback(
    async (offset: -1 | 1, animate = true) => {
      if (selectedPageIndex < 0) return false;
      const nextIndex = getNotebookPageIndexAfterSwipe({
        currentIndex: selectedPageIndex,
        pageCount: pages.length,
        direction: offset === 1 ? "next" : "previous",
      });
      if (nextIndex === selectedPageIndex) return false;
      const nextPage = pages[nextIndex];
      if (!nextPage) return false;
      const selected = await selectPageById(nextPage.id);
      if (selected && animate) {
        setPageTransitionDirection(offset === 1 ? "next" : "previous");
      }
      return selected;
    },
    [pages, selectPageById, selectedPageIndex]
  );

  useEffect(() => {
    if (!pageTransitionDirection) return;
    const timeout = window.setTimeout(() => setPageTransitionDirection(null), 190);
    return () => window.clearTimeout(timeout);
  }, [pageTransitionDirection]);

  useEffect(
    () => () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      cancelInkUiSync();
    },
    [cancelInkUiSync]
  );

  useEffect(() => {
    const saveBeforeExit = (event?: PageTransitionEvent | BeforeUnloadEvent) => {
      if (
        saveStatusRef.current === "unsaved" ||
        saveStatusRef.current === "failed"
      ) {
        void saveCurrentPage({ includeActiveStroke: true, flush: true });
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
  }, [saveCurrentPage]);

  const handleExitNotebook = async (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (
      saveStatusRef.current === "unsaved" ||
      saveStatusRef.current === "failed"
    ) {
      const saved = await saveCurrentPage({
        includeActiveStroke: true,
        flush: true,
      });
      if (!saved) {
        setFeedback({
          type: "error",
          message: "Could not autosave before leaving the notebook.",
        });
        return;
      }
    }
    router.push(`/dashboard/folders/${notebook?.folderId ?? ""}`);
  };

  const handleRetryPageSave = () => {
    if (
      saveStatusRef.current !== "failed" ||
      inkInteractionActiveRef.current ||
      inkEditorRef.current?.isInteracting()
    ) {
      return;
    }
    saveStatusRef.current = "unsaved";
    setSaveStatus("unsaved");
    void saveCurrentPage({ flush: true });
  };

  const handleStartPageSwipe = (event: ReactPointerEvent<HTMLElement>) => {
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
      lastTime: event.timeStamp,
      velocityX: 0,
      completed: false,
    };
    setPageSwipeSettling(false);
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePageSwipeMove = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId || swipe.completed) return;

    const deltaX = event.clientX - swipe.lastX;
    const deltaY = event.clientY - swipe.lastY;
    const elapsed = Math.max(1, event.timeStamp - swipe.lastTime);
    swipe.velocityX = deltaX / elapsed;
    swipe.currentX = event.clientX;
    swipe.currentY = event.clientY;
    swipe.lastX = event.clientX;
    swipe.lastY = event.clientY;
    swipe.lastTime = event.timeStamp;

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

    if (Math.abs(totalDx) <= Math.abs(totalDy) * 1.05) return;
    const canMoveNext = totalDx < 0 && selectedPageIndex < pages.length - 1;
    const canMovePrevious = totalDx > 0 && selectedPageIndex > 0;
    const resistedOffset =
      canMoveNext || canMovePrevious ? totalDx : Math.sign(totalDx) * Math.sqrt(Math.abs(totalDx)) * 5;
    setPageSwipeOffset(resistedOffset);
    event.preventDefault();
  };

  const handleStopPageSwipe = (
    event: ReactPointerEvent<HTMLElement>,
    options: { allowTextTap?: boolean } = {}
  ) => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pageSwipeRef.current = null;

    const pageWidth = pageSurfaceRef.current?.getBoundingClientRect().width ?? 1;
    const deltaX = event.clientX - swipe.startX;
    const direction = deltaX < 0 ? "next" : "previous";
    const canChangePage =
      direction === "next" ? selectedPageIndex < pages.length - 1 : selectedPageIndex > 0;
    const shouldChangePage =
      canChangePage &&
      (Math.abs(deltaX) >= pageWidth * 0.22 || Math.abs(swipe.velocityX) >= 0.55);

    if (Math.abs(deltaX) > 8) {
      event.preventDefault();
      setPageSwipeSettling(true);
      if (shouldChangePage) {
        swipe.completed = true;
        setPageSwipeOffset(0);
        setPageSwipeSettling(false);
        void selectPageByOffset(direction === "next" ? 1 : -1);
      } else {
        setPageSwipeOffset(0);
        window.setTimeout(() => setPageSwipeSettling(false), 260);
      }
    }

    if (
      !swipe.completed &&
      Math.abs(deltaX) <= 8 &&
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
        const [point] = getNotebookPointsFromEvent(
          event
        );
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
      pinchZoomRef.current
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
    setPenMenuOpen(false);
    setHighlighterMenuOpen(false);
    setEraserMenuOpen(false);
    if (handleTouchPointerDown(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStartPageSwipe(event);
      return;
    }
    if (shouldPointerDraw(event.pointerType, tool)) {
      event.preventDefault();
      return;
    }

    if (tool !== "text") {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const [point] = getNotebookPointsFromEvent(event);
    if (!point) return;
    createTextBlockAtPoint(point);
  };

  const handlePagePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (handleTouchPointerMove(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handlePageSwipeMove(event);
      return;
    }
    if (shouldPointerDraw(event.pointerType, tool)) {
      event.preventDefault();
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
      return;
    }
    if (shouldPointerDraw(event.pointerType, tool)) {
      event.preventDefault();
    }
  };

  const handlePagePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    if (handleTouchPointerEnd(event)) return;
    if (shouldPointerSwipePages(event.pointerType)) {
      handleStopPageSwipe(event);
      return;
    }
    if (shouldPointerDraw(event.pointerType, tool)) {
      event.preventDefault();
    }
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
    if (isTextResizeHandleTarget(event.target)) return;
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
    safelySetPointerCapture(event.currentTarget, event.pointerId);
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
    if (drag && pageSurfaceRef.current) {
      safelyReleasePointerCapture(pageSurfaceRef.current, event.pointerId);
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
    edge: NotebookTextBlockResizeEdge,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (!fullNotebookEditingEnabled) return;
    const pageElement = event.currentTarget.closest<HTMLElement>("[data-notebook-page-surface]");
    if (!pageElement) return;
    const rect = pageElement.getBoundingClientRect();
    textBlockResizeRef.current = {
      id: block.id,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      originX: block.x,
      originY: block.y,
      originWidth: block.width,
      originHeight: block.height,
      originText: block.text,
      pageWidth: rect.width,
      pageHeight: rect.height,
      previousTextBlocks: textBlocksRef.current,
    };
    pageSwipeRef.current = null;
    pinchZoomRef.current = null;
    textBlockDragRef.current = null;
    setActiveTextGestureId(block.id);
    setSelectedTextBlockId(block.id);
    safelySetPointerCapture(event.currentTarget, event.pointerId);
    if (pageElement) {
      safelySetPointerCapture(pageElement, event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const resizeTextBlock = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = textBlockResizeRef.current;
    if (!resize) return;
    const dx = ((event.clientX - resize.startX) / resize.pageWidth) * CANVAS_WIDTH;
    const dy = ((event.clientY - resize.startY) / resize.pageHeight) * CANVAS_HEIGHT;
    const currentBlock = textBlocksRef.current.find((block) => block.id === resize.id);
    const nextBlock = resizeNotebookTextBlockFromEdge({
      block: {
        id: resize.id,
        x: resize.originX,
        y: resize.originY,
        width: resize.originWidth,
        height: resize.originHeight,
        text: currentBlock?.text ?? resize.originText,
      },
      edge: resize.edge,
      deltaX: dx,
      deltaY: dy,
    });
    updateTextBlock(resize.id, nextBlock);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleTextBlockPointerMove = (
    block: NotebookTextBlock,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (textBlockResizeRef.current?.id === block.id) {
      resizeTextBlock(event);
      return;
    }
    if (!editingTextBlockId || editingTextBlockId !== block.id) {
      dragTextBlock(event);
    }
  };

  const handleTextBlockPointerUp = (
    block: NotebookTextBlock,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (textBlockResizeRef.current?.id === block.id) {
      stopTextBlockResize(event);
      return;
    }
    if (!editingTextBlockId || editingTextBlockId !== block.id) {
      stopTextBlockDrag(event);
    }
  };

  const stopTextBlockResize = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = textBlockResizeRef.current;
    if (resize && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (resize && pageSurfaceRef.current) {
      safelyReleasePointerCapture(pageSurfaceRef.current, event.pointerId);
    }
    if (resize) {
      const next = textBlocksRef.current;
      const previousBlock = resize.previousTextBlocks.find((block) => block.id === resize.id);
      const nextBlock = next.find((block) => block.id === resize.id);
      if (
        previousBlock &&
        nextBlock &&
        (previousBlock.x !== nextBlock.x ||
          previousBlock.y !== nextBlock.y ||
          previousBlock.width !== nextBlock.width ||
          previousBlock.height !== nextBlock.height)
      ) {
        pushUndoAction({ type: "textBlocks", previous: resize.previousTextBlocks, next });
      }
    }
    textBlockResizeRef.current = null;
    setActiveTextGestureId(null);
    event.stopPropagation();
  };

  const handlePageSurfaceTextGestureMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (textBlockResizeRef.current) {
      resizeTextBlock(event);
      return;
    }
    if (textBlockDragRef.current) {
      dragTextBlock(event);
    }
  };

  const handlePageSurfaceTextGestureStop = (event: ReactPointerEvent<HTMLElement>) => {
    if (textBlockResizeRef.current) {
      stopTextBlockResize(event);
      return;
    }
    if (textBlockDragRef.current) {
      stopTextBlockDrag(event);
    }
  };

  const handleAddPage = async () => {
    if (!user?.uid || !notebook || !fullNotebookEditingEnabled) return;
    if (
      saveStatusRef.current === "unsaved" ||
      saveStatusRef.current === "failed"
    ) {
      const saved = await saveCurrentPage({
        includeActiveStroke: true,
        flush: true,
      });
      if (!saved) {
        setFeedback({
          type: "error",
          message: "Could not autosave before adding a page.",
        });
        return;
      }
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
        pageStyle: notebook.pageStyle ?? "plain",
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

  const handleDeletePage = async (page: NotebookPage) => {
    if (!user?.uid || !notebook || !fullNotebookEditingEnabled) return;
    if (pages.length <= 1) {
      setFeedback({ type: "error", message: "A notebook needs at least one page." });
      return;
    }
    const confirmed = window.confirm(
      `Delete Page ${page.pageNumber}? This removes the page's writing and text boxes.`
    );
    if (!confirmed) return;

    if (
      saveStatusRef.current === "unsaved" ||
      saveStatusRef.current === "failed"
    ) {
      const saved = await saveCurrentPage({
        includeActiveStroke: true,
        flush: true,
      });
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
        page.id === selectedPageRef.current?.id
          ? nextPages[Math.min(Math.max(deletedIndex, 0), nextPages.length - 1)] ?? nextPages[0]
          : nextPages.find((candidate) => candidate.id === selectedPageRef.current?.id) ??
            nextPages[0];

      hydratedPageIdRef.current = null;
      setPages(nextPages);
      setSelectedPageId(nextSelectedPage?.id ?? null);
      setSelectedTextBlockId(null);
      setEditingTextBlockId(null);
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

  const openNotebookSettings = () => {
    if (!notebook) return;
    setNotebookTitle(notebook.title);
    setNotebookColor(normalizeObjectColor(notebook.color));
    setNotebookIcon(normalizeObjectIcon(notebook.icon));
    setNotebookDefaultPageStyle(notebook.pageStyle ?? "plain");
    setShowNotebookSettings(true);
    if (typeof window !== "undefined") {
      const search = new URLSearchParams(window.location.search);
      search.set("settings", "1");
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}?${search.toString()}${window.location.hash}`
      );
    }
  };

  const closeNotebookSettings = () => {
    setShowNotebookSettings(false);
    setNotebookFile(null);
    setNotebookUploadProgress(null);
    if (typeof window !== "undefined") {
      const search = new URLSearchParams(window.location.search);
      search.delete("settings");
      const query = search.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
      );
    }
  };

  useEffect(() => {
    if (
      notebook &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("settings") === "1" &&
      !showNotebookSettings
    ) {
      setNotebookTitle(notebook.title);
      setNotebookColor(normalizeObjectColor(notebook.color));
      setNotebookIcon(normalizeObjectIcon(notebook.icon));
      setNotebookDefaultPageStyle(notebook.pageStyle ?? "plain");
      setShowNotebookSettings(true);
    }
  }, [notebook, showNotebookSettings]);

  const handleSaveNotebookSettings = async () => {
    if (!user?.uid || !notebook) return;
    setSavingNotebookSettings(true);
    setFeedback(null);
    try {
      await updateNotebook(user.uid, notebook.id, {
        title: notebookTitle,
        color: notebookColor,
        icon: notebookIcon,
        pageStyle: notebookDefaultPageStyle,
      });
      setNotebook((current) =>
        current
          ? {
              ...current,
              title: notebookTitle.trim() || current.title,
              color: notebookColor,
              icon: notebookIcon,
              pageStyle: notebookDefaultPageStyle,
              updatedAt: Date.now(),
            }
          : current
      );
      closeNotebookSettings();
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
      closeNotebookSettings();
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
      closeNotebookSettings();
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

  const handleUndo = useCallback(() => {
    const pendingStroke = pendingNativeStrokesRef.current.at(-1);
    if (pendingStroke) {
      cancelNativeCommit();
      pendingNativeStrokesRef.current =
        pendingNativeStrokesRef.current.slice(0, -1);
      pendingNativeRedoRef.current = [
        ...pendingNativeRedoRef.current.slice(
          -(NOTEBOOK_MAX_PENDING_NATIVE_STROKES - 1)
        ),
        pendingStroke,
      ];
      pendingInkUiRef.current = {
        hasContent:
          pendingNativeStrokesRef.current.length > 0 ||
          (inkEditorRef.current?.hasInk() ?? false),
        undoDepth: pendingNativeStrokesRef.current.length + inkUndoDepth,
        redoDepth: pendingNativeRedoRef.current.length + inkRedoDepth,
      };
      renderSavedCanvasNow();
      markPageUnsaved({ deferUi: true });
      if (pendingNativeStrokesRef.current.length > 0) {
        scheduleNativeCommit();
      }
      return;
    }
    if (inkUndoDepth > 0) {
      inkEditorRef.current?.undo();
      return;
    }
    const action = undoStackRef.current.at(-1);
    if (!action) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-39), action];
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);

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
  }, [
    cancelNativeCommit,
    inkRedoDepth,
    inkUndoDepth,
    markPageUnsaved,
    renderSavedCanvasNow,
    scheduleNativeCommit,
    scheduleSavedCanvasRender,
  ]);

  const handleRedo = useCallback(() => {
    const pendingStroke = pendingNativeRedoRef.current.at(-1);
    if (pendingStroke) {
      cancelNativeCommit();
      pendingNativeRedoRef.current = pendingNativeRedoRef.current.slice(0, -1);
      pendingNativeStrokesRef.current = appendPendingNotebookStroke(
        pendingNativeStrokesRef.current,
        pendingStroke
      );
      pendingInkUiRef.current = {
        hasContent: true,
        undoDepth: pendingNativeStrokesRef.current.length + inkUndoDepth,
        redoDepth: pendingNativeRedoRef.current.length + inkRedoDepth,
      };
      renderSavedCanvasNow();
      markPageUnsaved({ deferUi: true });
      scheduleNativeCommit();
      return;
    }
    if (inkRedoDepth > 0) {
      inkEditorRef.current?.redo();
      return;
    }
    const action = redoStackRef.current.at(-1);
    if (!action) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-39), action];
    setRedoDepth(redoStackRef.current.length);
    setUndoDepth(undoStackRef.current.length);

    if (action.type === "strokes") {
      strokesRef.current = action.next;
      setStrokes(action.next);
      scheduleSavedCanvasRender();
    } else {
      textBlocksRef.current = action.next;
      setTextBlocks(action.next);
      setSelectedTextBlockId(null);
      setEditingTextBlockId(null);
      setActiveTextGestureId(null);
    }
    markPageUnsaved();
  }, [
    cancelNativeCommit,
    inkRedoDepth,
    inkUndoDepth,
    markPageUnsaved,
    renderSavedCanvasNow,
    scheduleNativeCommit,
    scheduleSavedCanvasRender,
  ]);

  const handleClearCurrentPage = () => {
    const confirmed = window.confirm("Clear drawing from this page?");
    if (!confirmed) return;
    cancelNativeCommit();
    pendingNativeStrokesRef.current = [];
    pendingNativeRedoRef.current = [];
    inkEditorRef.current?.clear();
    setInkHasContent(false);
    activeStrokeRef.current = null;
    strokesRef.current = [];
    setStrokes([]);
    markPageUnsaved();
    clearNotebookCanvas(savedCanvasRef.current);
    clearNotebookCanvas(liveHighlighterCanvasRef.current);
    clearNotebookCanvas(liveCanvasRef.current);
    scheduleSavedCanvasRender();
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
        setTool((current) => (current === "text" ? "select" : "text"));
      }
      if (key === "p") {
        setTool((current) => (current === "pen" ? "select" : "pen"));
      }
      if (key === "h") {
        setTool((current) => (current === "highlighter" ? "select" : "highlighter"));
      }
      if (key === "e") {
        setTool((current) => (current === "eraser" ? "select" : "eraser"));
      }
      if (key === "escape") {
        setTool("select");
        setPenMenuOpen(false);
        setHighlighterMenuOpen(false);
        setEraserMenuOpen(false);
        setSelectedTextBlockId(null);
        setEditingTextBlockId(null);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [fullNotebookEditingEnabled, handleRedo, handleUndo]);

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

  return (
    <main
      data-app-surface="true"
      className="notebook-editor-shell fixed inset-0 z-[70] flex min-w-0 flex-col overflow-hidden bg-[var(--color-surface-base)] text-text-primary"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="z-40 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)]/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] shadow-[0_8px_20px_rgba(0,0,0,0.14)] backdrop-blur-xl">
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
              {saveStatus === "failed" ? (
                <button
                  type="button"
                  className="mt-0.5 text-xs font-semibold text-[var(--color-error-text)] underline decoration-current/45 underline-offset-2"
                  onClick={handleRetryPageSave}
                >
                  Save failed. Retry save
                </button>
              ) : (
                <div className="text-xs text-text-muted">
                  {saveStatus === "saving"
                    ? "Saving..."
                    : saveStatus === "unsaved"
                      ? "Unsaved changes"
                      : "Autosaved just now"}
                </div>
              )}
            </div>
            <div className="app-chip shrink-0 rounded-full px-3 py-1 text-xs font-semibold">
              {selectedPage ? `${selectedPage.pageNumber} / ${pages.length}` : "No page"}
            </div>
          </div>
          <div
            className="mt-2 flex max-w-full items-center gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Notebook tools"
          >
              <ToolbarIconButton
                label="Pages"
                icon="pages"
                active={pagesDrawerOpen}
                onClick={() => {
                  setPenMenuOpen(false);
                  setHighlighterMenuOpen(false);
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
                  setHighlighterMenuOpen(false);
                  setEraserMenuOpen(false);
                  void handleAddPage();
                }}
              />
              <ToolbarIconButton
                label="Text box (T)"
                icon="text"
                active={tool === "text"}
                disabled={!fullNotebookEditingEnabled}
                onClick={() => {
                  setTool((current) => (current === "text" ? "select" : "text"));
                  setPenMenuOpen(false);
                  setHighlighterMenuOpen(false);
                  setEraserMenuOpen(false);
                }}
              />
              <div className="relative">
                <ToolbarIconButton
                  label="Pen (P)"
                  icon="pen"
                  active={tool === "pen" || penMenuOpen}
                  disabled={!fullNotebookEditingEnabled}
                  onClick={() => {
                    setTool("pen");
                    setHighlighterMenuOpen(false);
                    setEraserMenuOpen(false);
                    setPenMenuOpen((value) => !value);
                  }}
                >
                  <span
                    className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border border-black/30"
                    style={{ backgroundColor: getNotebookStrokePaintColor(penColor, "pen") }}
                  />
                </ToolbarIconButton>
              </div>
              <div className="relative">
                <ToolbarIconButton
                  label="Highlighter (H)"
                  icon="highlighter"
                  active={tool === "highlighter" || highlighterMenuOpen}
                  disabled={!fullNotebookEditingEnabled}
                  onClick={() => {
                    setTool("highlighter");
                    setPenMenuOpen(false);
                    setEraserMenuOpen(false);
                    setHighlighterMenuOpen((value) => !value);
                  }}
                >
                  <span
                    className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border border-black/30"
                    style={{
                      backgroundColor: getNotebookStrokePaintColor(highlighterColor, "highlighter"),
                    }}
                  />
                </ToolbarIconButton>
              </div>
              <div className="relative">
                <ToolbarIconButton
                  label="Eraser (E)"
                  icon="eraser"
                  active={tool === "eraser" || eraserMenuOpen}
                  disabled={!fullNotebookEditingEnabled}
                  onClick={() => {
                    setTool("eraser");
                    setPenMenuOpen(false);
                    setHighlighterMenuOpen(false);
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
              </div>
              <ToolbarIconButton
                label="Undo (Ctrl+Z)"
                icon="undo"
                disabled={!fullNotebookEditingEnabled || (undoDepth === 0 && inkUndoDepth === 0)}
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
                disabled={!fullNotebookEditingEnabled || (redoDepth === 0 && inkRedoDepth === 0)}
                onClick={() => {
                  setPenMenuOpen(false);
                  setHighlighterMenuOpen(false);
                  setEraserMenuOpen(false);
                  handleRedo();
                }}
              />
              <ToolbarIconButton
                label="Clear drawing"
                icon="clear"
                disabled={!fullNotebookEditingEnabled || !inkHasContent}
                onClick={() => {
                  setPenMenuOpen(false);
                  setHighlighterMenuOpen(false);
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
                  setHighlighterMenuOpen(false);
                  setEraserMenuOpen(false);
                  setAiPlaceholderOpen((value) => !value);
                }}
              />
              <ToolbarIconButton
                label="Notebook settings"
                icon="settings"
                onClick={() => {
                  setPenMenuOpen(false);
                  setHighlighterMenuOpen(false);
                  setEraserMenuOpen(false);
                  openNotebookSettings();
                }}
              />
          </div>
          {penMenuOpen || highlighterMenuOpen || eraserMenuOpen ? (
            <div className="mx-auto mt-2 w-full max-w-2xl rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-3 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
              {penMenuOpen ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(15rem,1.15fr)] sm:items-end">
                  <InkColorPicker
                    label="Pen color"
                    value={penColor}
                    presets={["black", "white", "red", "green"]}
                    getPresetColor={(color) => PEN_COLOR_HEX[color as NotebookPenColor]}
                    onPresetSelect={(color) => {
                      setPenColor(color);
                      setTool("pen");
                    }}
                    onCustomColorChange={(color) => {
                      setPenColor(color);
                      setTool("pen");
                    }}
                  />
                  <ThicknessSlider
                    label="Pen thickness"
                    percent={penThicknessPercent}
                    color={getNotebookStrokePaintColor(penColor, "pen")}
                    previewWidth={getPenWidthFromPercent(penThicknessPercent)}
                    onChange={(value) => {
                      setPenThicknessPercent(clampNotebookThicknessPercent(value));
                      setTool("pen");
                    }}
                  />
                </div>
              ) : null}
              {highlighterMenuOpen ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(15rem,1.15fr)] sm:items-end">
                  <InkColorPicker
                    label="Highlighter color"
                    value={highlighterColor}
                    presets={["yellow", "green", "pink"]}
                    getPresetColor={(color) =>
                      HIGHLIGHTER_COLOR_HEX[color as NotebookHighlighterColor]
                    }
                    onPresetSelect={(color) => {
                      setHighlighterColor(color);
                      setTool("highlighter");
                    }}
                    onCustomColorChange={(color) => {
                      setHighlighterColor(color);
                      setTool("highlighter");
                    }}
                  />
                  <ThicknessSlider
                    label="Highlighter thickness"
                    percent={highlighterThicknessPercent}
                    color={getNotebookStrokePaintColor(highlighterColor, "highlighter")}
                    previewWidth={getHighlighterWidthFromPercent(highlighterThicknessPercent) / 2}
                    onChange={(value) => {
                      setHighlighterThicknessPercent(clampNotebookThicknessPercent(value));
                      setTool("highlighter");
                    }}
                  />
                </div>
              ) : null}
              {eraserMenuOpen ? (
                <div className="grid gap-4 sm:grid-cols-2">
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
                            setTool("eraser");
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
                      {(["small", "medium", "large"] as EraserWidth[]).map((width) => (
                        <button
                          key={width}
                          type="button"
                          aria-label={`${width} eraser`}
                          title={`${width[0].toUpperCase()}${width.slice(1)} eraser`}
                          onClick={() => {
                            setEraserWidth(width);
                            setTool("eraser");
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
                </div>
              ) : null}
            </div>
          ) : null}
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
              <Button type="button" variant="secondary" onClick={closeNotebookSettings}>
                Close
              </Button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <Input
                label="Notebook title"
                value={notebookTitle}
                onChange={(event) => setNotebookTitle(event.target.value)}
              />
              <div className="app-subtle-panel rounded-[1.4rem] p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Preview
                </div>
                <NotebookObjectCard
                  title={notebookTitle.trim() || "Notebook preview"}
                  color={notebookColor}
                  icon={notebookIcon}
                  pageColor={notebook.pageColor}
                  pageStyle={notebookDefaultPageStyle}
                  updatedLabel={`${PAGE_STYLE_LABELS[notebookDefaultPageStyle]} ${notebook.pageColor}`}
                  compact
                  className="mt-2"
                />
              </div>
              <div className="lg:col-span-2">
                <ObjectStylePicker
                  color={notebookColor}
                  icon={notebookIcon}
                  onColorChange={setNotebookColor}
                  onIconChange={setNotebookIcon}
                  colorLabel="Cover colour"
                  iconLabel="Cover icon"
                />
              </div>
            </div>
            {notebook.type === "uploaded_file" ? (
              <div className="app-chip mt-5 rounded-[1.15rem] px-4 py-3 text-sm leading-6">
                Imported pages use the PDF or image as their background. Blank pages added later use white plain paper.
              </div>
            ) : (
              <div className="mt-5">
                <div className="text-sm font-medium text-text-secondary">Default page style</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["plain", "lined", "grid", "dot"] as NotebookPageStyle[]).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setNotebookDefaultPageStyle(style)}
                      className={`min-h-[2.35rem] rounded-full border px-4 text-sm font-semibold transition ${
                        notebookDefaultPageStyle === style ? "app-selected" : "app-chip"
                      }`}
                    >
                      {PAGE_STYLE_LABELS[style]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-5 rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
              <div className="text-sm font-semibold text-text-primary">
                Add PDF or image pages
              </div>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                {isDemoUser
                  ? "Exit the shared demo to upload PDF or image pages."
                  : "Add a file to this notebook. Its pages will be placed after the current last page and remain available for ink and text notes."}
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="mb-1.5 block text-sm font-medium text-text-secondary">
                    PDF or image
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    disabled={isDemoUser || addingNotebookFile || savingNotebookSettings}
                    onChange={(event) =>
                      setNotebookFile(event.target.files?.[0] ?? null)
                    }
                    className="block min-h-[2.75rem] w-full rounded-2xl border border-border bg-surface-panel-strong px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-warm-glow file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-warm-accent disabled:cursor-not-allowed"
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    isDemoUser || !notebookFile || addingNotebookFile || savingNotebookSettings
                  }
                  onClick={() => void handleAddNotebookFile()}
                >
                  {addingNotebookFile
                    ? notebookUploadProgress !== null
                      ? `Adding ${notebookUploadProgress}%`
                      : "Adding pages..."
                    : "Add pages"}
                </Button>
              </div>
              {addingNotebookFile && notebookUploadProgress !== null ? (
                <div
                  role="progressbar"
                  aria-label="Notebook file upload progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={notebookUploadProgress}
                  className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]"
                >
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
                    style={{ width: `${notebookUploadProgress}%` }}
                  />
                </div>
              ) : null}
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
                  const deleting = deletingPageId === page.id;
                  return (
                    <div
                      key={page.id}
                      className={`group relative rounded-[0.95rem] border transition ${
                        selected
                          ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-[var(--color-selected-text)]"
                          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-secondary hover:border-border-strong"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPagesDrawerOpen(false);
                          void selectPageById(page.id);
                        }}
                        className="block w-full rounded-[0.95rem] p-2 text-left transition"
                      >
                        <NotebookPageThumbnail
                          page={page}
                          notebook={notebook}
                          backgroundFile={
                            files.find(
                              (file) =>
                                file.id ===
                                resolveNotebookPageBackgroundFileId({
                                  pageBackgroundFileId: page.backgroundFileId,
                                  notebookUploadedFileId:
                                    notebook.uploadedFileId,
                                  firstFileId: files[0]?.id,
                                  hasMappedPages: hasMappedBackgroundPages,
                                })
                            ) ?? files[0]
                          }
                          backgroundUrl={
                            fileUrls[
                              resolveNotebookPageBackgroundFileId({
                                pageBackgroundFileId: page.backgroundFileId,
                                notebookUploadedFileId:
                                  notebook.uploadedFileId,
                                firstFileId: files[0]?.id,
                                hasMappedPages: hasMappedBackgroundPages,
                              }) ?? ""
                            ]
                          }
                        />
                        <div className="text-xs font-semibold">Page {page.pageNumber}</div>
                        <div className="mt-0.5 truncate pr-8 text-[0.68rem] text-text-muted">
                          {page.textBlocks.some((block) => block.text.trim())
                            ? "Text"
                            : page.inkData?.svg || page.strokeData?.strokes?.length
                              ? "Ink"
                              : "Blank"}
                        </div>
                      </button>
                      {pages.length > 1 ? (
                        <button
                          type="button"
                          aria-label={`Delete Page ${page.pageNumber}`}
                          title={`Delete Page ${page.pageNumber}`}
                          disabled={Boolean(deletingPageId) || !fullNotebookEditingEnabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeletePage(page);
                          }}
                          className="app-danger absolute bottom-2 right-2 inline-grid h-8 w-8 place-items-center rounded-full opacity-90 shadow-sm transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-45"
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
                  Add a page to start.
                </div>
              )}
            </div>
          </aside>
        ) : null}

          <div ref={pageScrollRef} className="h-full min-w-0 overflow-auto px-4 py-3 sm:px-6 sm:py-4">
            <div className="mx-auto flex min-h-full w-full max-w-[60rem] flex-col gap-3">
            {selectedPage?.questionPrompt ? (
              <Card tone="warm" padding="sm">
                <p className="text-sm leading-6 text-text-primary">{selectedPage.questionPrompt}</p>
              </Card>
            ) : null}

            {false && files.length > 0 ? (
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

              <div className="notebook-page-stage relative mx-auto w-full overflow-hidden">
                {swipeAdjacentPage ? (
                  <div
                    aria-hidden="true"
                    className={`notebook-page-swipe-preview absolute left-1/2 overflow-hidden rounded-[0.95rem] ${
                      PAGE_COLOR_CLASS[swipeAdjacentPage.pageColor]
                    }`}
                    style={{
                      width: `${Math.round(clampNotebookPageZoom(pageZoom) * 100)}%`,
                      maxWidth: `${NOTEBOOK_PAGE_BASE_WIDTH_REM * clampNotebookPageZoom(pageZoom)}rem`,
                      aspectRatio: editorViewport.isLandscape
                        ? `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`
                        : `${CANVAS_WIDTH} / ${Math.round(
                            CANVAS_HEIGHT * NOTEBOOK_PAGE_PORTRAIT_STRETCH
                          )}`,
                      transform: `translateX(-50%) translateX(${
                        pageSwipeOffset < 0 ? "100%" : "-100%"
                      }) translateX(${pageSwipeOffset}px)`,
                      transition: pageSwipeSettling
                        ? "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)"
                        : "none",
                    }}
                  >
                    <div
                      className="absolute inset-0"
                      style={getPageStyleBackground(
                        swipeAdjacentPage.pageColor,
                        swipeAdjacentPage.pageStyle
                      )}
                    />
                    <div className="absolute inset-x-8 top-8 text-sm font-semibold opacity-35">
                      Page {swipeAdjacentPage.pageNumber}
                    </div>
                  </div>
                ) : null}
                <div
                  ref={pageSurfaceRef}
                  data-notebook-page-surface
                  className={`notebook-page-surface relative mx-auto w-full overflow-hidden rounded-[0.95rem] shadow-[0_18px_48px_rgba(0,0,0,0.2)] ${PAGE_COLOR_CLASS[pageColor]} ${
                    pageTransitionDirection === "next"
                      ? "notebook-page-transition-next"
                      : pageTransitionDirection === "previous"
                        ? "notebook-page-transition-previous"
                      : ""
                  }`}
                  onPointerMove={handlePageSurfaceTextGestureMove}
                  onPointerUp={handlePageSurfaceTextGestureStop}
                  onPointerCancel={handlePageSurfaceTextGestureStop}
                  style={{
                    width: `${Math.round(clampNotebookPageZoom(pageZoom) * 100)}%`,
                    maxWidth: `${NOTEBOOK_PAGE_BASE_WIDTH_REM * clampNotebookPageZoom(pageZoom)}rem`,
                    aspectRatio: editorViewport.isLandscape
                      ? `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`
                      : `${CANVAS_WIDTH} / ${Math.round(
                          CANVAS_HEIGHT * NOTEBOOK_PAGE_PORTRAIT_STRETCH
                        )}`,
                    transform: `translateX(${pageSwipeOffset}px)`,
                    transition: pageSwipeSettling
                      ? "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)"
                      : "none",
                  }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-0"
                    style={getPageStyleBackground(pageColor, pageStyle)}
                  />
                  {activeNotebookFile ? (
                    <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center overflow-hidden">
                      {activeNotebookFile.fileType.startsWith("image/") ? (
                        activeNotebookFileUrl ? (
                          <div
                            aria-hidden="true"
                            className="h-full w-full bg-contain bg-center bg-no-repeat"
                            style={{ backgroundImage: `url("${activeNotebookFileUrl}")` }}
                          />
                        ) : (
                          <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-1 text-xs font-semibold text-text-secondary">
                            Loading file...
                          </div>
                        )
                      ) : activeNotebookFile.fileType === "application/pdf" &&
                        activeNotebookFile.storagePath ? (
                          <NotebookPdfPage
                            aria-label={`Notebook file: ${activeNotebookFile.fileName}, page ${
                              (selectedPage.pdfPageIndex ?? 0) + 1
                            }`}
                            storagePath={activeNotebookFile.storagePath}
                            pageIndex={selectedPage.pdfPageIndex ?? 0}
                            className="absolute inset-0"
                          />
                      ) : (
                        null
                      )}
                    </div>
                  ) : null}
                  {!activeNotebookFile &&
                  !inkHasContent &&
                  !textBlocks.some((block) => block.text.trim()) ? (
                    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-8 text-center">
                      <div className="max-w-xs rounded-full border border-current/10 bg-current/[0.035] px-4 py-2 text-xs font-medium opacity-45">
                        Write with a pen or choose Text to add a note
                      </div>
                    </div>
                  ) : null}
                  <NotebookInkEditor
                    ref={inkEditorRef}
                    key={selectedPage.id}
                    pageId={selectedPage.id}
                    pageWidth={CANVAS_WIDTH}
                    pageHeight={CANVAS_HEIGHT}
                    initialSvg={selectedPageInkSvg}
                    activeTool={tool}
                    penColor={penColor}
                    penThickness={getPenWidthFromPercent(penThicknessPercent)}
                    highlighterColor={highlighterColor}
                    highlighterThickness={getHighlighterWidthFromPercent(
                      highlighterThicknessPercent
                    )}
                    eraserThickness={ERASER_WIDTH_VALUE[eraserWidth]}
                    readOnly={!fullNotebookEditingEnabled}
                    onChange={() => {
                      const current = pendingInkUiRef.current;
                      pendingInkUiRef.current = {
                        hasContent: inkEditorRef.current?.hasInk() ?? false,
                        undoDepth: current?.undoDepth ?? inkUndoDepth,
                        redoDepth: current?.redoDepth ?? inkRedoDepth,
                      };
                      markPageUnsaved({ deferUi: true });
                    }}
                    onHistoryChange={(nextUndoDepth, nextRedoDepth) => {
                      pendingInkUiRef.current = {
                        hasContent:
                          pendingInkUiRef.current?.hasContent ??
                          (inkEditorRef.current?.hasInk() ?? false),
                        undoDepth: nextUndoDepth,
                        redoDepth: nextRedoDepth,
                      };
                      scheduleInkUiSync();
                    }}
                    onInteractionChange={(active) => {
                      inkInteractionActiveRef.current = active;
                      stylusInteractionRef.current = active;
                      stylusCooldownUntilRef.current = active
                        ? Number.POSITIVE_INFINITY
                        : Date.now() + 180;
                      if (active) {
                        cancelInkUiSync();
                        if (autosaveTimerRef.current !== null) {
                          window.clearTimeout(autosaveTimerRef.current);
                          autosaveTimerRef.current = null;
                        }
                      } else {
                        if (pendingInkUiRef.current) {
                          scheduleInkUiSync();
                        }
                        if (saveStatusRef.current === "unsaved") {
                          scheduleNotebookAutosave();
                        }
                      }
                    }}
                    onPointerDown={handlePagePointerDown}
                    onPointerMove={handlePagePointerMove}
                    onPointerUp={handlePagePointerUp}
                    onPointerCancel={handlePagePointerCancel}
                  />
                  <canvas
                    ref={savedCanvasRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-[21] h-full w-full"
                  />
                  <canvas
                    ref={liveHighlighterCanvasRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-[22] h-full w-full"
                  />
                  <canvas
                    ref={liveCanvasRef}
                    role="img"
                    aria-label="Notebook drawing page"
                    className={`absolute inset-0 z-[23] h-full w-full touch-none select-none ${
                      fullNotebookEditingEnabled &&
                      (tool === "pen" || tool === "highlighter")
                        ? "pointer-events-auto"
                        : "pointer-events-none"
                    }`}
                  />
                  <div className="pointer-events-none absolute inset-0 z-30">
                    {textBlocks.map((block) => {
                      const selected = selectedTextBlockId === block.id;
                      const editing = editingTextBlockId === block.id;
                      const gesturing = activeTextGestureId === block.id;
                      const displayText = block.text.trim() ? block.text : selected ? "Tap dots to type" : "";
                      return (
                        <div
                          key={block.id}
                          className={`notebook-text-object pointer-events-auto absolute rounded-lg border bg-transparent transition ${
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
                            if (event.pointerType === "touch" && !selected && !editing) {
                              handleTouchPointerDown(event);
                              return;
                            }
                            if (!editing) startTextBlockDrag(block, event);
                          }}
                          onPointerMove={(event) => {
                            if (event.pointerType === "touch" && !selected && !editing) {
                              handleTouchPointerMove(event);
                              return;
                            }
                            handleTextBlockPointerMove(block, event);
                          }}
                          onPointerUp={(event) => {
                            if (event.pointerType === "touch" && !selected && !editing) {
                              handleTouchPointerEnd(event);
                              return;
                            }
                            handleTextBlockPointerUp(block, event);
                          }}
                          onPointerCancel={(event) => {
                            if (event.pointerType === "touch" && !selected && !editing) {
                              handleTouchPointerEnd(event);
                              return;
                            }
                            handleTextBlockPointerUp(block, event);
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
                              {TEXT_BLOCK_RESIZE_HANDLES.map((handle) => (
                                <button
                                  key={handle.edge}
                                  type="button"
                                  data-text-resize-handle="true"
                                  aria-label={handle.label}
                                  title={handle.label}
                                  className={`group absolute z-20 inline-grid touch-none place-items-center rounded-full text-[#f8fafc] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f8fafc] ${handle.positionClass}`}
                                  onPointerDown={(event) =>
                                    startTextBlockResize(block, handle.edge, event)
                                  }
                                  onPointerMove={resizeTextBlock}
                                  onPointerUp={stopTextBlockResize}
                                  onPointerCancel={stopTextBlockResize}
                                >
                                  <span className={`inline-grid h-5 w-5 place-items-center rounded-full border border-black/10 bg-black/55 shadow-sm backdrop-blur transition group-hover:bg-black/70 [&_svg]:h-3 [&_svg]:w-3 ${handle.arrowClass}`}>
                                    <NotebookIcon name="chevron" />
                                  </span>
                                </button>
                              ))}
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
                              data-notebook-text-editor="true"
                              className={`notebook-text-editor h-full w-full resize-none rounded-lg bg-transparent p-2 pb-8 pr-20 text-sm font-medium leading-6 outline-none ${TEXT_COLOR_CLASS[pageColor]}`}
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
            {touchInkHintVisible ? (
              <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-[0_12px_26px_rgba(0,0,0,0.24)]">
                Use Apple Pencil or stylus to write. Fingers move the page.
              </div>
            ) : null}
        </div>
      </div>
    </main>
  );
}
