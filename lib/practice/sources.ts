import { normalizeOptionalString, normalizeStringArray } from "@/lib/practice/content";

export type SourceType = "pasted_text" | "manual_note" | "link" | "file";
export type SourceStatus = "active" | "archived";

export type Source = {
  id: string;
  title: string;
  type: SourceType;
  subject?: string;
  folderIds: string[];
  topicIds: string[];
  contentText?: string;
  externalUrl?: string;
  fileName?: string;
  fileType?: string;
  storagePath?: string;
  sizeBytes?: number;
  status: SourceStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export const MAX_SOURCE_TITLE_LENGTH = 160;
export const MAX_SOURCE_CONTENT_LENGTH = 20_000;
export const MAX_SOURCE_TOPIC_IDS = 20;
export const MAX_SOURCE_FOLDER_IDS = 12;

export function isSourceType(value: unknown): value is SourceType {
  return value === "pasted_text" || value === "manual_note" || value === "link" || value === "file";
}

export function isSourceStatus(value: unknown): value is SourceStatus {
  return value === "active" || value === "archived";
}

function normalizeUrl(value: unknown) {
  const url = normalizeOptionalString(value, 1_000);
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function mapSourceData(id: string, data: Record<string, unknown>): Source {
  return {
    id,
    title: normalizeOptionalString(data.title, MAX_SOURCE_TITLE_LENGTH) ?? "Untitled source",
    type: isSourceType(data.type) ? data.type : "manual_note",
    subject: normalizeOptionalString(data.subject, 120),
    folderIds: normalizeStringArray(data.folderIds, MAX_SOURCE_FOLDER_IDS, 160),
    topicIds: normalizeStringArray(data.topicIds, MAX_SOURCE_TOPIC_IDS, 120),
    contentText: normalizeOptionalString(data.contentText, MAX_SOURCE_CONTENT_LENGTH),
    externalUrl: normalizeUrl(data.externalUrl),
    fileName: normalizeOptionalString(data.fileName, 240),
    fileType: normalizeOptionalString(data.fileType, 120),
    storagePath: normalizeOptionalString(data.storagePath, 1_000),
    sizeBytes:
      typeof data.sizeBytes === "number" && Number.isFinite(data.sizeBytes)
        ? Math.max(0, Math.round(data.sizeBytes))
        : undefined,
    status: isSourceStatus(data.status) ? data.status : "active",
    createdBy: normalizeOptionalString(data.createdBy, 160) ?? "",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function buildSourcePayload(
  userId: string,
  input: {
    title: string;
    type: SourceType;
    folderIds?: string[];
    topicIds?: string[];
    contentText?: string;
    externalUrl?: string;
    fileName?: string;
    fileType?: string;
    storagePath?: string;
    sizeBytes?: number;
    now?: number;
  }
) {
  const title = input.title.trim().slice(0, MAX_SOURCE_TITLE_LENGTH);
  const type = input.type;
  const contentText = input.contentText?.trim().slice(0, MAX_SOURCE_CONTENT_LENGTH) ?? "";
  const now = input.now ?? Date.now();

  if (!userId.trim()) {
    throw new Error("Missing userId.");
  }
  if (!title) {
    throw new Error("Source title is required.");
  }
  if ((type === "pasted_text" || type === "manual_note") && !contentText) {
    throw new Error("Paste or write source text first.");
  }
  if (type === "link" && !normalizeUrl(input.externalUrl)) {
    throw new Error("Add a valid source link.");
  }
  if (type === "file" && !input.fileName?.trim()) {
    throw new Error("Add a file name for this reference.");
  }

  return {
    title,
    type,
    folderIds: normalizeStringArray(input.folderIds ?? [], MAX_SOURCE_FOLDER_IDS, 160),
    topicIds: normalizeStringArray(input.topicIds ?? [], MAX_SOURCE_TOPIC_IDS, 120),
    contentText: contentText || null,
    externalUrl: normalizeUrl(input.externalUrl) ?? null,
    fileName: input.fileName?.trim().slice(0, 240) || null,
    fileType: input.fileType?.trim().slice(0, 120) || null,
    storagePath: input.storagePath?.trim().slice(0, 1_000) || null,
    sizeBytes:
      typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes)
        ? Math.max(0, Math.round(input.sizeBytes))
        : null,
    status: "active" as const,
    createdBy: userId.trim(),
    createdAt: now,
    updatedAt: now,
  };
}
