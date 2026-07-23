import { normalizeTimedInkPoint } from "@/lib/workspace/notebook-ink-engine";
import {
  buildTypedContentFromTextBlocks,
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  normalizeNotebookStrokeColor,
  type NotebookHighlighterColor,
  type NotebookPage,
  type NotebookPageColor,
  type NotebookPageStatus,
  type NotebookPageStyle,
  type NotebookPenColor,
  type NotebookStroke,
  type NotebookStrokeColor,
  type NotebookStrokePoint,
  type NotebookStrokeTool,
  type NotebookTextBlock,
} from "@/lib/workspace/notebooks";
import type { NotebookPageDraft } from "@/lib/workspace/notebook-drafts";

const PAGE_COLOR_HEX: Record<NotebookPageColor, string> = {
  white: "#ffffff",
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

function isNotebookStrokePoint(value: unknown): value is NotebookStrokePoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
  );
}

export function applyNotebookDraftToPage(
  page: NotebookPage,
  draft: NotebookPageDraft
): NotebookPage {
  return {
    ...page,
    typedContent: buildTypedContentFromTextBlocks(draft.textBlocks),
    textBlocks: draft.textBlocks,
    inkData: {
      version: 2,
      format: "js-draw-svg",
      svg: draft.inkSvg,
    },
    strokeData: undefined,
    pageColor: draft.pageColor,
    pageStyle: draft.pageStyle,
    status: draft.status,
  };
}

export function normalizeNotebookStrokes(value: unknown): NotebookStroke[] {
  if (!Array.isArray(value)) return [];

  const strokes: NotebookStroke[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const points = (entry as { points?: unknown }).points;
    if (!Array.isArray(points)) continue;
    const cleanPoints = points
      .filter(isNotebookStrokePoint)
      .map((point) => normalizeTimedInkPoint(point))
      .slice(0, 1_200);
    if (cleanPoints.length === 0) continue;

    const stroke = entry as Record<string, unknown>;
    const tool: NotebookStrokeTool =
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

  return strokes;
}

export function makeNotebookTextBlockId() {
  return `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getNotebookTextBlockOptionsElementId(
  blockId: string,
  element: "menu" | "trigger"
) {
  return `notebook-text-box-options-${encodeURIComponent(blockId)}-${element}`;
}

export function clampNotebookTextBlock(
  block: NotebookTextBlock
): NotebookTextBlock {
  const width = Math.max(
    120,
    Math.min(NOTEBOOK_PAGE_COORDINATE_WIDTH, Math.round(block.width))
  );
  const height = Math.max(
    48,
    Math.min(NOTEBOOK_PAGE_COORDINATE_HEIGHT, Math.round(block.height))
  );
  return {
    ...block,
    width,
    height,
    x: Math.max(
      0,
      Math.min(NOTEBOOK_PAGE_COORDINATE_WIDTH - width, Math.round(block.x))
    ),
    y: Math.max(
      0,
      Math.min(NOTEBOOK_PAGE_COORDINATE_HEIGHT - height, Math.round(block.y))
    ),
  };
}

export function getNotebookStrokePaintColor(
  color: NotebookStrokeColor,
  tool: NotebookStrokeTool
) {
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

export function getNotebookStrokePaintColorForPage(
  stroke: NotebookStroke,
  pageColor: NotebookPageColor
) {
  if (stroke.tool === "eraser") return PAGE_COLOR_HEX[pageColor];
  return getNotebookStrokePaintColor(stroke.color, stroke.tool);
}

export function getNotebookPageStyleBackground(
  pageColor: NotebookPageColor,
  style: NotebookPageStyle
) {
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

export function buildNotebookThumbnailPoints(
  points: readonly NotebookStrokePoint[]
) {
  return points
    .slice(0, 80)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

export function getNotebookWorkingPageStatus(input: {
  typedContent: string;
  hasInk: boolean;
}): NotebookPageStatus {
  return input.typedContent.trim() || input.hasInk ? "working" : "blank";
}
