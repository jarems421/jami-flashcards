import {
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/practice/content";

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

export type NotebookPenColor = "black" | "white" | "red" | "green";
export type NotebookStrokeTool = "pen" | "eraser";
export type NotebookPageColor = "white" | "black" | "grey";
export type NotebookPageStatus = "blank" | "working" | "needs_review" | "marked";

export type NotebookStrokePoint = {
  x: number;
  y: number;
};

export type NotebookStroke = {
  points: NotebookStrokePoint[];
  color: NotebookPenColor;
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
  uploadedFileId?: string;
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
  strokeData?: NotebookStrokeData;
  imageRefs: NotebookImageRef[];
  pageColor: NotebookPageColor;
  status: NotebookPageStatus;
  questionPrompt?: string;
  linkedQuestionId?: string;
  linkedSourceId?: string;
  linkedPastPaperId?: string;
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
  uploadedAt: number;
  createdAt: number;
  updatedAt: number;
};

export const MAX_NOTEBOOK_TITLE_LENGTH = 140;
export const MAX_NOTEBOOK_TOPIC_IDS = 30;
export const MAX_NOTEBOOK_SOURCE_IDS = 30;
export const MAX_NOTEBOOK_PAGE_TYPED_CONTENT = 30_000;
export const MAX_NOTEBOOK_IMAGE_REFS = 12;
export const MAX_NOTEBOOK_STROKES = 3_000;
export const MAX_NOTEBOOK_STROKE_POINTS = 1_200;
export const MAX_NOTEBOOK_FILE_NAME_LENGTH = 500;
export const MAX_NOTEBOOK_FILE_TYPE_LENGTH = 120;
export const MAX_NOTEBOOK_FILE_STORAGE_PATH_LENGTH = 1_000;

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
  return value === "white" || value === "black" || value === "grey";
}

export function isNotebookPenColor(value: unknown): value is NotebookPenColor {
  return value === "black" || value === "white" || value === "red" || value === "green";
}

export function isNotebookStrokeTool(value: unknown): value is NotebookStrokeTool {
  return value === "pen" || value === "eraser";
}

export function isNotebookPageStatus(value: unknown): value is NotebookPageStatus {
  return value === "blank" || value === "working" || value === "needs_review" || value === "marked";
}

export function normalizeNotebookTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_NOTEBOOK_TITLE_LENGTH);
}

function normalizeNotebookStrokePoint(value: unknown): NotebookStrokePoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== "number" || typeof point.y !== "number") return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: Math.max(0, Math.min(10_000, point.x)),
    y: Math.max(0, Math.min(10_000, point.y)),
  };
}

function normalizeNotebookStroke(value: unknown): NotebookStroke | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stroke = value as Record<string, unknown>;
  const rawPoints = Array.isArray(stroke.points) ? stroke.points : [];
  const points = rawPoints
    .map(normalizeNotebookStrokePoint)
    .filter((point): point is NotebookStrokePoint => Boolean(point))
    .slice(0, MAX_NOTEBOOK_STROKE_POINTS);
  if (points.length === 0) return null;

  const width =
    typeof stroke.width === "number" && Number.isFinite(stroke.width)
      ? Math.max(1, Math.min(48, Math.round(stroke.width)))
      : 5;

  return {
    points,
    color: isNotebookPenColor(stroke.color) ? stroke.color : "black",
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
    .filter((stroke): stroke is NotebookStroke => Boolean(stroke))
    .slice(0, MAX_NOTEBOOK_STROKES);

  return {
    version: typeof data.version === "number" ? data.version : 1,
    strokes,
  };
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
    if (images.length >= MAX_NOTEBOOK_IMAGE_REFS) break;
  }

  return images;
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
    uploadedFileId: normalizeOptionalString(data.uploadedFileId, 160),
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

  return {
    id,
    notebookId: normalizeOptionalString(data.notebookId, 160) ?? "",
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    pageNumber,
    title: normalizeOptionalString(data.title, 120),
    pageType: isNotebookPageType(data.pageType) ? data.pageType : "blank",
    typedContent: normalizeOptionalString(data.typedContent, MAX_NOTEBOOK_PAGE_TYPED_CONTENT),
    strokeData: normalizeStrokeData(data.strokeData),
    imageRefs: normalizeImageRefs(data.imageRefs),
    pageColor: isNotebookPageColor(data.pageColor) ? data.pageColor : "white",
    status: isNotebookPageStatus(data.status) ? data.status : "blank",
    questionPrompt: normalizeOptionalString(data.questionPrompt, 4_000),
    linkedQuestionId: normalizeOptionalString(data.linkedQuestionId, 160),
    linkedSourceId: normalizeOptionalString(data.linkedSourceId, 160),
    linkedPastPaperId: normalizeOptionalString(data.linkedPastPaperId, 160),
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
  uploadedFileId?: string;
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
    uploadedFileId: normalizeOptionalString(input.uploadedFileId, 160) ?? null,
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
  strokeData?: NotebookStrokeData;
  imageRefs?: NotebookImageRef[];
  pageColor?: NotebookPageColor;
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

  return {
    notebookId,
    folderId,
    pageNumber: Math.round(input.pageNumber),
    title: normalizeOptionalString(input.title, 120) ?? null,
    pageType: input.pageType ?? "blank",
    typedContent:
      normalizeOptionalString(input.typedContent, MAX_NOTEBOOK_PAGE_TYPED_CONTENT) ?? null,
    strokeData: input.strokeData
      ? {
          version: input.strokeData.version,
          strokes: input.strokeData.strokes.slice(0, MAX_NOTEBOOK_STROKES),
        }
      : null,
    imageRefs: (input.imageRefs ?? []).slice(0, MAX_NOTEBOOK_IMAGE_REFS),
    pageColor: input.pageColor ?? "white",
    status: input.status ?? "blank",
    questionPrompt: normalizeOptionalString(input.questionPrompt, 4_000) ?? null,
    linkedQuestionId: normalizeOptionalString(input.linkedQuestionId, 160) ?? null,
    linkedSourceId: normalizeOptionalString(input.linkedSourceId, 160) ?? null,
    linkedPastPaperId: normalizeOptionalString(input.linkedPastPaperId, 160) ?? null,
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
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
