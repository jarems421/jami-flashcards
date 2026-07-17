"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import AppPage from "@/components/layout/AppPage";
import {
  NotebookInkEditor,
  type NotebookInkEditorHandle,
  type PreparedNotebookStroke,
} from "@/components/workspace/NotebookInkEditor";
import NotebookPdfPage from "@/components/workspace/NotebookPdfPage";
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
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
import type { NotebookEraserMode } from "@/lib/workspace/notebook-eraser";
import { normalizeTimedInkPoint } from "@/lib/workspace/notebook-ink-engine";
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
  clampNotebookPagePan,
  clampNotebookPageZoom,
  clampNotebookThicknessPercent,
  type NotebookPagePan,
  getHighlighterWidthFromPercent,
  getNotebookCreatePagePull,
  getNotebookPageFit,
  getNotebookPageIndexAfterSwipe,
  getNotebookPagePanAfterPinch,
  getNotebookSwipeDragOffset,
  getNotebookSwipeDirection,
  getNotebookSwipeReleaseDecision,
  getNotebookSwipeSettleDuration,
  getNotebookSwipeVelocity,
  getNotebookPageZoomAfterPinch,
  getPenWidthFromPercent,
  shouldCreateNotebookPageOnRelease,
  getPinchDistance,
  mapClientPointToNotebookPage,
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
import {
  clampNotebookToolbarDragOffset,
  getNearestNotebookToolbarDock,
  hasNotebookToolbarDragStarted,
  isNotebookToolbarSideDock,
  readNotebookToolbarDockPreference,
  saveNotebookToolbarDockPreference,
  type NotebookToolbarDock,
} from "@/lib/workspace/notebook-toolbar";

type Feedback = { type: "success" | "error"; message: string };
type Point = { x: number; y: number };
type InkPoint = Point & { pressure?: number; time?: number };
type Stroke = PreparedNotebookStroke & {
  points: InkPoint[];
};
type SaveStatus = "saved" | "unsaved" | "saving" | "failed";
type EditorTool = NotebookStrokeTool | "text" | "select";
type EraserWidth = "small" | "medium" | "large";
type TextBlockDragState = {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  pageWidth: number;
  pageHeight: number;
  previousTextBlocks: NotebookTextBlock[];
  /** Whether the block was already selected when the pointer went down —
   * a motionless release on an already-selected block enters text editing. */
  wasSelected: boolean;
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
  completed: boolean;
};
type PageSwipeMotion = {
  phase: "settling" | "returning" | "handoff";
  kind: "page" | "create" | "cancel";
  direction: "next" | "previous" | null;
  targetPage: NotebookPage | null;
  targetOffset: number;
  durationMs: number;
};
type PinchZoomState = {
  startDistance: number;
  startZoom: number;
  startCenterX: number;
  startCenterY: number;
  lastCenterX: number;
  lastCenterY: number;
  /** Pinch anchor as a fraction of the page, so the page point under the
   * fingers stays under the fingers while zooming. */
  anchorFx: number;
  anchorFy: number;
  /** Committed pan at gesture start; the live transform builds on top of it. */
  basePanX: number;
  basePanY: number;
  pendingZoom: number;
};
type PageFrameSize = { width: number; height: number };
type NotebookToolbarDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  originLeft: number;
  originTop: number;
  toolbarWidth: number;
  toolbarHeight: number;
  frameWidth: number;
  frameHeight: number;
  originDock: NotebookToolbarDock;
  started: boolean;
};
type NotebookUndoAction = {
  type: "textBlocks";
  previous: NotebookTextBlock[];
  next: NotebookTextBlock[];
};
type NotebookConfirmRequest =
  | { kind: "clear-page" }
  | { kind: "delete-page"; page: NotebookPage };

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 1240;
// Gutter kept between the current page and the page sliding in, so they stay
// visibly separated during a swipe instead of joining edge-to-edge.
const NOTEBOOK_PAGE_SWIPE_GAP = 16;
// The page sits flush inside its fixed frame at fit zoom — no border band.
const NOTEBOOK_PAGE_SHEET_CLASS =
  "rounded-[0.625rem] shadow-none";
const PAGE_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "bg-[#f8fafc] text-slate-950",
  black: "bg-[#080a10] text-[#f8fafc]",
};
const NOTEBOOK_PAGE_SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const NOTEBOOK_TOOLBAR_SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
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
const ERASER_WIDTH_VALUE: Record<EraserWidth, number> = {
  small: 36,
  medium: 56,
  large: 76,
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

function strokePaintColor(stroke: Stroke, pageColor: NotebookPageColor) {
  if (stroke.tool === "eraser") return PAGE_COLOR_HEX[pageColor];
  return getNotebookStrokePaintColor(stroke.color, stroke.tool);
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
      className={`relative aspect-[900/1240] overflow-hidden rounded-[0.6rem] shadow-sm ${PAGE_COLOR_CLASS[pageColor]}`}
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
      <div
        className={`absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-[0.62rem] font-semibold leading-none tabular-nums backdrop-blur-sm ${
          pageColor === "black"
            ? "bg-white/15 text-[#f8fafc]"
            : "bg-slate-950/55 text-white"
        }`}
      >
        {page.pageNumber}
      </div>
    </div>
  );
}

// Full-size, non-interactive render of a page's saved content (style, background
// file, ink SVG, text blocks). Used as the swipe preview so the real adjacent
// page is visible while dragging, instead of a blank placeholder that only fills
// in after the editor remounts.
function NotebookPageStaticContent({
  page,
  notebook,
  backgroundFile,
  backgroundUrl,
}: {
  page: NotebookPage;
  notebook: Notebook | null;
  backgroundFile: NotebookFile | null;
  backgroundUrl?: string;
}) {
  const pageColor = page.pageColor ?? notebook?.pageColor ?? "white";
  const pageStyle = page.pageStyle ?? notebook?.pageStyle ?? "plain";
  const inkSvg =
    page.inkData?.svg ??
    legacyStrokesToJsDrawSvg(
      normalizeStrokes(page.strokeData?.strokes),
      CANVAS_WIDTH,
      CANVAS_HEIGHT
    );
  const hasInk =
    Boolean(page.inkData?.svg) || (page.strokeData?.strokes?.length ?? 0) > 0;
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={getPageStyleBackground(pageColor, pageStyle)}
      />
      {backgroundFile?.fileType.startsWith("image/") && backgroundUrl ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${backgroundUrl}")` }}
        />
      ) : null}
      {backgroundFile?.fileType === "application/pdf" && backgroundFile.storagePath ? (
        <NotebookPdfPage
          aria-hidden="true"
          storagePath={backgroundFile.storagePath}
          pageIndex={page.pdfPageIndex ?? 0}
          lazy={false}
          fadeIn={false}
          className="absolute inset-0"
        />
      ) : null}
      {hasInk ? (
        <Image
          alt=""
          aria-hidden="true"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(inkSvg)}`}
          fill
          unoptimized
          sizes="48rem"
          className="object-fill"
        />
      ) : null}
      {page.textBlocks.map((block) => (
        <div
          key={block.id}
          aria-hidden="true"
          className="absolute overflow-hidden rounded-[0.45rem] border border-transparent bg-transparent"
          style={{
            left: `${(block.x / CANVAS_WIDTH) * 100}%`,
            top: `${(block.y / CANVAS_HEIGHT) * 100}%`,
            width: `${(block.width / CANVAS_WIDTH) * 100}%`,
            height: `${(block.height / CANVAS_HEIGHT) * 100}%`,
          }}
        >
          <div
            className={`h-full w-full overflow-hidden whitespace-pre-wrap rounded-[0.45rem] p-2 pr-10 text-sm font-medium leading-6 ${
              pageColor === "black" ? "text-[#f8fafc]" : "text-slate-950"
            }`}
          >
            {block.text}
          </div>
        </div>
      ))}
    </>
  );
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
  | "ai"
  | "chevron"
  | "trash"
  | "plus"
  | "check"
  | "alert"
  | "close";

// Hand-drawn on a consistent 24px grid with a uniform 1.8 stroke, rounded
// caps/joins, and shared optical margins, so the set reads as one family.
function NotebookIcon({ name }: { name: NotebookIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]">
      {name === "back" ? <path {...common} d="M14.5 17.5 9 12l5.5-5.5" /> : null}
      {name === "pages" ? (
        <>
          <rect {...common} x="8" y="3.8" width="11.2" height="14.4" rx="2.2" />
          <path {...common} d="M4.8 8.1v9.7a2.7 2.7 0 0 0 2.7 2.7h7.7" />
        </>
      ) : null}
      {name === "text" ? (
        <path {...common} d="M6 7.4V5.4h12v2M12 5.4v13.2M9.5 18.6h5" />
      ) : null}
      {name === "pen" ? (
        <>
          <path {...common} d="m4.9 19.1 1-3.9L16 5.1a2.05 2.05 0 0 1 2.9 2.9L8.8 18.1l-3.9 1Z" />
          <path {...common} d="m13.9 7.2 2.9 2.9" />
        </>
      ) : null}
      {name === "highlighter" ? (
        <>
          <path {...common} d="M5.6 17.9 14.7 8.8l1.7-1.7a1.95 1.95 0 0 1 2.75 0l.35.35a1.95 1.95 0 0 1 0 2.75L17.8 11.9l-9.1 9.1H5.6v-3.1Z" />
          <path {...common} d="M4.6 21h9.2" />
        </>
      ) : null}
      {name === "eraser" ? (
        <>
          <path {...common} d="M13.6 5.7 5.5 13.8a2 2 0 0 0 0 2.85l2.15 2.15a2 2 0 0 0 1.4.6h3.25l6.1-6.1a2 2 0 0 0 0-2.85l-2.9-2.9a2 2 0 0 0-2.85 0Z" />
          <path {...common} d="m9.3 10 4.9 4.9M12.7 19.4h6.7" />
        </>
      ) : null}
      {name === "undo" ? (
        <>
          <path {...common} d="M9 13.6 4.5 9.1 9 4.6" />
          <path {...common} d="M4.5 9.1h9.6a5.35 5.35 0 0 1 0 10.7H9.2" />
        </>
      ) : null}
      {name === "redo" ? (
        <>
          <path {...common} d="M15 13.6l4.5-4.5L15 4.6" />
          <path {...common} d="M19.5 9.1H9.9a5.35 5.35 0 0 0 0 10.7h4.9" />
        </>
      ) : null}
      {name === "ai" ? (
        <>
          <path
            {...common}
            d="M11 5.3c.38 2.1 1.1 3.55 2.02 4.48.93.92 2.38 1.64 4.48 2.02-2.1.38-3.55 1.1-4.48 2.02-.92.93-1.64 2.38-2.02 4.48-.38-2.1-1.1-3.55-2.02-4.48-.93-.92-2.38-1.64-4.48-2.02 2.1-.38 3.55-1.1 4.48-2.02C9.9 8.85 10.62 7.4 11 5.3Z"
          />
          <path
            {...common}
            d="M18.5 14.7c.2.98.53 1.67.97 2.11.44.44 1.13.77 2.11.97-.98.2-1.67.53-2.11.97-.44.44-.77 1.13-.97 2.11-.2-.98-.53-1.67-.97-2.11-.44-.44-1.13-.77-2.11-.97.98-.2 1.67-.53 2.11-.97.44-.44.77-1.13.97-2.11Z"
          />
        </>
      ) : null}
      {name === "chevron" ? <path {...common} d="m7 10.4 5 5 5-5" /> : null}
      {name === "trash" ? (
        <>
          <path {...common} d="M4.5 6.6h15M9.5 6.6V5.2a1.6 1.6 0 0 1 1.6-1.6h1.8a1.6 1.6 0 0 1 1.6 1.6v1.4" />
          <path {...common} d="m18.3 6.6-.85 12a2 2 0 0 1-2 1.85H8.55a2 2 0 0 1-2-1.85l-.85-12" />
          <path {...common} d="M10.1 10.6v5.8M13.9 10.6v5.8" />
        </>
      ) : null}
      {name === "plus" ? <path {...common} d="M12 5.5v13M5.5 12h13" /> : null}
      {name === "check" ? <path {...common} d="m5.5 12.6 4.2 4.2 8.8-9.4" /> : null}
      {name === "alert" ? (
        <>
          <circle {...common} cx="12" cy="12" r="8.25" />
          <path {...common} d="M12 8v4.6M12 15.9h.01" />
        </>
      ) : null}
      {name === "close" ? <path {...common} d="m6.5 6.5 11 11M17.5 6.5l-11 11" /> : null}
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
      className={`relative inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:!border-[var(--button-disabled-border)] disabled:!bg-[var(--button-disabled-bg)] disabled:!text-[var(--button-disabled-text)] disabled:saturate-[0.82] ${
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

// Icon-only autosave state so the header never shifts as the status changes.
// The failed state is the exception: it becomes an explicit retry action.
function NotebookSaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "failed") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-error-text)]/40 bg-[var(--color-error-text)]/10 px-2 py-0.5 text-[0.68rem] font-semibold text-[var(--color-error-text)] transition hover:bg-[var(--color-error-text)]/20 [&_svg]:h-3.5 [&_svg]:w-3.5"
      >
        <NotebookIcon name="alert" />
        Retry save
      </button>
    );
  }

  const label =
    status === "saving"
      ? "Saving..."
      : status === "unsaved"
        ? "Unsaved changes"
        : "All changes saved";
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="inline-grid h-5 w-5 shrink-0 place-items-center text-text-muted [&_svg]:h-3.5 [&_svg]:w-3.5"
    >
      {status === "saving" ? (
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      ) : status === "unsaved" ? (
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-[var(--color-selected-border)]"
        />
      ) : (
        <NotebookIcon name="check" />
      )}
    </span>
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
  const previewDot = Math.max(4, Math.min(24, previewWidth * 2));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <label className="text-xs font-semibold text-text-secondary" htmlFor={sliderId}>
          {label}
        </label>
        <span className="text-[0.68rem] font-semibold tabular-nums text-text-muted">
          {clampedPercent}%
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="relative flex h-8 flex-1 items-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 bg-[var(--color-border)]"
            style={{
              clipPath: "polygon(0 43%, 100% 12%, 100% 88%, 0 57%)",
              borderRadius: "999px",
            }}
          />
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={clampedPercent}
            aria-label={label}
            onChange={(event) => onChange(Number(event.target.value))}
            className="notebook-thickness-slider relative z-10 h-8 w-full cursor-pointer bg-transparent"
          />
        </div>
        <span className="inline-grid h-8 w-8 shrink-0 place-items-center">
          <span
            aria-hidden="true"
            className="rounded-full"
            style={{
              backgroundColor: color,
              width: `${previewDot}px`,
              height: `${previewDot}px`,
            }}
          />
        </span>
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
  const customActive = !presets.includes(value);
  const selectedRing =
    "ring-2 ring-[var(--color-selected-border)] ring-offset-2 ring-offset-transparent";
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-0.5">
      {presets.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${color} ${label.toLowerCase()}`}
          onClick={() => onPresetSelect(color)}
          className={`h-8 w-8 rounded-full border border-black/15 transition hover:scale-105 ${
            value === color ? selectedRing : ""
          }`}
          style={{ backgroundColor: getPresetColor(color) }}
        />
      ))}
      <label
        htmlFor={colorInputId}
        title="Custom color"
        className={`relative ml-1 grid h-8 w-8 cursor-pointer place-items-center rounded-full transition hover:scale-105 ${
          customActive ? selectedRing : ""
        }`}
        style={{
          background:
            "conic-gradient(from 180deg, #f43f5e, #fbbf24, #22c55e, #38bdf8, #818cf8, #e879f9, #f43f5e)",
        }}
      >
        <span
          aria-hidden="true"
          className="h-[0.95rem] w-[0.95rem] rounded-full border border-black/25"
          style={{ backgroundColor: customActive ? currentColor : "transparent" }}
        />
      </label>
      <input
        id={colorInputId}
        type="color"
        aria-label={`Custom ${label.toLowerCase()}`}
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
  const { user } = useUser();
  const router = useRouter();
  const params = useParams<{ notebookId?: string | string[] }>();
  const notebookId = Array.isArray(params.notebookId)
    ? params.notebookId[0]
    : params.notebookId;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [resolvedImageFileIds, setResolvedImageFileIds] = useState<
    Record<string, true>
  >({});
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [textBlocks, setTextBlocks] = useState<NotebookTextBlock[]>([]);
  const [selectedTextBlockId, setSelectedTextBlockId] = useState<string | null>(null);
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(null);
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
  const [pagePan, setPagePan] = useState<NotebookPagePan>({ x: 0, y: 0 });
  const [frameSize, setFrameSize] = useState<PageFrameSize>({ width: 0, height: 0 });
  const [toolbarDock, setToolbarDock] =
    useState<NotebookToolbarDock>("bottom");
  const [toolbarDragging, setToolbarDragging] = useState(false);
  const [toolbarSnapRevision, setToolbarSnapRevision] = useState(0);
  const [tool, setTool] = useState<EditorTool>("pen");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [loading, setLoading] = useState(true);
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<NotebookConfirmRequest | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [phoneFullEditing, setPhoneFullEditing] = useState(false);
  const [showAddPagesDialog, setShowAddPagesDialog] = useState(false);
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
  const [pageSwipeMotion, setPageSwipeMotion] =
    useState<PageSwipeMotion | null>(null);
  const [createPageActive, setCreatePageActive] = useState(false);
  const [createPageProgress, setCreatePageProgress] = useState(0);
  const [creatingPage, setCreatingPage] = useState(false);
  const [createPageBounce, setCreatePageBounce] = useState(false);
  const [inkReady, setInkReady] = useState(false);
  const [activeTextGestureId, setActiveTextGestureId] = useState<string | null>(null);
  const [touchInkHintVisible, setTouchInkHintVisible] = useState(false);
  const textBlockDragRef = useRef<TextBlockDragState | null>(null);
  const textBlockResizeRef = useRef<TextBlockResizeState | null>(null);
  const pageFrameRef = useRef<HTMLDivElement | null>(null);
  const drawingToolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarDockRef = useRef<NotebookToolbarDock>("bottom");
  const toolbarDragRef = useRef<NotebookToolbarDragState | null>(null);
  const toolbarPendingSnapRectRef = useRef<DOMRect | null>(null);
  const toolbarSnapAnimationFrameRef = useRef<number | null>(null);
  const toolbarClickResetTimerRef = useRef<number | null>(null);
  const suppressToolbarClickRef = useRef(false);
  const pageTrackRef = useRef<HTMLDivElement | null>(null);
  const pagePreviewLayerRef = useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pageTrackOffsetRef = useRef(0);
  const pageTrackPendingOffsetRef = useRef(0);
  const pageTrackAnimationFrameRef = useRef<number | null>(null);
  const pageTrackTransitionResolverRef = useRef<(() => void) | null>(null);
  const pageNavigationTokenRef = useRef(0);
  const pageNavigationLockedRef = useRef(false);
  const pageCreationInFlightRef = useRef(false);
  const pageSwipeMotionRef = useRef<PageSwipeMotion | null>(null);
  const maybeFinishPageHandoffRef = useRef<() => void>(() => undefined);
  const handoffFinishAnimationFrameRef = useRef<number | null>(null);
  const inkReadyRef = useRef(false);
  const activePageBackgroundReadyRef = useRef(true);
  const createPageActiveRef = useRef(false);
  const createPageAffordanceRef = useRef<HTMLDivElement | null>(null);
  const createPageIndicatorRef = useRef<HTMLDivElement | null>(null);
  const createPageProgressCircleRef = useRef<SVGCircleElement | null>(null);
  const pagePanLiveRef = useRef<NotebookPagePan>({ x: 0, y: 0 });
  const inkEditorRef = useRef<NotebookInkEditorHandle | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const inkUiSyncTimerRef = useRef<number | null>(null);
  const selectedPageRef = useRef<NotebookPage | null>(null);
  const textBlocksRef = useRef<NotebookTextBlock[]>([]);
  const saveStatusRef = useRef<SaveStatus>("saved");
  const inkInteractionActiveRef = useRef(false);
  const saveOperationRef = useRef<Promise<boolean> | null>(null);
  const saveCurrentPageRef = useRef<
    ((options?: { flush?: boolean }) => Promise<boolean>) | null
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
  const toolRef = useRef<EditorTool>("pen");

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
  const previousPage = pages[selectedPageIndex - 1] ?? null;
  const nextPage = pages[selectedPageIndex + 1] ?? null;
  const frozenHandoffPage =
    pageSwipeMotion?.phase === "handoff" ? pageSwipeMotion.targetPage : null;
  const settlingCreatePreview =
    pageSwipeMotion?.kind === "create" &&
    pageSwipeMotion.phase !== "handoff";
  const trackPreviousPage = frozenHandoffPage
    ? pageSwipeMotion?.direction === "previous"
      ? frozenHandoffPage
      : null
    : previousPage;
  const trackNextPage = frozenHandoffPage
    ? pageSwipeMotion?.direction === "next"
      ? frozenHandoffPage
      : null
    : settlingCreatePreview
      ? null
      : nextPage;
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
    if (!backgroundFileId) return null;
    return files.find((file) => file.id === backgroundFileId) ?? null;
  }, [
    files,
    hasMappedBackgroundPages,
    notebook?.uploadedFileId,
    selectedPage?.backgroundFileId,
  ]);
  const activeNotebookFileUrl = activeNotebookFile ? fileUrls[activeNotebookFile.id] : undefined;
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
  const pageFit = useMemo(
    () =>
      getNotebookPageFit({
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
        pageWidth: CANVAS_WIDTH,
        pageHeight: CANVAS_HEIGHT,
      }),
    [frameSize]
  );
  const pageWidthPx = pageFit.width * clampNotebookPageZoom(pageZoom);
  const pageHeightPx = pageFit.height * clampNotebookPageZoom(pageZoom);
  const pageTrackTravelDistance = pageWidthPx + NOTEBOOK_PAGE_SWIPE_GAP;

  const updatePageSwipeMotion = useCallback((next: PageSwipeMotion | null) => {
    pageSwipeMotionRef.current = next;
    setPageSwipeMotion(next);
  }, []);

  const setPagePreviewVisibility = useCallback((visible: boolean) => {
    const layer = pagePreviewLayerRef.current;
    if (layer) layer.style.visibility = visible ? "visible" : "hidden";
  }, []);

  const writePageTrackOffset = useCallback((offset: number) => {
    pageTrackOffsetRef.current = offset;
    pageTrackPendingOffsetRef.current = offset;
    const track = pageTrackRef.current;
    if (track) track.style.transform = `translate3d(${offset}px, 0, 0)`;
  }, []);

  const queuePageTrackOffset = useCallback(
    (offset: number) => {
      pageTrackOffsetRef.current = offset;
      pageTrackPendingOffsetRef.current = offset;
      if (pageTrackAnimationFrameRef.current !== null) return;
      pageTrackAnimationFrameRef.current = window.requestAnimationFrame(() => {
        pageTrackAnimationFrameRef.current = null;
        writePageTrackOffset(pageTrackPendingOffsetRef.current);
      });
    },
    [writePageTrackOffset]
  );

  const resolvePageTrackTransition = useCallback(() => {
    const resolve = pageTrackTransitionResolverRef.current;
    pageTrackTransitionResolverRef.current = null;
    resolve?.();
  }, []);

  const animatePageTrackTo = useCallback(
    (motion: PageSwipeMotion) => {
      updatePageSwipeMotion(motion);
      setPagePreviewVisibility(true);
      if (pageTrackAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(pageTrackAnimationFrameRef.current);
        pageTrackAnimationFrameRef.current = null;
      }
      const track = pageTrackRef.current;
      if (!track) {
        writePageTrackOffset(motion.targetOffset);
        return Promise.resolve();
      }
      track.style.transition = "none";
      track.style.transform = `translate3d(${pageTrackOffsetRef.current}px, 0, 0)`;
      void track.getBoundingClientRect();

      return new Promise<void>((resolve) => {
        pageTrackTransitionResolverRef.current = resolve;
        if (
          motion.durationMs <= 0 ||
          Math.abs(motion.targetOffset - pageTrackOffsetRef.current) < 0.5
        ) {
          writePageTrackOffset(motion.targetOffset);
          queueMicrotask(resolvePageTrackTransition);
          return;
        }
        track.style.transition = `transform ${motion.durationMs}ms ${NOTEBOOK_PAGE_SETTLE_EASING}`;
        writePageTrackOffset(motion.targetOffset);
      });
    },
    [
      resolvePageTrackTransition,
      setPagePreviewVisibility,
      updatePageSwipeMotion,
      writePageTrackOffset,
    ]
  );

  const handlePageTrackTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLDivElement>) => {
      if (
        event.target === event.currentTarget &&
        event.propertyName === "transform"
      ) {
        resolvePageTrackTransition();
      }
    },
    [resolvePageTrackTransition]
  );

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

  const writeCreatePageProgress = useCallback((progress: number) => {
    const next = Math.max(0, Math.min(1, progress));
    if (createPageAffordanceRef.current) {
      createPageAffordanceRef.current.style.opacity = String(
        Math.min(1, 0.2 + next * 0.8)
      );
    }
    if (createPageIndicatorRef.current) {
      createPageIndicatorRef.current.style.transform = `scale(${
        0.72 + next * 0.28
      })`;
    }
    if (createPageProgressCircleRef.current) {
      createPageProgressCircleRef.current.style.strokeDashoffset = String(
        2 * Math.PI * 20 * (1 - next)
      );
    }
  }, []);

  useEffect(() => {
    selectedPageRef.current = selectedPage;
  }, [selectedPage]);

  useEffect(() => {
    createPageActiveRef.current = createPageActive;
  }, [createPageActive]);

  // Each time the page changes, the ink editor remounts and re-deserializes the
  // SVG. Mark ink as not-yet-ready so the static ink underlay shows until the
  // editor paints, then NotebookInkEditor's onReady clears it — no blank flash.
  useEffect(() => {
    inkReadyRef.current = false;
    setInkReady(false);
  }, [selectedPage?.id]);

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
        setResolvedImageFileIds(
          Object.fromEntries(
            files
              .filter((file) => file.fileType.startsWith("image/"))
              .map((file) => [file.id, true] as const)
          )
        );
      }
    };

    if (files.length === 0) {
      setFileUrls({});
      setResolvedImageFileIds({});
      return;
    }
    void loadFileUrls();
    return () => {
      cancelled = true;
    };
  }, [files]);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    textBlocksRef.current = textBlocks;
  }, [textBlocks]);

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
  }, [pagePan]);

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

  // With js-draw as the single ink engine, switching tools only updates the
  // desired style; NotebookInkEditor defers applying it while a pointer is
  // still down, so no flush/commit step is needed.
  const switchNotebookTool = useCallback((nextTool: EditorTool) => {
    toolRef.current = nextTool;
    setTool(nextTool);
  }, []);

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
    const savedDock = readNotebookToolbarDockPreference();
    toolbarDockRef.current = savedDock;
    setToolbarDock(savedDock);
  }, []);

  useEffect(
    () => () => {
      if (toolbarSnapAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(toolbarSnapAnimationFrameRef.current);
      }
      if (toolbarClickResetTimerRef.current !== null) {
        window.clearTimeout(toolbarClickResetTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedPage) {
      setTextBlocks([]);
      setSelectedTextBlockId(null);
      setEditingTextBlockId(null);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoDepth(0);
      setRedoDepth(0);
      setInkUndoDepth(0);
      setInkRedoDepth(0);
      setInkHasContent(false);
      inkInteractionActiveRef.current = false;
      pendingInkUiRef.current = null;
      cancelInkUiSync();
      setActiveTextGestureId(null);
      hydratedPageIdRef.current = null;
      return;
    }

    if (hydratedPageIdRef.current === selectedPage.id) {
      return;
    }

    setTextBlocks(selectedPage.textBlocks);
    setSelectedTextBlockId(null);
    setEditingTextBlockId(null);
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
    cancelInkUiSync();
    setActiveTextGestureId(null);
    setPageColor(selectedPage.pageColor ?? notebook?.pageColor ?? "white");
    setPageStyle(selectedPage.pageStyle ?? notebook?.pageStyle ?? "plain");
    hydratedPageIdRef.current = selectedPage.id;
    editorRevisionRef.current = 0;
    saveStatusRef.current = "saved";
    setSaveStatus("saved");
    window.requestAnimationFrame(() => maybeFinishPageHandoffRef.current());
  }, [
    cancelInkUiSync,
    notebook?.pageColor,
    notebook?.pageStyle,
    selectedPage,
  ]);

  useEffect(() => {
    pageColorRef.current = pageColor;
    setPenColor((current) => {
      if (pageColor === "black" && current === "black") return "white";
      if (pageColor === "white" && current === "white") return "black";
      return current;
    });
  }, [pageColor]);

  useEffect(() => {
    pageStyleRef.current = pageStyle;
  }, [pageStyle]);

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
      stylusInteractionRef.current = false;
      stylusCooldownUntilRef.current = Date.now() + 180;
      touchPointersRef.current.clear();
      if (pinchZoomRef.current && pageSurfaceRef.current) {
        // A pinch was interrupted (blur/app switch): drop its live transform
        // back to the last committed pan.
        pageSurfaceRef.current.style.transform = `translate(${pagePanLiveRef.current.x}px, ${pagePanLiveRef.current.y}px)`;
        pageSurfaceRef.current.style.transformOrigin = "";
      }
      pinchZoomRef.current = null;
      setPagePan(pagePanLiveRef.current);
      if (
        pageSwipeRef.current ||
        pageSwipeMotionRef.current ||
        pageTrackOffsetRef.current !== 0
      ) {
        pageNavigationTokenRef.current += 1;
        if (pageTrackAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(pageTrackAnimationFrameRef.current);
          pageTrackAnimationFrameRef.current = null;
        }
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
      document.body.classList.remove("jami-inking-active");
    };
  }, [
    resolvePageTrackTransition,
    setPagePreviewVisibility,
    updatePageSwipeMotion,
    writePageTrackOffset,
  ]);

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
    if (pageSwipeRef.current) {
      if (pageTrackAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(pageTrackAnimationFrameRef.current);
        pageTrackAnimationFrameRef.current = null;
      }
      const track = pageTrackRef.current;
      if (track) track.style.transition = "none";
      writePageTrackOffset(0);
      setPagePreviewVisibility(false);
      createPageActiveRef.current = false;
      setCreatePageActive(false);
      setCreatePageProgress(0);
      pageSwipeRef.current = null;
    }
    const surface = pageSurfaceRef.current;
    const rect = surface?.getBoundingClientRect();
    if (!surface || !rect || rect.width <= 0 || rect.height <= 0) return;
    const centerX = (first.clientX + second.clientX) / 2;
    const centerY = (first.clientY + second.clientY) / 2;
    pinchZoomRef.current = {
      startDistance: getPinchDistance(first, second),
      startZoom: pageZoom,
      startCenterX: centerX,
      startCenterY: centerY,
      lastCenterX: centerX,
      lastCenterY: centerY,
      anchorFx: (centerX - rect.left) / rect.width,
      anchorFy: (centerY - rect.top) / rect.height,
      basePanX: pagePanLiveRef.current.x,
      basePanY: pagePanLiveRef.current.y,
      pendingZoom: pageZoom,
    };
  };

  // Ends an anchored pinch: commits the final zoom to layout and computes the
  // pan that keeps the page point that was under the fingers exactly where
  // the fingers left it, clamped to the frame.
  const finalizePinchCommit = (pinch: PinchZoomState) => {
    const frameRect = pageFrameRef.current?.getBoundingClientRect();
    const surface = pageSurfaceRef.current;
    if (!frameRect || !surface) return;
    const nextZoom = pinch.pendingZoom;
    const nextWidth = pageFit.width * nextZoom;
    const nextHeight = pageFit.height * nextZoom;
    const nextPan = getNotebookPagePanAfterPinch({
      pinchCenterX: pinch.lastCenterX,
      pinchCenterY: pinch.lastCenterY,
      frameLeft: frameRect.left,
      frameTop: frameRect.top,
      anchorFx: pinch.anchorFx,
      anchorFy: pinch.anchorFy,
      pageWidth: nextWidth,
      pageHeight: nextHeight,
      frameWidth: frameSize.width,
      frameHeight: frameSize.height,
    });
    pagePanLiveRef.current = nextPan;
    // Reset the manual gesture transform to the value React will render next;
    // React skips style writes it did not see change, so this must not be
    // left stale.
    surface.style.transformOrigin = "";
    surface.style.transform = `translate(${nextPan.x}px, ${nextPan.y}px)`;
    setPageZoom(nextZoom);
    setPagePan(nextPan);
  };

  const handleTouchPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return false;
    if (pageNavigationLockedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
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
      const nextZoom = getNotebookPageZoomAfterPinch({
        startDistance: pinch.startDistance,
        currentDistance: getPinchDistance(first, second),
        startZoom: pinch.startZoom,
      });
      pinch.pendingZoom = nextZoom;
      pinch.lastCenterX = centerX;
      pinch.lastCenterY = centerY;
      const surface = pageSurfaceRef.current;
      if (surface) {
        // Anchored live pinch: the page scales around the point the gesture
        // started on and follows the fingers as they move — one cheap GPU
        // transform per frame, no layout work until the gesture commits.
        surface.style.transformOrigin = `${pinch.anchorFx * 100}% ${pinch.anchorFy * 100}%`;
        surface.style.transform = `translate(${
          pinch.basePanX + centerX - pinch.startCenterX
        }px, ${pinch.basePanY + centerY - pinch.startCenterY}px) scale(${
          nextZoom / pinch.startZoom
        })`;
      }
    }
    pageSwipeRef.current = null;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const handleTouchPointerEnd = (
    event: ReactPointerEvent<HTMLElement>,
    options: { allowTextTap?: boolean; cancelled?: boolean } = {}
  ) => {
    if (event.pointerType !== "touch") return false;
    const wasPinching = Boolean(pinchZoomRef.current) || touchPointersRef.current.size >= 2;
    touchPointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wasPinching) {
      const pinch = pinchZoomRef.current;
      if (pinch) {
        finalizePinchCommit(pinch);
      }
      pinchZoomRef.current = null;
      pageSwipeRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    handleStopPageSwipe(event, options);
    return true;
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
    // The text tool places exactly one box per activation: hand control back
    // to the select tool so tapping elsewhere deselects instead of dropping
    // another box.
    switchNotebookTool("select");
  };

  useEffect(() => {
    const surface = pageSurfaceRef.current;
    if (!surface || !selectedPage?.id || typeof window === "undefined") return;

    // iPadOS Safari hijacks horizontal Apple Pencil movement for a native
    // scroll/back gesture even when `touch-action: none` is set — it fires a
    // pointercancel mid-stroke and then needs a frame to settle before the next
    // pointerdown is delivered, which is why a stroke right after a horizontal
    // one fails to register. touch-action is not honored for the Pencil here,
    // but suppressing the underlying touch-event default is. We only cancel for
    // stylus input (or while ink is being drawn) and never over a text editor,
    // so finger scroll/zoom/swipe (all JS-driven) are untouched.
    const isStylusTouchEvent = (event: TouchEvent) => {
      const touches = event.touches.length > 0 ? event.touches : event.changedTouches;
      for (let index = 0; index < touches.length; index += 1) {
        if ((touches[index] as Touch & { touchType?: string }).touchType === "stylus") {
          return true;
        }
      }
      return false;
    };
    const suppressStylusGesture: EventListener = (event) => {
      if (!(event instanceof TouchEvent) || !event.cancelable) return;
      if (isNotebookTextEditingTarget(event.target)) return;
      if (inkInteractionActiveRef.current || isStylusTouchEvent(event)) {
        event.preventDefault();
      }
    };

    const listenerOptions = { passive: false, capture: true };
    surface.addEventListener("touchstart", suppressStylusGesture, listenerOptions);
    surface.addEventListener("touchmove", suppressStylusGesture, listenerOptions);

    return () => {
      surface.removeEventListener("touchstart", suppressStylusGesture, listenerOptions);
      surface.removeEventListener("touchmove", suppressStylusGesture, listenerOptions);
    };
  }, [selectedPage?.id]);

  const savePageSnapshot = useCallback(
    async (input: {
      page: NotebookPage;
      textBlocks: NotebookTextBlock[];
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
      options: { flush?: boolean } = {}
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
      if (inkEditorRef.current?.isInteracting() || inkInteractionActiveRef.current) {
        return false;
      }

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
          inkSvg,
          hasInk: inkEditorRef.current?.hasInk() ?? false,
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
    [savePageSnapshot, selectedPageInkSvg, user?.uid]
  );

  useEffect(() => {
    saveCurrentPageRef.current = saveCurrentPage;
    return () => {
      if (saveCurrentPageRef.current === saveCurrentPage) {
        saveCurrentPageRef.current = null;
      }
    };
  }, [saveCurrentPage]);

  const prepareCurrentPageForNavigation = useCallback(async () => {
    if (inkEditorRef.current?.isInteracting() || inkInteractionActiveRef.current) {
      return false;
    }
    if (
      saveOperationRef.current ||
      saveStatusRef.current === "saving" ||
      saveStatusRef.current === "unsaved" ||
      saveStatusRef.current === "failed"
    ) {
      return saveCurrentPage({ flush: true });
    }
    return true;
  }, [saveCurrentPage]);

  const selectPageById = useCallback(
    async (pageId: string) => {
      if (pageId === selectedPageRef.current?.id) return true;
      if (pageNavigationLockedRef.current) return false;
      const ready = await prepareCurrentPageForNavigation();
      if (!ready) return false;
      setSelectedPageId(pageId);
      return true;
    },
    [prepareCurrentPageForNavigation]
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
      if (pageTrackAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(pageTrackAnimationFrameRef.current);
        pageTrackAnimationFrameRef.current = null;
      }
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
      resolvePageTrackTransition,
      setPagePreviewVisibility,
      updatePageSwipeMotion,
      writePageTrackOffset,
    ]
  );

  useEffect(() => {
    if (pinchZoomRef.current) {
      const surface = pageSurfaceRef.current;
      if (surface) {
        surface.style.transformOrigin = "";
        surface.style.transform = `translate(${pagePanLiveRef.current.x}px, ${pagePanLiveRef.current.y}px)`;
      }
      pinchZoomRef.current = null;
      touchPointersRef.current.clear();
      setPagePan(pagePanLiveRef.current);
    }
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
    clearPageTrackMotion,
    frameSize.height,
    frameSize.width,
    pageTrackTravelDistance,
    updatePageSwipeMotion,
    writePageTrackOffset,
  ]);

  const maybeFinishPageHandoff = useCallback(() => {
    const motion = pageSwipeMotionRef.current;
    if (
      motion?.phase !== "handoff" ||
      !motion.targetPage ||
      selectedPageRef.current?.id !== motion.targetPage.id ||
      hydratedPageIdRef.current !== motion.targetPage.id ||
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
        currentMotion.targetPage.id !== selectedPageRef.current?.id ||
        hydratedPageIdRef.current !== currentMotion.targetPage.id ||
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
      resolvePageBackground,
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
      setPagePreviewVisibility(true);
      return runPageTrackNavigation(
        targetPage,
        direction,
        direction === "next" ? -2 : 2
      );
    },
    [
      pages,
      runPageTrackNavigation,
      selectedPageIndex,
      setPagePreviewVisibility,
    ]
  );

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
  }, [saveCurrentPage]);

  const handleExitNotebook = async (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (
      saveStatusRef.current === "unsaved" ||
      saveStatusRef.current === "failed"
    ) {
      const saved = await saveCurrentPage({ flush: true });
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
      completed: false,
    };
    safelySetPointerCapture(event.currentTarget, event.pointerId);
  };

  const handlePageSwipeMove = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId || swipe.completed) return;

    const deltaX = event.clientX - swipe.lastX;
    const deltaY = event.clientY - swipe.lastY;
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

    // While zoomed in, one finger pans the page freely in both directions.
    // Page swipes only come back once the page is zoomed out to fit.
    if (pageZoom > 1.02) {
      const nextPan = clampNotebookPagePan({
        pan: {
          x: pagePanLiveRef.current.x + deltaX,
          y: pagePanLiveRef.current.y + deltaY,
        },
        pageWidth: pageWidthPx,
        pageHeight: pageHeightPx,
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
      });
      pagePanLiveRef.current = nextPan;
      const surface = pageSurfaceRef.current;
      if (surface) {
        surface.style.transform = `translate(${nextPan.x}px, ${nextPan.y}px)`;
      }
      event.preventDefault();
      return;
    }

    const totalDx = swipe.currentX - swipe.startX;
    const totalDy = swipe.currentY - swipe.startY;
    if (swipe.axis === null && Math.max(Math.abs(totalDx), Math.abs(totalDy)) >= 8) {
      if (Math.abs(totalDx) > Math.abs(totalDy) * 1.05) {
        swipe.axis = "horizontal";
        setPagePreviewVisibility(true);
      } else if (Math.abs(totalDy) > Math.abs(totalDx) * 1.15) {
        swipe.axis = "vertical";
      }
    }

    // At fit zoom the whole page is already visible; a vertically-dominant
    // drag is neither a pan nor a page swipe.
    if (swipe.axis === "vertical") {
      event.preventDefault();
      return;
    }

    if (swipe.axis !== "horizontal") return;

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

    // A zoomed-in drag was a pan: commit its final position to state.
    if (pageZoom > 1.02) {
      setPagePan(pagePanLiveRef.current);
      if (
        !options.cancelled &&
        Math.abs(deltaX) <= 8 &&
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
      swipe.axis === "horizontal" ||
      (swipe.axis === null &&
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
    if (pageNavigationLockedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    setPenMenuOpen(false);
    setHighlighterMenuOpen(false);
    setEraserMenuOpen(false);
    setSelectedTextBlockId(null);
    setEditingTextBlockId(null);
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
    if (!fullNotebookEditingEnabled || pageNavigationLockedRef.current) return;
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
      wasSelected: selectedTextBlockId === block.id,
    };
    pageSwipeRef.current = null;
    pinchZoomRef.current = null;
    setActiveTextGestureId(block.id);
    setSelectedTextBlockId(block.id);
    setEditingTextBlockId(null);
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
      // Tap-again-to-type: a motionless release on an already-selected block
      // opens the text editor, so no separate edit button is needed.
      const movedX = Math.abs(event.clientX - drag.startX);
      const movedY = Math.abs(event.clientY - drag.startY);
      if (
        drag.wasSelected &&
        event.type === "pointerup" &&
        movedX < 6 &&
        movedY < 6
      ) {
        setEditingTextBlockId(drag.id);
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
    if (!fullNotebookEditingEnabled || pageNavigationLockedRef.current) return;
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

  const handleDeletePage = async (page: NotebookPage) => {
    if (!user?.uid || !notebook || !fullNotebookEditingEnabled) return;
    if (pages.length <= 1) {
      setFeedback({ type: "error", message: "A notebook needs at least one page." });
      return;
    }

    if (
      saveStatusRef.current === "unsaved" ||
      saveStatusRef.current === "failed"
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
  const handleUndo = useCallback(() => {
    if ((inkEditorRef.current?.getHistoryState().undoDepth ?? 0) > 0) {
      inkEditorRef.current?.undo();
      return;
    }
    const action = undoStackRef.current.at(-1);
    if (!action) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-39), action];
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);

    textBlocksRef.current = action.previous;
    setTextBlocks(action.previous);
    setSelectedTextBlockId(null);
    setEditingTextBlockId(null);
    setActiveTextGestureId(null);
    markPageUnsaved();
  }, [markPageUnsaved]);

  const handleRedo = useCallback(() => {
    if ((inkEditorRef.current?.getHistoryState().redoDepth ?? 0) > 0) {
      inkEditorRef.current?.redo();
      return;
    }
    const action = redoStackRef.current.at(-1);
    if (!action) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-39), action];
    setRedoDepth(redoStackRef.current.length);
    setUndoDepth(undoStackRef.current.length);

    textBlocksRef.current = action.next;
    setTextBlocks(action.next);
    setSelectedTextBlockId(null);
    setEditingTextBlockId(null);
    setActiveTextGestureId(null);
    markPageUnsaved();
  }, [markPageUnsaved]);

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
        switchNotebookTool(toolRef.current === "text" ? "select" : "text");
      }
      if (key === "p") {
        switchNotebookTool(toolRef.current === "pen" ? "select" : "pen");
      }
      if (key === "h") {
        switchNotebookTool(
          toolRef.current === "highlighter" ? "select" : "highlighter"
        );
      }
      if (key === "e") {
        switchNotebookTool(
          toolRef.current === "eraser" ? "select" : "eraser"
        );
      }
      if (key === "escape") {
        switchNotebookTool("select");
        setPenMenuOpen(false);
        setHighlighterMenuOpen(false);
        setEraserMenuOpen(false);
        setSelectedTextBlockId(null);
        setEditingTextBlockId(null);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    fullNotebookEditingEnabled,
    handleRedo,
    handleUndo,
    switchNotebookTool,
  ]);

  const closeDrawingToolMenus = useCallback(() => {
    setPenMenuOpen(false);
    setHighlighterMenuOpen(false);
    setEraserMenuOpen(false);
  }, []);

  const requestToolbarDockSnap = useCallback(
    (dock: NotebookToolbarDock, persist: boolean) => {
      const toolbar = drawingToolbarRef.current;
      if (toolbar) {
        toolbarPendingSnapRectRef.current = toolbar.getBoundingClientRect();
      }
      toolbarDockRef.current = dock;
      setToolbarDock(dock);
      setToolbarSnapRevision((revision) => revision + 1);
      if (persist) {
        saveNotebookToolbarDockPreference(dock);
      }
    },
    []
  );

  useLayoutEffect(() => {
    const toolbar = drawingToolbarRef.current;
    const draggedRect = toolbarPendingSnapRectRef.current;
    if (!toolbar || !draggedRect) return;

    toolbarPendingSnapRectRef.current = null;
    if (toolbarSnapAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(toolbarSnapAnimationFrameRef.current);
      toolbarSnapAnimationFrameRef.current = null;
    }

    toolbar.style.transition = "none";
    toolbar.style.translate = "none";
    const dockedRect = toolbar.getBoundingClientRect();
    const deltaX =
      draggedRect.left +
      draggedRect.width / 2 -
      (dockedRect.left + dockedRect.width / 2);
    const deltaY =
      draggedRect.top +
      draggedRect.height / 2 -
      (dockedRect.top + dockedRect.height / 2);

    if (prefersReducedNotebookMotion()) {
      toolbar.style.translate = "none";
      toolbar.style.transition = "";
      return;
    }

    toolbar.style.translate = `${deltaX}px ${deltaY}px`;
    void toolbar.offsetWidth;
    toolbarSnapAnimationFrameRef.current = window.requestAnimationFrame(() => {
      toolbarSnapAnimationFrameRef.current = null;
      toolbar.style.transition = `translate 200ms ${NOTEBOOK_TOOLBAR_SETTLE_EASING}`;
      toolbar.style.translate = "0px 0px";
    });
  }, [
    prefersReducedNotebookMotion,
    toolbarDock,
    toolbarSnapRevision,
  ]);

  const handleToolbarPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0) ||
      toolbarDragRef.current
    ) {
      return;
    }

    const frame = pageFrameRef.current;
    const toolbar = drawingToolbarRef.current;
    if (!frame || !toolbar) return;

    const frameRect = frame.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    toolbarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      originLeft: toolbarRect.left - frameRect.left,
      originTop: toolbarRect.top - frameRect.top,
      toolbarWidth: toolbarRect.width,
      toolbarHeight: toolbarRect.height,
      frameWidth: frameRect.width,
      frameHeight: frameRect.height,
      originDock: toolbarDockRef.current,
      started: false,
    };
    toolbar.style.transition = "none";
    safelySetPointerCapture(toolbar, event.pointerId);
  };

  const handleToolbarPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const drag = toolbarDragRef.current;
    const toolbar = drawingToolbarRef.current;
    if (!drag || !toolbar || drag.pointerId !== event.pointerId) return;

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (
      !drag.started &&
      !hasNotebookToolbarDragStarted({ deltaX, deltaY })
    ) {
      return;
    }

    if (!drag.started) {
      drag.started = true;
      setToolbarDragging(true);
      closeDrawingToolMenus();
      clearNotebookNativeSelection(document);
    }

    event.preventDefault();
    event.stopPropagation();
    const offset = clampNotebookToolbarDragOffset({
      deltaX,
      deltaY,
      originLeft: drag.originLeft,
      originTop: drag.originTop,
      toolbarWidth: drag.toolbarWidth,
      toolbarHeight: drag.toolbarHeight,
      frameWidth: drag.frameWidth,
      frameHeight: drag.frameHeight,
    });
    toolbar.style.translate = `${offset.x}px ${offset.y}px`;
  };

  const finishToolbarPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => {
    const drag = toolbarDragRef.current;
    const toolbar = drawingToolbarRef.current;
    if (!drag || !toolbar || drag.pointerId !== event.pointerId) return;

    toolbarDragRef.current = null;
    safelyReleasePointerCapture(toolbar, event.pointerId);
    if (!drag.started) {
      toolbar.style.transition = "";
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setToolbarDragging(false);
    suppressToolbarClickRef.current = true;
    if (toolbarClickResetTimerRef.current !== null) {
      window.clearTimeout(toolbarClickResetTimerRef.current);
    }
    toolbarClickResetTimerRef.current = window.setTimeout(() => {
      suppressToolbarClickRef.current = false;
      toolbarClickResetTimerRef.current = null;
    }, 0);

    const frame = pageFrameRef.current?.getBoundingClientRect();
    const nextDock =
      cancelled || !frame
        ? drag.originDock
        : getNearestNotebookToolbarDock({
            x: drag.lastX - frame.left,
            y: drag.lastY - frame.top,
            frameWidth: frame.width,
            frameHeight: frame.height,
            currentDock: drag.originDock,
          });
    requestToolbarDockSnap(nextDock, !cancelled);
  };

  const handleToolbarClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressToolbarClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressToolbarClickRef.current = false;
  };

  const handleToolbarTransitionEnd = (
    event: ReactTransitionEvent<HTMLDivElement>
  ) => {
    if (
      event.currentTarget !== event.target ||
      event.propertyName !== "translate"
    ) {
      return;
    }
    event.currentTarget.style.transition = "";
    event.currentTarget.style.translate = "none";
  };

  useEffect(() => {
    const drag = toolbarDragRef.current;
    if (!drag?.started) return;

    toolbarDragRef.current = null;
    setToolbarDragging(false);
    suppressToolbarClickRef.current = true;
    requestToolbarDockSnap(drag.originDock, false);
  }, [
    frameSize.height,
    frameSize.width,
    requestToolbarDockSnap,
  ]);

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
      className="notebook-editor-shell fixed inset-x-0 top-0 z-[70] flex h-[100dvh] min-w-0 flex-col overflow-hidden bg-[var(--color-surface-base)] text-text-primary"
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
                setPagesDrawerOpen((value) => !value);
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
          </div>
        </header>
        <div className="relative min-h-0 flex-1 overflow-hidden">
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
                    getPresetColor={(color) => PEN_COLOR_HEX[color as NotebookPenColor]}
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
                      HIGHLIGHTER_COLOR_HEX[color as NotebookHighlighterColor]
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
                      {(["small", "medium", "large"] as EraserWidth[]).map((width) => (
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

        {aiPlaceholderOpen ? (
          <aside className="notebook-drawer-in-right notebook-drawer-surface absolute bottom-0 right-0 top-0 z-50 flex w-full max-w-sm flex-col border-l border-[var(--color-border)] p-4 shadow-[-20px_0_44px_rgba(0,0,0,0.22)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--color-selected-border)]/40 bg-[var(--color-selected-bg)] text-[var(--color-selected-text)]">
                  <NotebookIcon name="ai" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-text-primary">Jami Tutor</div>
                  <div className="text-xs text-text-muted">Coming soon</div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close Jami Tutor"
                title="Close Jami Tutor"
                className="app-chip inline-grid h-9 w-9 shrink-0 place-items-center rounded-full"
                onClick={() => setAiPlaceholderOpen(false)}
              >
                <NotebookIcon name="close" />
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-text-secondary">
              Tutor will be able to look at this notebook page and help when you
              ask. Nothing from your pages is sent anywhere yet.
            </p>
          </aside>
        ) : null}

        {pagesDrawerOpen ? (
          <aside className="notebook-drawer-in notebook-drawer-surface absolute bottom-0 left-0 top-0 z-50 flex min-h-0 w-64 flex-col border-r border-[var(--color-border)] p-3 shadow-[18px_0_42px_rgba(0,0,0,0.2)]">
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
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pr-1">
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

          <div
            ref={pageFrameRef}
            data-notebook-page-frame
            className="absolute inset-0 overflow-hidden"
          >
            {selectedPage?.questionPrompt ? (
              <div
                className={`absolute left-1/2 z-20 w-[min(92vw,36rem)] -translate-x-1/2 ${
                  toolbarDock === "top" ? "top-[5rem]" : "top-3"
                }`}
              >
                <Card tone="warm" padding="sm">
                  <p className="text-sm leading-6 text-text-primary">{selectedPage.questionPrompt}</p>
                </Card>
              </div>
            ) : null}
            {selectedPage && pageFit.width > 0 ? (
              <>
                <div
                  ref={pageTrackRef}
                  className="notebook-page-track absolute inset-0"
                  onTransitionEnd={handlePageTrackTransitionEnd}
                  onTransitionCancel={handlePageTrackTransitionEnd}
                >
                  <div
                    ref={pagePreviewLayerRef}
                    aria-hidden="true"
                    className="invisible pointer-events-none absolute inset-0"
                  >
                    {trackPreviousPage ? (
                      <div
                        className={`notebook-page-swipe-preview absolute left-0 top-0 overflow-hidden ${NOTEBOOK_PAGE_SHEET_CLASS} ${
                          PAGE_COLOR_CLASS[
                            trackPreviousPage.pageColor ??
                              notebook?.pageColor ??
                              "white"
                          ]
                        }`}
                        style={{
                          width: `${pageWidthPx}px`,
                          height: `${pageHeightPx}px`,
                          transform: `translate(${
                            pagePan.x - pageTrackTravelDistance
                          }px, ${pagePan.y}px)`,
                        }}
                      >
                        <NotebookPageStaticContent
                          page={trackPreviousPage}
                          notebook={notebook}
                          backgroundFile={trackPreviousBackground.file}
                          backgroundUrl={trackPreviousBackground.url}
                        />
                      </div>
                    ) : null}
                    {trackNextPage ? (
                      <div
                        className={`notebook-page-swipe-preview absolute left-0 top-0 overflow-hidden ${NOTEBOOK_PAGE_SHEET_CLASS} ${
                          PAGE_COLOR_CLASS[
                            trackNextPage.pageColor ??
                              notebook?.pageColor ??
                              "white"
                          ]
                        }`}
                        style={{
                          width: `${pageWidthPx}px`,
                          height: `${pageHeightPx}px`,
                          transform: `translate(${
                            pagePan.x + pageTrackTravelDistance
                          }px, ${pagePan.y}px)`,
                        }}
                      >
                        <NotebookPageStaticContent
                          page={trackNextPage}
                          notebook={notebook}
                          backgroundFile={trackNextBackground.file}
                          backgroundUrl={trackNextBackground.url}
                        />
                      </div>
                    ) : null}
                    {!trackNextPage &&
                    (createPageActive ||
                      creatingPage ||
                      pageSwipeMotion?.kind === "create" ||
                      (fullNotebookEditingEnabled &&
                        selectedPageIndex === pages.length - 1)) ? (
                      <div
                        className={`notebook-page-swipe-preview absolute left-0 top-0 overflow-hidden ${NOTEBOOK_PAGE_SHEET_CLASS} ${PAGE_COLOR_CLASS[pageColor]}`}
                        style={{
                          width: `${pageWidthPx}px`,
                          height: `${pageHeightPx}px`,
                          transform: `translate(${
                            pagePan.x + pageTrackTravelDistance
                          }px, ${pagePan.y}px)`,
                        }}
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-0"
                          style={getPageStyleBackground(pageColor, pageStyle)}
                        />
                      </div>
                    ) : null}
                  </div>
                <div
                  ref={pageSurfaceRef}
                  data-notebook-page-surface
                  className={`notebook-page-surface absolute left-0 top-0 overflow-hidden ${NOTEBOOK_PAGE_SHEET_CLASS} ${PAGE_COLOR_CLASS[pageColor]}`}
                  onPointerMove={handlePageSurfaceTextGestureMove}
                  onPointerUp={handlePageSurfaceTextGestureStop}
                  onPointerCancel={handlePageSurfaceTextGestureStop}
                  style={{
                    width: `${pageWidthPx}px`,
                    height: `${pageHeightPx}px`,
                    transform: `translate(${pagePan.x}px, ${pagePan.y}px)`,
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
                          <Image
                            key={`${selectedPage.id}:${activeNotebookFile.id}:image`}
                            alt=""
                            aria-hidden="true"
                            src={activeNotebookFileUrl}
                            fill
                            unoptimized
                            sizes="48rem"
                            className="object-contain"
                            onLoad={markActivePageBackgroundSettled}
                            onError={markActivePageBackgroundSettled}
                          />
                        ) : (
                          <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-1 text-xs font-semibold text-text-secondary">
                            Loading file...
                          </div>
                        )
                      ) : activeNotebookFile.fileType === "application/pdf" &&
                        activeNotebookFile.storagePath ? (
                          <NotebookPdfPage
                            key={`${selectedPage.id}:${activeNotebookFile.id}:${
                              selectedPage.pdfPageIndex ?? 0
                            }`}
                            aria-label={`Notebook file: ${activeNotebookFile.fileName}, page ${
                              (selectedPage.pdfPageIndex ?? 0) + 1
                            }`}
                            storagePath={activeNotebookFile.storagePath}
                            pageIndex={selectedPage.pdfPageIndex ?? 0}
                            fadeIn={pageSwipeMotion?.phase !== "handoff"}
                            onRenderStateChange={handleActivePdfRenderStateChange}
                            className="absolute inset-0"
                          />
                      ) : (
                        null
                      )}
                    </div>
                  ) : null}
                  {!inkReady &&
                  (selectedPage.inkData?.svg ||
                    (selectedPage.strokeData?.strokes?.length ?? 0) > 0) ? (
                    <Image
                      alt=""
                      aria-hidden="true"
                      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(
                        selectedPageInkSvg
                      )}`}
                      fill
                      unoptimized
                      sizes="48rem"
                      className="pointer-events-none absolute inset-0 z-[12] object-fill"
                    />
                  ) : null}
                  <NotebookInkEditor
                    ref={inkEditorRef}
                    key={selectedPage.id}
                    pageId={selectedPage.id}
                    pageWidth={CANVAS_WIDTH}
                    pageHeight={CANVAS_HEIGHT}
                    initialSvg={selectedPageInkSvg}
                    onReady={() => {
                      inkReadyRef.current = true;
                      setInkReady(true);
                      window.requestAnimationFrame(() =>
                        maybeFinishPageHandoffRef.current()
                      );
                    }}
                    onReadyError={() => {
                      inkReadyRef.current = true;
                      setFeedback({
                        type: "error",
                        message:
                          "This page opened, but the ink editor could not start. Your saved writing is still visible.",
                      });
                      window.requestAnimationFrame(() =>
                        maybeFinishPageHandoffRef.current()
                      );
                    }}
                    activeTool={tool}
                    eraserMode={eraserMode}
                    penColor={penColor}
                    penThickness={getPenWidthFromPercent(penThicknessPercent)}
                    highlighterColor={highlighterColor}
                    highlighterThickness={getHighlighterWidthFromPercent(
                      highlighterThicknessPercent
                    )}
                    eraserThickness={ERASER_WIDTH_VALUE[eraserWidth]}
                    readOnly={
                      !fullNotebookEditingEnabled || Boolean(pageSwipeMotion)
                    }
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
                      document.body.classList.toggle("jami-inking-active", active);
                      if (active) {
                        setPenMenuOpen(false);
                        setHighlighterMenuOpen(false);
                        setEraserMenuOpen(false);
                        setPagesDrawerOpen(false);
                        setSelectedTextBlockId(null);
                        setEditingTextBlockId(null);
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
                  <div className="pointer-events-none absolute inset-0 z-30">
                    {textBlocks.map((block) => {
                      const selected = selectedTextBlockId === block.id;
                      const editing = editingTextBlockId === block.id;
                      const gesturing = activeTextGestureId === block.id;
                      const displayText = block.text.trim() ? block.text : selected ? "Tap again to type" : "";
                      const frameBorderClass =
                        pageColor === "black" ? "border-white/55" : "border-slate-950/40";
                      return (
                        <div
                          key={block.id}
                          className={`notebook-text-object pointer-events-auto absolute rounded-[0.45rem] border bg-transparent transition ${
                            editing
                              ? `cursor-text ${frameBorderClass} shadow-[0_2px_12px_rgba(0,0,0,0.12)]`
                              : selected
                                ? `cursor-grab touch-none select-none ${frameBorderClass} active:cursor-grabbing`
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
                              handleTouchPointerEnd(event, { cancelled: true });
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
                              <div className="absolute right-1.5 top-1.5 z-20 rounded-[0.55rem] border border-black/15 bg-black/60 p-0.5 shadow-sm backdrop-blur-sm">
                                <button
                                  type="button"
                                  aria-label="Delete text block"
                                  title="Delete text block"
                                  className="inline-grid h-6 w-6 place-items-center rounded-[0.4rem] text-[#f8fafc] transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f8fafc] [&_svg]:h-3.5 [&_svg]:w-3.5"
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
                              autoFocus
                              onPointerDown={(event) => event.stopPropagation()}
                              onPointerMove={(event) => event.stopPropagation()}
                              onPointerUp={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.stopPropagation();
                                  setEditingTextBlockId(null);
                                }
                              }}
                              onFocus={() => setSelectedTextBlockId(block.id)}
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
                </div>
                </div>
              </>
            ) : null}
          </div>
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
                data-toolbar-dragging={toolbarDragging ? "true" : "false"}
                onPointerDown={handleToolbarPointerDown}
                onPointerMove={handleToolbarPointerMove}
                onPointerUp={(event) => finishToolbarPointer(event, false)}
                onPointerCancel={(event) => finishToolbarPointer(event, true)}
                onLostPointerCapture={(event) =>
                  finishToolbarPointer(event, true)
                }
                onClickCapture={handleToolbarClickCapture}
                onTransitionEnd={handleToolbarTransitionEnd}
                onDragStart={(event) => event.preventDefault()}
                className={`notebook-dockable-toolbar notebook-floating-control absolute z-40 flex items-center gap-1 rounded-full border border-[var(--color-border)] p-1.5 ${
                  isNotebookToolbarSideDock(toolbarDock)
                    ? "flex-col"
                    : "flex-row"
                } ${
                  toolbarDragging
                    ? "cursor-grabbing border-[var(--color-border-strong)]"
                    : "cursor-grab"
                } ${NOTEBOOK_TOOLBAR_DOCK_CLASS[toolbarDock]}`}
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
                      style={{ backgroundColor: getNotebookStrokePaintColor(penColor, "pen") }}
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
                    switchNotebookTool(toolRef.current === "text" ? "select" : "text");
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
                  disabled={undoDepth === 0 && inkUndoDepth === 0}
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
                  disabled={redoDepth === 0 && inkRedoDepth === 0}
                  onClick={() => {
                    setPenMenuOpen(false);
                    setHighlighterMenuOpen(false);
                    setEraserMenuOpen(false);
                    handleRedo();
                  }}
                />
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
