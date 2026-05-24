import {
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/practice/content";

export type PracticeSetType = "manual" | "ai_generated" | "imported" | "past_paper_section";

export type PracticeSet = {
  id: string;
  folderId: string;
  title: string;
  type: PracticeSetType;
  topicIds: string[];
  sourceIds: string[];
  questionIds: string[];
  notebookId?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

export type PastPaper = {
  id: string;
  folderId: string;
  title: string;
  year?: string;
  module?: string;
  sourceId?: string;
  fileName?: string;
  fileType?: string;
  pageCount?: number;
  notebookId?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

const MAX_TITLE_LENGTH = 160;
const MAX_IDS = 80;

export function isPracticeSetType(value: unknown): value is PracticeSetType {
  return (
    value === "manual" ||
    value === "ai_generated" ||
    value === "imported" ||
    value === "past_paper_section"
  );
}

function normalizeTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_LENGTH);
}

export function mapPracticeSetData(id: string, data: Record<string, unknown>): PracticeSet {
  const title = normalizeTitle(typeof data.title === "string" ? data.title : "");

  return {
    id,
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    title: title || "Untitled practice set",
    type: isPracticeSetType(data.type) ? data.type : "manual",
    topicIds: normalizeStringArray(data.topicIds, MAX_IDS, 120),
    sourceIds: normalizeStringArray(data.sourceIds, MAX_IDS, 160),
    questionIds: normalizeStringArray(data.questionIds, MAX_IDS, 160),
    notebookId: normalizeOptionalString(data.notebookId, 160),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    archived: data.archived === true,
  };
}

export function mapPastPaperData(id: string, data: Record<string, unknown>): PastPaper {
  const title = normalizeTitle(typeof data.title === "string" ? data.title : "");
  const pageCount =
    typeof data.pageCount === "number" && Number.isFinite(data.pageCount)
      ? Math.max(0, Math.round(data.pageCount))
      : undefined;

  return {
    id,
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    title: title || "Untitled past paper",
    year: normalizeOptionalString(data.year, 40),
    module: normalizeOptionalString(data.module, 120),
    sourceId: normalizeOptionalString(data.sourceId, 160),
    fileName: normalizeOptionalString(data.fileName, 500),
    fileType: normalizeOptionalString(data.fileType, 120),
    pageCount,
    notebookId: normalizeOptionalString(data.notebookId, 160),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    archived: data.archived === true,
  };
}

export function buildPracticeSetPayload(input: {
  folderId: string;
  title: string;
  type?: PracticeSetType;
  topicIds?: string[];
  sourceIds?: string[];
  questionIds?: string[];
  notebookId?: string;
  now?: number;
}) {
  const folderId = input.folderId.trim();
  const title = normalizeTitle(input.title);
  if (!folderId) {
    throw new Error("Choose a folder for this practice set.");
  }
  if (!title) {
    throw new Error("Practice set title is required.");
  }

  const now = input.now ?? Date.now();

  return {
    folderId,
    title,
    type: input.type ?? "manual",
    topicIds: normalizeStringArray(input.topicIds ?? [], MAX_IDS, 120),
    sourceIds: normalizeStringArray(input.sourceIds ?? [], MAX_IDS, 160),
    questionIds: normalizeStringArray(input.questionIds ?? [], MAX_IDS, 160),
    notebookId: normalizeOptionalString(input.notebookId, 160) ?? null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildPastPaperPayload(input: {
  folderId: string;
  title: string;
  year?: string;
  module?: string;
  sourceId?: string;
  fileName?: string;
  fileType?: string;
  pageCount?: number;
  notebookId?: string;
  now?: number;
}) {
  const folderId = input.folderId.trim();
  const title = normalizeTitle(input.title);
  if (!folderId) {
    throw new Error("Choose a folder for this past paper.");
  }
  if (!title) {
    throw new Error("Past paper title is required.");
  }

  const now = input.now ?? Date.now();

  return {
    folderId,
    title,
    year: normalizeOptionalString(input.year, 40) ?? null,
    module: normalizeOptionalString(input.module, 120) ?? null,
    sourceId: normalizeOptionalString(input.sourceId, 160) ?? null,
    fileName: normalizeOptionalString(input.fileName, 500) ?? null,
    fileType: normalizeOptionalString(input.fileType, 120) ?? null,
    pageCount:
      typeof input.pageCount === "number" && Number.isFinite(input.pageCount)
        ? Math.max(0, Math.round(input.pageCount))
        : null,
    notebookId: normalizeOptionalString(input.notebookId, 160) ?? null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}
