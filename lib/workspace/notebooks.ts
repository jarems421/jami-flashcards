import {
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/practice/content";
import { normalizeInkPressure, normalizeInkTime } from "@/lib/workspace/notebook-ink-engine";
import type { NotebookStrokeTool } from "@/lib/workspace/notebook-ink-types";

export type { NotebookStrokeTool } from "@/lib/workspace/notebook-ink-types";

export type NotebookType =
  | "blank"
  | "uploaded_file"
  | "ai_questions"
  | "general_working"
  | "free_working"
  | "practice"
  | "past_paper"
  | "generated_drill"
  | "source_notes";

export type NotebookPageType =
  | "blank"
  | "question"
  | "past_paper_page"
  | "source_note"
  | "free_working";

export type NotebookStrokeData = {
  version: number;
  strokes: NotebookStroke[];
};

export type NotebookInkData = {
  version: 2;
  format: "js-draw-svg";
  svg: string;
};

export type NotebookPenColor = "black" | "white" | "red" | "green";
export type NotebookHighlighterColor = "yellow" | "green" | "pink";
export type NotebookCustomStrokeColor = `#${string}`;
export type NotebookStrokeColor =
  | NotebookPenColor
  | NotebookHighlighterColor
  | NotebookCustomStrokeColor;
export type NotebookPageColor = "white" | "black";
export type NotebookPageStyle = "plain" | "lined" | "grid" | "dot";
export type NotebookPageStatus = "blank" | "working" | "needs_review" | "marked";

export type NotebookStrokePoint = {
  x: number;
  y: number;
  pressure?: number;
  time?: number;
};

export type NotebookStroke = {
  points: NotebookStrokePoint[];
  color: NotebookStrokeColor;
  width: number;
  tool: NotebookStrokeTool;
};

export type NotebookImageRef = {
  id: string;
  storagePath?: string;
  localPreviewUrl?: string;
  width?: number;
  height?: number;
};

export type NotebookTextBlock = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  outlineVisible: boolean;
};

export type Notebook = {
  id: string;
  folderId: string;
  title: string;
  type: NotebookType;
  topicIds: string[];
  sourceIds: string[];
  practiceSetId?: string;
  pastPaperId?: string;
  color?: string;
  icon?: string;
  pageColor: NotebookPageColor;
  pageStyle: NotebookPageStyle;
  uploadedFileId?: string;
  previewInkSvg?: string;
  previewPageId?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

export type NotebookPage = {
  id: string;
  notebookId: string;
  folderId: string;
  pageNumber: number;
  title?: string;
  pageType: NotebookPageType;
  typedContent?: string;
  textBlocks: NotebookTextBlock[];
  inkData?: NotebookInkData;
  strokeData?: NotebookStrokeData;
  imageRefs: NotebookImageRef[];
  backgroundFileId?: string;
  pdfPageIndex?: number;
  pageColor: NotebookPageColor;
  pageStyle: NotebookPageStyle;
  status: NotebookPageStatus;
  questionPrompt?: string;
  linkedQuestionId?: string;
  linkedSourceId?: string;
  linkedPastPaperId?: string;
  /** Monotonic content version used to reject stale editor writes. */
  contentRevision: number;
  createdAt: number;
  updatedAt: number;
};

export type NotebookFile = {
  id: string;
  notebookId: string;
  folderId: string;
  fileName: string;
  fileType: string;
  storagePath: string;
  sizeBytes?: number;
  pageCount?: number;
  uploadedAt: number;
  createdAt: number;
  updatedAt: number;
};

export const MAX_NOTEBOOK_TITLE_LENGTH = 140;
export const MAX_NOTEBOOK_TOPIC_IDS = 30;
export const MAX_NOTEBOOK_SOURCE_IDS = 30;
export const MAX_NOTEBOOK_PAGE_TYPED_CONTENT = 30_000;
export const MAX_NOTEBOOK_TEXT_BLOCKS = 80;
export const MAX_NOTEBOOK_TEXT_BLOCK_TEXT = 4_000;
export const MAX_NOTEBOOK_INK_SVG_LENGTH = 850_000;
// Firestore documents have a 1 MiB ceiling. Leave room for field names and
// page metadata instead of relying on the backend to reject a nearly-full doc.
export const MAX_NOTEBOOK_PAGE_SNAPSHOT_BYTES = 900_000;
export const NOTEBOOK_PAGE_COORDINATE_WIDTH = 900;
export const NOTEBOOK_PAGE_COORDINATE_HEIGHT = 1240;
export const MAX_NOTEBOOK_IMAGE_REFS = 12;
export const MAX_NOTEBOOK_STROKES = 3_000;
export const MAX_NOTEBOOK_STROKE_POINTS = 1_200;
export const MAX_NOTEBOOK_FILE_NAME_LENGTH = 500;
export const MAX_NOTEBOOK_FILE_TYPE_LENGTH = 120;
export const MAX_NOTEBOOK_FILE_STORAGE_PATH_LENGTH = 1_000;
export const MAX_NOTEBOOK_PREVIEW_SVG_LENGTH = 120_000;
export const MIN_NOTEBOOK_TEXT_BLOCK_WIDTH = 120;
export const MIN_NOTEBOOK_TEXT_BLOCK_HEIGHT = 48;

export type NotebookTextBlockResizeEdge = "top" | "right" | "bottom" | "left";

export function isNotebookType(value: unknown): value is NotebookType {
  return (
    value === "blank" ||
    value === "uploaded_file" ||
    value === "ai_questions" ||
    value === "general_working" ||
    value === "free_working" ||
    value === "practice" ||
    value === "past_paper" ||
    value === "generated_drill" ||
    value === "source_notes"
  );
}

export function isNotebookPageType(value: unknown): value is NotebookPageType {
  return (
    value === "blank" ||
    value === "question" ||
    value === "past_paper_page" ||
    value === "source_note" ||
    value === "free_working"
  );
}

export function isNotebookPageColor(value: unknown): value is NotebookPageColor {
  return value === "white" || value === "black";
}

export function isNotebookPenColor(value: unknown): value is NotebookPenColor {
  return value === "black" || value === "white" || value === "red" || value === "green";
}

export function isNotebookHighlighterColor(value: unknown): value is NotebookHighlighterColor {
  return value === "yellow" || value === "green" || value === "pink";
}

export function isNotebookCustomStrokeColor(value: unknown): value is NotebookCustomStrokeColor {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeNotebookStrokeColor(
  value: unknown,
  fallback: NotebookStrokeColor = "black"
): NotebookStrokeColor {
  if (isNotebookPenColor(value) || isNotebookHighlighterColor(value)) return value;
  if (isNotebookCustomStrokeColor(value)) return value.toLowerCase() as NotebookCustomStrokeColor;
  return fallback;
}

export function isNotebookStrokeTool(value: unknown): value is NotebookStrokeTool {
  return value === "pen" || value === "eraser" || value === "highlighter";
}

export function isNotebookPageStyle(value: unknown): value is NotebookPageStyle {
  return value === "plain" || value === "lined" || value === "grid" || value === "dot";
}

export function isNotebookPageStatus(value: unknown): value is NotebookPageStatus {
  return value === "blank" || value === "working" || value === "needs_review" || value === "marked";
}

export function normalizeNotebookTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_NOTEBOOK_TITLE_LENGTH);
}

function normalizeNotebookStrokePoint(value: unknown, index = 0): NotebookStrokePoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== "number" || typeof point.y !== "number") return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: Math.max(0, Math.min(10_000, point.x)),
    y: Math.max(0, Math.min(10_000, point.y)),
    pressure: normalizeInkPressure(point.pressure),
    time: normalizeInkTime(point.time, index * 16),
  };
}

function normalizeNotebookStroke(value: unknown): NotebookStroke | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stroke = value as Record<string, unknown>;
  const rawPoints = Array.isArray(stroke.points) ? stroke.points : [];
  const points = rawPoints
    .map((point, index) => normalizeNotebookStrokePoint(point, index))
    .filter((point): point is NotebookStrokePoint => Boolean(point));
  if (points.length === 0) return null;

  const width =
    typeof stroke.width === "number" && Number.isFinite(stroke.width)
      ? Math.max(1, Math.min(96, Math.round(stroke.width)))
      : 5;

  return {
    points,
    color: normalizeNotebookStrokeColor(stroke.color),
    width,
    tool: isNotebookStrokeTool(stroke.tool) ? stroke.tool : "pen",
  };
}

function normalizeStrokeData(value: unknown): NotebookStrokeData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const data = value as { version?: unknown; strokes?: unknown };
  if (!Array.isArray(data.strokes)) {
    return undefined;
  }

  const strokes = data.strokes
    .map(normalizeNotebookStroke)
    .filter((stroke): stroke is NotebookStroke => Boolean(stroke));

  return {
    version: typeof data.version === "number" ? data.version : 1,
    strokes,
  };
}

export function normalizeNotebookInkData(value: unknown): NotebookInkData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (
    data.version !== 2 ||
    data.format !== "js-draw-svg" ||
    typeof data.svg !== "string" ||
    !data.svg.trimStart().startsWith("<svg")
  ) {
    return undefined;
  }
  return {
    version: 2,
    format: "js-draw-svg",
    svg: data.svg,
  };
}

export function normalizeNotebookPreviewSvg(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > MAX_NOTEBOOK_PREVIEW_SVG_LENGTH ||
    !value.trimStart().startsWith("<svg")
  ) {
    return undefined;
  }
  return value;
}

function normalizeImageRefs(value: unknown): NotebookImageRef[] {
  if (!Array.isArray(value)) return [];

  const images: NotebookImageRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const image = entry as Record<string, unknown>;
    const id = normalizeOptionalString(image.id, 160);
    if (!id) continue;
    images.push({
      id,
      storagePath: normalizeOptionalString(image.storagePath, 1_000),
      localPreviewUrl: normalizeOptionalString(image.localPreviewUrl, 4_000),
      width: typeof image.width === "number" ? image.width : undefined,
      height: typeof image.height === "number" ? image.height : undefined,
    });
  }

  return images;
}

function clampTextBlockNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function resizeNotebookTextBlockFromEdge(input: {
  block: NotebookTextBlock;
  edge: NotebookTextBlockResizeEdge;
  deltaX: number;
  deltaY: number;
}): NotebookTextBlock {
  const roundedDeltaX = Math.round(input.deltaX);
  const roundedDeltaY = Math.round(input.deltaY);
  const right = input.block.x + input.block.width;
  const bottom = input.block.y + input.block.height;
  const next: NotebookTextBlock = { ...input.block };

  if (input.edge === "left") {
    const x = Math.max(
      0,
      Math.min(right - MIN_NOTEBOOK_TEXT_BLOCK_WIDTH, input.block.x + roundedDeltaX)
    );
    next.x = x;
    next.width = right - x;
  }

  if (input.edge === "right") {
    next.width = Math.max(
      MIN_NOTEBOOK_TEXT_BLOCK_WIDTH,
      Math.min(NOTEBOOK_PAGE_COORDINATE_WIDTH - input.block.x, input.block.width + roundedDeltaX)
    );
  }

  if (input.edge === "top") {
    const y = Math.max(
      0,
      Math.min(bottom - MIN_NOTEBOOK_TEXT_BLOCK_HEIGHT, input.block.y + roundedDeltaY)
    );
    next.y = y;
    next.height = bottom - y;
  }

  if (input.edge === "bottom") {
    next.height = Math.max(
      MIN_NOTEBOOK_TEXT_BLOCK_HEIGHT,
      Math.min(NOTEBOOK_PAGE_COORDINATE_HEIGHT - input.block.y, input.block.height + roundedDeltaY)
    );
  }

  return next;
}

function normalizeTextBlock(value: unknown): NotebookTextBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  const id = normalizeOptionalString(block.id, 160);
  if (!id || typeof block.text !== "string") return null;
  // Loading is intentionally lossless for legacy documents. The write
  // contract below reports limits instead of silently truncating user work.
  const text = block.text;

  const width = clampTextBlockNumber(
    block.width,
    MIN_NOTEBOOK_TEXT_BLOCK_WIDTH,
    NOTEBOOK_PAGE_COORDINATE_WIDTH,
    320
  );
  const height = clampTextBlockNumber(
    block.height,
    MIN_NOTEBOOK_TEXT_BLOCK_HEIGHT,
    NOTEBOOK_PAGE_COORDINATE_HEIGHT,
    120
  );

  return {
    id,
    x: clampTextBlockNumber(block.x, 0, NOTEBOOK_PAGE_COORDINATE_WIDTH - width, 80),
    y: clampTextBlockNumber(block.y, 0, NOTEBOOK_PAGE_COORDINATE_HEIGHT - height, 80),
    width,
    height,
    text,
    outlineVisible:
      typeof block.outlineVisible === "boolean" ? block.outlineVisible : true,
  };
}

export function normalizeNotebookTextBlocks(value: unknown): NotebookTextBlock[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(normalizeTextBlock)
    .filter((block): block is NotebookTextBlock => Boolean(block));
}

export function createNotebookTextBlocksFromTypedContent(
  typedContent: string | undefined
): NotebookTextBlock[] {
  const text =
    typeof typedContent === "string" && typedContent.trim()
      ? typedContent
      : undefined;
  if (!text) return [];

  return [
    {
      id: "legacy-typed-content",
      x: 80,
      y: 92,
      width: 520,
      height: 180,
      text,
      outlineVisible: true,
    },
  ];
}

export function buildTypedContentFromTextBlocks(textBlocks: NotebookTextBlock[]) {
  const content = textBlocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return content || undefined;
}

export type NotebookPageSnapshotInput = {
  typedContent: string;
  textBlocks: NotebookTextBlock[];
  inkData?: NotebookInkData;
  pageColor: NotebookPageColor;
  pageStyle: NotebookPageStyle;
  status: NotebookPageStatus;
};

export type NotebookPagePersistenceErrorCode =
  | "invalid-ink"
  | "ink-too-large"
  | "too-many-text-blocks"
  | "text-block-too-large"
  | "typed-content-too-large"
  | "legacy-strokes-too-large"
  | "too-many-images"
  | "snapshot-too-large";

export class NotebookPagePersistenceError extends Error {
  readonly code: NotebookPagePersistenceErrorCode;

  constructor(code: NotebookPagePersistenceErrorCode, message: string) {
    super(message);
    this.name = "NotebookPagePersistenceError";
    this.code = code;
  }
}

function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Canonical preflight for every editable notebook-page write.
 *
 * Readers remain tolerant so legacy content is never clipped on open. Writers
 * are strict and actionable so the editor can keep a local draft instead of
 * pretending a lossy save succeeded.
 */
export function prepareNotebookPageSnapshotForPersistence(
  input: NotebookPageSnapshotInput
): NotebookPageSnapshotInput & { byteLength: number } {
  const inkData = input.inkData
    ? normalizeNotebookInkData(input.inkData)
    : undefined;
  if (input.inkData && !inkData) {
    throw new NotebookPagePersistenceError(
      "invalid-ink",
      "This page's drawing data is invalid. Your local draft is still available."
    );
  }
  if (inkData && inkData.svg.length > MAX_NOTEBOOK_INK_SVG_LENGTH) {
    throw new NotebookPagePersistenceError(
      "ink-too-large",
      "This page has too much ink to sync safely. Split the work across another page; this draft remains on this device."
    );
  }
  if (!Array.isArray(input.textBlocks) || input.textBlocks.length > MAX_NOTEBOOK_TEXT_BLOCKS) {
    throw new NotebookPagePersistenceError(
      "too-many-text-blocks",
      `A page can sync up to ${MAX_NOTEBOOK_TEXT_BLOCKS} text boxes. Delete or move a text box, then try again.`
    );
  }
  const oversizedTextBlock = input.textBlocks.find(
    (block) => typeof block.text !== "string" || block.text.length > MAX_NOTEBOOK_TEXT_BLOCK_TEXT
  );
  if (oversizedTextBlock) {
    throw new NotebookPagePersistenceError(
      "text-block-too-large",
      `Each text box can sync up to ${MAX_NOTEBOOK_TEXT_BLOCK_TEXT.toLocaleString()} characters. Shorten that text box and try again.`
    );
  }
  if (input.typedContent.length > MAX_NOTEBOOK_PAGE_TYPED_CONTENT) {
    throw new NotebookPagePersistenceError(
      "typed-content-too-large",
      `Typed page content can sync up to ${MAX_NOTEBOOK_PAGE_TYPED_CONTENT.toLocaleString()} characters. Split it across another page and try again.`
    );
  }

  const snapshot = {
    typedContent: input.typedContent,
    textBlocks: input.textBlocks.map((block) => ({ ...block })),
    inkData,
    pageColor: input.pageColor,
    pageStyle: input.pageStyle,
    status: input.status,
  };
  const byteLength = getUtf8ByteLength(JSON.stringify(snapshot));
  if (byteLength > MAX_NOTEBOOK_PAGE_SNAPSHOT_BYTES) {
    throw new NotebookPagePersistenceError(
      "snapshot-too-large",
      "This page is too large to sync safely. Split some writing or text onto another page; this draft remains on this device."
    );
  }

  return { ...snapshot, byteLength };
}

export function getNotebookPagesAfterDelete(
  pages: readonly NotebookPage[],
  pageId: string
): NotebookPage[] {
  const normalizedPageId = pageId.trim();
  if (!normalizedPageId) return [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

  return pages
    .filter((page) => page.id !== normalizedPageId)
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page, index) => {
      const pageNumber = index + 1;
      const title =
        !page.title || /^Page \d+$/i.test(page.title) ? `Page ${pageNumber}` : page.title;
      return {
        ...page,
        pageNumber,
        title,
      };
    });
}

export function mapNotebookData(id: string, data: Record<string, unknown>): Notebook {
  const title = normalizeNotebookTitle(typeof data.title === "string" ? data.title : "");

  return {
    id,
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    title: title || "Untitled notebook",
    type: isNotebookType(data.type) ? data.type : "free_working",
    topicIds: normalizeStringArray(data.topicIds, MAX_NOTEBOOK_TOPIC_IDS, 120),
    sourceIds: normalizeStringArray(data.sourceIds, MAX_NOTEBOOK_SOURCE_IDS, 160),
    practiceSetId: normalizeOptionalString(data.practiceSetId, 160),
    pastPaperId: normalizeOptionalString(data.pastPaperId, 160),
    color: normalizeOptionalString(data.color, 80),
    icon: normalizeOptionalString(data.icon, 40),
    pageColor: isNotebookPageColor(data.pageColor) ? data.pageColor : "white",
    pageStyle: isNotebookPageStyle(data.pageStyle) ? data.pageStyle : "plain",
    uploadedFileId: normalizeOptionalString(data.uploadedFileId, 160),
    previewInkSvg: normalizeNotebookPreviewSvg(data.previewInkSvg),
    previewPageId: normalizeOptionalString(data.previewPageId, 160),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    archived: data.archived === true,
  };
}

export function mapNotebookPageData(
  id: string,
  data: Record<string, unknown>
): NotebookPage {
  const pageNumber =
    typeof data.pageNumber === "number" && Number.isFinite(data.pageNumber)
      ? Math.max(1, Math.round(data.pageNumber))
      : 1;
  const typedContent =
    typeof data.typedContent === "string" && data.typedContent.trim()
      ? data.typedContent
      : undefined;
  const textBlocks = normalizeNotebookTextBlocks(data.textBlocks);

  return {
    id,
    notebookId: normalizeOptionalString(data.notebookId, 160) ?? "",
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    pageNumber,
    title: normalizeOptionalString(data.title, 120),
    pageType: isNotebookPageType(data.pageType) ? data.pageType : "blank",
    typedContent,
    textBlocks: textBlocks.length > 0 ? textBlocks : createNotebookTextBlocksFromTypedContent(typedContent),
    inkData: normalizeNotebookInkData(data.inkData),
    strokeData: normalizeStrokeData(data.strokeData),
    imageRefs: normalizeImageRefs(data.imageRefs),
    backgroundFileId: normalizeOptionalString(data.backgroundFileId, 160),
    pdfPageIndex:
      typeof data.pdfPageIndex === "number" &&
      Number.isFinite(data.pdfPageIndex) &&
      data.pdfPageIndex >= 0
        ? Math.round(data.pdfPageIndex)
        : undefined,
    pageColor: isNotebookPageColor(data.pageColor) ? data.pageColor : "white",
    pageStyle: isNotebookPageStyle(data.pageStyle) ? data.pageStyle : "plain",
    status: isNotebookPageStatus(data.status) ? data.status : "blank",
    questionPrompt: normalizeOptionalString(data.questionPrompt, 4_000),
    linkedQuestionId: normalizeOptionalString(data.linkedQuestionId, 160),
    linkedSourceId: normalizeOptionalString(data.linkedSourceId, 160),
    linkedPastPaperId: normalizeOptionalString(data.linkedPastPaperId, 160),
    contentRevision:
      typeof data.contentRevision === "number" &&
      Number.isFinite(data.contentRevision) &&
      data.contentRevision >= 0
        ? Math.round(data.contentRevision)
        : 0,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function buildNotebookPayload(input: {
  folderId: string;
  title: string;
  type?: NotebookType;
  topicIds?: string[];
  sourceIds?: string[];
  practiceSetId?: string;
  pastPaperId?: string;
  color?: string;
  icon?: string;
  pageColor?: NotebookPageColor;
  pageStyle?: NotebookPageStyle;
  uploadedFileId?: string;
  previewInkSvg?: string;
  previewPageId?: string;
  now?: number;
}) {
  const folderId = input.folderId.trim();
  const title = normalizeNotebookTitle(input.title);
  if (!folderId) {
    throw new Error("Choose a folder for this notebook.");
  }
  if (!title) {
    throw new Error("Notebook title is required.");
  }

  const now = input.now ?? Date.now();

  return {
    folderId,
    title,
    type: input.type ?? "free_working",
    topicIds: normalizeStringArray(input.topicIds ?? [], MAX_NOTEBOOK_TOPIC_IDS, 120),
    sourceIds: normalizeStringArray(input.sourceIds ?? [], MAX_NOTEBOOK_SOURCE_IDS, 160),
    practiceSetId: normalizeOptionalString(input.practiceSetId, 160) ?? null,
    pastPaperId: normalizeOptionalString(input.pastPaperId, 160) ?? null,
    color: normalizeOptionalString(input.color, 80) ?? null,
    icon: normalizeOptionalString(input.icon, 40) ?? null,
    pageColor: input.pageColor ?? "white",
    pageStyle: input.pageStyle ?? "plain",
    uploadedFileId: normalizeOptionalString(input.uploadedFileId, 160) ?? null,
    previewInkSvg: normalizeNotebookPreviewSvg(input.previewInkSvg) ?? null,
    previewPageId: normalizeOptionalString(input.previewPageId, 160) ?? null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildNotebookPagePayload(input: {
  notebookId: string;
  folderId: string;
  pageNumber: number;
  title?: string;
  pageType?: NotebookPageType;
  typedContent?: string;
  textBlocks?: NotebookTextBlock[];
  inkData?: NotebookInkData;
  strokeData?: NotebookStrokeData;
  imageRefs?: NotebookImageRef[];
  backgroundFileId?: string;
  pdfPageIndex?: number;
  pageColor?: NotebookPageColor;
  pageStyle?: NotebookPageStyle;
  status?: NotebookPageStatus;
  questionPrompt?: string;
  linkedQuestionId?: string;
  linkedSourceId?: string;
  linkedPastPaperId?: string;
  now?: number;
}) {
  const notebookId = input.notebookId.trim();
  const folderId = input.folderId.trim();
  if (!notebookId) {
    throw new Error("Missing notebook.");
  }
  if (!folderId) {
    throw new Error("Missing folder.");
  }
  if (!Number.isFinite(input.pageNumber) || input.pageNumber < 1) {
    throw new Error("Page number must be at least 1.");
  }

  const now = input.now ?? Date.now();

  const textBlocks = normalizeNotebookTextBlocks(input.textBlocks);
  const typedContent =
    buildTypedContentFromTextBlocks(textBlocks) ??
    (typeof input.typedContent === "string" && input.typedContent.trim()
      ? input.typedContent
      : undefined);
  const strokeData = input.strokeData ? normalizeStrokeData(input.strokeData) : undefined;
  if (
    input.strokeData &&
    (input.strokeData.strokes.length > MAX_NOTEBOOK_STROKES ||
      input.strokeData.strokes.some(
        (stroke) => stroke.points.length > MAX_NOTEBOOK_STROKE_POINTS
      ))
  ) {
    throw new NotebookPagePersistenceError(
      "legacy-strokes-too-large",
      "This legacy drawing is too large to sync safely. Open it in the notebook editor to preserve it as current ink data."
    );
  }
  if ((input.imageRefs?.length ?? 0) > MAX_NOTEBOOK_IMAGE_REFS) {
    throw new NotebookPagePersistenceError(
      "too-many-images",
      `A page can sync up to ${MAX_NOTEBOOK_IMAGE_REFS} images.`
    );
  }
  const inkData = input.inkData ? normalizeNotebookInkData(input.inkData) : undefined;
  if (input.inkData && !inkData) {
    throw new NotebookPagePersistenceError(
      "invalid-ink",
      "This page's drawing data is invalid and could not be saved."
    );
  }
  prepareNotebookPageSnapshotForPersistence({
    typedContent: typedContent ?? "",
    textBlocks,
    inkData,
    pageColor: input.pageColor ?? "white",
    pageStyle: input.pageStyle ?? "plain",
    status: input.status ?? "blank",
  });

  return {
    notebookId,
    folderId,
    pageNumber: Math.round(input.pageNumber),
    title: normalizeOptionalString(input.title, 120) ?? null,
    pageType: input.pageType ?? "blank",
    typedContent: typedContent ?? null,
    textBlocks,
    inkData: inkData ?? null,
    strokeData: strokeData ?? null,
    imageRefs: (input.imageRefs ?? []).map((image) => ({ ...image })),
    backgroundFileId: normalizeOptionalString(input.backgroundFileId, 160) ?? null,
    pdfPageIndex:
      typeof input.pdfPageIndex === "number" &&
      Number.isFinite(input.pdfPageIndex) &&
      input.pdfPageIndex >= 0
        ? Math.round(input.pdfPageIndex)
        : null,
    pageColor: input.pageColor ?? "white",
    pageStyle: input.pageStyle ?? "plain",
    status: input.status ?? "blank",
    questionPrompt: normalizeOptionalString(input.questionPrompt, 4_000) ?? null,
    linkedQuestionId: normalizeOptionalString(input.linkedQuestionId, 160) ?? null,
    linkedSourceId: normalizeOptionalString(input.linkedSourceId, 160) ?? null,
    linkedPastPaperId: normalizeOptionalString(input.linkedPastPaperId, 160) ?? null,
    contentRevision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function mapNotebookFileData(id: string, data: Record<string, unknown>): NotebookFile {
  return {
    id,
    notebookId: normalizeOptionalString(data.notebookId, 160) ?? "",
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    fileName:
      normalizeOptionalString(data.fileName, MAX_NOTEBOOK_FILE_NAME_LENGTH) ??
      "Untitled file",
    fileType:
      normalizeOptionalString(data.fileType, MAX_NOTEBOOK_FILE_TYPE_LENGTH) ??
      "application/octet-stream",
    storagePath: normalizeOptionalString(data.storagePath, MAX_NOTEBOOK_FILE_STORAGE_PATH_LENGTH) ?? "",
    sizeBytes:
      typeof data.sizeBytes === "number" && Number.isFinite(data.sizeBytes)
        ? Math.max(0, Math.round(data.sizeBytes))
        : undefined,
    pageCount:
      typeof data.pageCount === "number" &&
      Number.isFinite(data.pageCount) &&
      data.pageCount > 0
        ? Math.round(data.pageCount)
        : undefined,
    uploadedAt: typeof data.uploadedAt === "number" ? data.uploadedAt : 0,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function buildNotebookFilePayload(input: {
  notebookId: string;
  folderId: string;
  fileName: string;
  fileType: string;
  storagePath: string;
  sizeBytes?: number;
  pageCount?: number;
  now?: number;
}) {
  const notebookId = input.notebookId.trim();
  const folderId = input.folderId.trim();
  const fileName = normalizeOptionalString(input.fileName, MAX_NOTEBOOK_FILE_NAME_LENGTH);
  const fileType = normalizeOptionalString(input.fileType, MAX_NOTEBOOK_FILE_TYPE_LENGTH);
  const storagePath = normalizeOptionalString(input.storagePath, MAX_NOTEBOOK_FILE_STORAGE_PATH_LENGTH);
  if (!notebookId) throw new Error("Missing notebook.");
  if (!folderId) throw new Error("Missing folder.");
  if (!fileName) throw new Error("File name is required.");
  if (!fileType) throw new Error("File type is required.");
  if (!storagePath) throw new Error("File storage path is required.");

  const now = input.now ?? Date.now();

  return {
    notebookId,
    folderId,
    fileName,
    fileType,
    storagePath,
    sizeBytes:
      typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes)
        ? Math.max(0, Math.round(input.sizeBytes))
        : null,
    pageCount:
      typeof input.pageCount === "number" &&
      Number.isFinite(input.pageCount) &&
      input.pageCount > 0
        ? Math.round(input.pageCount)
        : null,
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
